import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FactoryDefinition, FactoryRun, FactoryEvidence } from '../../shared/factories.js';
import { factoryDelivery } from '../../shared/factories.js';
import { constrainPermissionMode } from '../../../cloud/contract/permissions.js';
import { scanForSecrets } from './share-secret-scan.js';
import type { FactoryProviderDependencies } from './factory-provider.service.js';
const SHA = /^[a-f0-9]{40,64}$/;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const safeId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 24);

/** Provider-independent checkout sealing, secret scanning and exact-commit verification. */
export function createFactoryCheckoutOperations(
  io: FactoryProviderDependencies,
  transport: {
    git(cwd: string, ...args: string[]): Promise<string>;
    assertOrigin(factory: FactoryDefinition, remote: string): void;
    readPrHead(factory: FactoryDefinition, run: FactoryRun): Promise<string>;
  },
) {
  const { git, assertOrigin, readPrHead } = transport;
  async function checkoutIdentity(factory: FactoryDefinition, run: FactoryRun) {
    if (!run.checkout) throw new Error('No factory checkout.');
    const repo = io.repoPath(factory.definition.repoId),
      suffix = run.checkout.branch.endsWith('-post-merge') ? '-post-merge' : '',
      expected = path.join(io.rootPath(), safeId(factory.id), safeId(run.id) + suffix);
    if (
      path.resolve(run.checkout.path) !== path.resolve(expected) ||
      run.checkout.branch !== `mezair/factory/${safeId(factory.id)}/${safeId(run.id)}${suffix}`
    )
      throw new Error('The checkout is outside this factory run.');
    assertOrigin(factory, await git(repo, 'remote', 'get-url', 'origin'));
    if ((await git(run.checkout.path, 'symbolic-ref', '--short', 'HEAD')) !== run.checkout.branch)
      throw new Error('The factory checkout branch changed.');
    return run.checkout.path;
  }
  async function evidence(
    factory: FactoryDefinition,
    run: FactoryRun,
    commands: string[],
    postMerge = false,
    guard?: () => Promise<void>,
  ): Promise<FactoryEvidence> {
    const cwd = await checkoutIdentity(factory, run);
    const sealed = postMerge
      ? undefined
      : await sealCandidate(
          factory,
          run,
          `factory:${run.id}:verify:${String(run.repairRounds)}`,
          guard,
        );
    const before = io.snapshot(cwd);
    if (await git(cwd, 'status', '--porcelain'))
      throw new Error('Factory source is not clean for verification.');
    if (
      !postMerge &&
      (commands.length !== factory.definition.criteria.length ||
        commands.length !== factory.definition.checks.length)
    ) {
      throw new Error(
        'Every criterion needs exactly one approved verification command in the same order.',
      );
    }
    if (commands.length + run.commandsUsed > factory.definition.limits.maxCommands)
      throw new Error('Factory command budget exhausted.');
    const results: FactoryEvidence['commands'] = [];
    for (const command of commands) {
      await guard?.();
      const remaining = Date.parse(run.deadlineAt) - Date.now();
      if (remaining <= 0) throw new Error('Factory time budget exhausted.');
      const requestedMode = io.currentMode() ?? 'on-request';
      // Activation is standing approval for these exact frozen commands in the
      // owned checkout. Preserve an explicit global read-only ceiling, while
      // avoiding a per-run native prompt that cannot be answered by the daemon.
      const permissionMode =
        requestedMode === 'read-only'
          ? 'read-only'
          : constrainPermissionMode('workspace-auto', 'workspace-auto');
      const result = await io.verify({
        repositoryId: factory.definition.repoId,
        command,
        cwd,
        target: { kind: 'integration', integrationId: factory.id, runId: run.id },
        permissionMode,
        timeoutMs: Math.min(300000, remaining),
      });
      results.push({
        command,
        exitCode: result.approvalGranted ? result.exitCode : null,
        output: result.logTail,
        timedOut: result.timedOut,
      });
    }
    const after = io.snapshot(cwd);
    if (
      before.head !== after.head ||
      before.tree !== after.tree ||
      (await git(cwd, 'status', '--porcelain')) ||
      (sealed && (before.head !== sealed.head || before.tree !== sealed.tree))
    )
      throw new Error('Source changed during factory verification.');
    const criteria: FactoryEvidence['criteria'] = postMerge
      ? []
      : factory.definition.criteria.map((criterion, index) => {
          const result = results[index];
          return {
            criterion,
            status: result?.exitCode === 0 && !result.timedOut ? 'passed' : 'blocked',
            evidence: result
              ? `Runner observed ${JSON.stringify(result.command)}: exit ${result.exitCode}. ${result.output}`
              : 'No approved check for this criterion.',
          };
        });
    return {
      headSha: before.head,
      treeSha: before.tree,
      criteria,
      commands: results,
      passed:
        (postMerge || criteria.length > 0) &&
        criteria.every((x) => x.status === 'passed') &&
        results.every((x) => x.exitCode === 0 && !x.timedOut),
      checkedAt: new Date().toISOString(),
    };
  }
  async function scanCandidatePatch(patch: string): Promise<void> {
    if (
      !patch ||
      Buffer.byteLength(patch, 'utf8') > MAX_DIFF_BYTES ||
      patch.includes('Binary files ') ||
      patch.includes('GIT binary patch')
    ) {
      throw new Error('Factory candidate diff is empty, binary or too large to scan safely.');
    }
    let inHunk = false;
    const content: string[] = [];
    for (const line of patch.split('\n')) {
      if (line.startsWith('diff --git ')) {
        inHunk = false;
        continue;
      }
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      if (inHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')))
        content.push(line.slice(1));
    }
    const knownSecrets = await io.knownSecrets();
    if (scanForSecrets(content.join('\n'), { knownSecrets }).length > 0)
      throw new Error(
        'Factory candidate contains secret-like content; remove it before publication.',
      );
  }
  async function scanCandidateDiff(cwd: string, baseSha: string, headSha: string): Promise<void> {
    if (!SHA.test(baseSha) || !SHA.test(headSha))
      throw new Error('Factory diff has an invalid pinned revision.');
    const patch = await git(
      cwd,
      '-c',
      'diff.renames=false',
      'diff',
      '--full-index',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--unified=3',
      baseSha,
      headSha,
      '--',
    );
    await scanCandidatePatch(patch);
  }
  async function sealCandidate(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<{ head: string; tree: string }> {
    const cwd = await checkoutIdentity(factory, run),
      baseSha = run.checkout!.baseSha,
      expectedParent =
        run.pullRequest?.headSha ??
        (run.repairRounds > 0 ? run.evidence?.headSha : undefined) ??
        baseSha,
      marker = `Mezair factory candidate ${safeId(run.id)} ${safeId(intentKey)}`;
    if (!SHA.test(baseSha) || !SHA.test(expectedParent))
      throw new Error('Factory candidate has no valid pinned base or repair parent.');
    await guard?.();
    if (await git(cwd, 'status', '--porcelain')) {
      await git(cwd, 'add', '--all');
      const staged = await git(
        cwd,
        'diff',
        '--cached',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--unified=3',
        baseSha,
        '--',
      );
      await scanCandidatePatch(staged);
      await guard?.();
      try {
        await git(cwd, 'commit', '-m', marker);
      } catch {
        // A lost commit response is recoverable only if the exact intent marker was committed.
        const message = await git(cwd, 'show', '-s', '--format=%B', 'HEAD');
        if (!message.trim().split('\n').includes(marker))
          throw new Error('Factory candidate could not be sealed; inspect the retained checkout.');
      }
    }
    if (await git(cwd, 'status', '--porcelain'))
      throw new Error('Factory candidate changed while it was being sealed.');
    const head = await git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}');
    if (!SHA.test(head) || head === baseSha)
      throw new Error('Factory candidate has no sealed changes.');
    const message = await git(cwd, 'show', '-s', '--format=%B', 'HEAD');
    const parent = await git(cwd, 'rev-parse', '--verify', 'HEAD^');
    if (!message.trim().split('\n').includes(marker) || parent !== expectedParent)
      throw new Error(
        'Retained candidate does not match this verification intent and pinned repair parent.',
      );
    await scanCandidateDiff(cwd, baseSha, head);
    const tree = await git(cwd, 'rev-parse', 'HEAD^{tree}');
    if (!SHA.test(tree)) throw new Error('Factory candidate tree is invalid.');
    return { head, tree };
  }
  async function prepareCheckout(
    factory: FactoryDefinition,
    run: FactoryRun,
    _intentKey: string,
    guard?: () => Promise<void>,
  ) {
    await guard?.();
    const repo = io.repoPath(factory.definition.repoId),
      branch = `mezair/factory/${safeId(factory.id)}/${safeId(run.id)}`,
      cwd = path.join(io.rootPath(), safeId(factory.id), safeId(run.id)),
      src = factoryDelivery(factory.definition);
    await git(repo, 'check-ref-format', `refs/heads/${src.baseBranch}`);
    assertOrigin(factory, await git(repo, 'remote', 'get-url', 'origin'));
    const ref = `refs/mezair/factory/${safeId(run.id)}`;
    await git(repo, 'fetch', '--no-tags', 'origin', `refs/heads/${src.baseBranch}:${ref}`);
    const baseSha = await git(repo, 'rev-parse', '--verify', `${ref}^{commit}`);
    if (!SHA.test(baseSha)) throw new Error('Invalid factory base.');
    if (run.checkout) {
      if (!SHA.test(run.checkout.baseSha)) throw new Error('Factory checkout base pin is invalid.');
      await checkoutIdentity(factory, run);
      if (run.pullRequest) {
        const head = await readPrHead(factory, run);
        if (head !== (await git(cwd, 'rev-parse', 'HEAD')))
          throw new Error('PR head moved; reconcile before repair.');
      }
      return run.checkout;
    }
    await fs.mkdir(path.dirname(cwd), { recursive: true });
    try {
      await git(repo, 'worktree', 'add', '-b', branch, cwd, baseSha);
    } catch (error) {
      // Reconcile only an exact owned checkout; never reset an existing branch.
      const existing = { ...run, checkout: { path: cwd, branch, baseSha } };
      await checkoutIdentity(factory, existing);
      if ((await git(cwd, 'rev-parse', 'HEAD')) !== baseSha) throw error;
    }
    return { path: cwd, branch, baseSha };
  }
  async function verifyMerged(
    factory: FactoryDefinition,
    run: FactoryRun,
    mergeCommitSha: string,
    guard?: () => Promise<void>,
  ) {
    if (!SHA.test(mergeCommitSha)) throw new Error('Invalid confirmed merge commit.');
    const cwd = await checkoutIdentity(factory, run),
      src = factoryDelivery(factory.definition);
    if (await git(cwd, 'status', '--porcelain'))
      throw new Error('Retained factory checkout contains changes.');
    await git(cwd, 'fetch', '--no-tags', 'origin', `refs/heads/${src.baseBranch}`);
    await git(cwd, 'merge-base', '--is-ancestor', mergeCommitSha, 'FETCH_HEAD');
    await guard?.();
    const branch = run.checkout!.branch + '-post-merge',
      postPath = run.checkout!.path + '-post-merge';
    try {
      await git(
        io.repoPath(factory.definition.repoId),
        'worktree',
        'add',
        '-b',
        branch,
        postPath,
        mergeCommitSha,
      );
    } catch {
      if ((await git(postPath, 'rev-parse', 'HEAD')) !== mergeCommitSha)
        throw new Error('Post-merge checkout could not be reconciled.');
    }
    return evidence(
      factory,
      { ...run, checkout: { path: postPath, branch, baseSha: mergeCommitSha } },
      factory.definition.postMergeChecks,
      true,
      guard,
    );
  }
  return { checkoutIdentity, evidence, scanCandidateDiff, prepareCheckout, verifyMerged };
}
