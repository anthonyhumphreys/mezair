# PATCH.md

`PATCH.md` is the authoritative intent guide for deliberate, owned deltas in
this repository. It encodes what each owned change is supposed to do in plain
English, not just what the diff happens to look like, so that a human or agent
can re-apply, repair, or reconcile the change after upstream or cross-project
development moves underneath it.

Treat this file as a current-state guide, not a release log.

## How to use this file

- Review the relevant entry before merging, rebasing, or reworking code that
  touches an owned area.
- Update the entry in the same change whenever owned behavior changes. If code
  and this file drift, fix the drift before merging.
- Classify incoming changes against an entry as one of:
  - `adopt`: the change is compatible with the entry; take it as-is.
  - `adapt`: the change conflicts mechanically; re-apply the entry's required
    behavior on top of it.
  - `reject`: the change breaks the entry's intent; do not take it without
    deliberately revising this file first.
- If a merge is unresolvable, rebuild the feature from the entry's intent and
  required behavior rather than from the broken diff, then verify with the
  entry's verification commands.

## Precedence

- An explicit user or maintainer request wins over this file.
- Project-level `AGENTS.md` contracts win over routine defaults.
- This file defines the expected behavior for the entries below; when other
  code differs from an entry, preserve the entry until the project
  intentionally changes direction.

## Entries

### C1: Effect for Mezair Cloud orchestration internals

Status: active
Owner project: `mezair-cloud`

#### Intent

Use [Effect](https://effect.website) for retries, timeouts, typed failures,
and multi-step async control flow inside Mezair Cloud platform orchestration,
without changing any external contract. Cell authors, CLI users, and adapter
consumers must never need to know Effect exists.

#### Owner modules

- `mezair-cloud/packages/runtime/src/workflow.ts` — workflow step executor
  (attempts, retry schedule, step timeouts).
- `mezair-cloud/packages/runtime/src/agent.ts` — guarded agent runtime
  (`AgentRuntime.invoke`, `AgentRuntime.executeTool`).
- `mezair-cloud/packages/aws/src/aws-provisioner.ts` — AWS preview provisioner
  and destroyer (artifact uploads, stack apply/poll, destroy/poll).
- `mezair-cloud/packages/aws/src/remote.ts` — AWS remote reader (deployment
  metadata, logs).
- `mezair-cloud/packages/cli/src/index.ts` — preview deploy command flow.
- Docs: `mezair-cloud/docs/architecture/deployment-adapters.md` (Effect usage)
  and `mezair-cloud/docs/architecture/workflows.md`.

#### Required behavior

1. Public APIs stay Promise-based. Every Effect surface runs its program at
   the boundary with `Effect.runPromiseExit` and rethrows both typed failures
   and defects as their original error values via `Cause.squash`. Callers must
   keep receiving the same error instances as before Effect adoption:
   `RuntimeError`, `AwsPreviewProvisioningError`, `AwsPreviewDestroyError`,
   `AwsRemoteReaderError`.
2. Error channels are typed with the surface's failure class. No `unknown`
   error channels and no identity catch functions. Errors that are not the
   expected failure class are defects (`Effect.die`), which the boundary
   runner still rethrows unchanged.
3. Polling and retry use `Schedule`, not hand-rolled loops:
   - CloudFormation create/update and delete polling use a spaced schedule
     bounded by `stackMaxPollAttempts` (total describe-call budget unchanged
     from the pre-Effect loops) with `stackPollDelayMs` spacing, then fail
     with `AWS_STACK_TIMEOUT` / `AWS_DESTROY_TIMEOUT`.
   - Workflow step retries use `Schedule.recurs(retries)` plus the configured
     retry delay. A resumed step keeps counting attempts up but always gets a
     fresh budget of one initial attempt plus `retries` repeats. Persistence
     failures inside an attempt count against that step's retry budget and
     surface as step failures, not run-loop crashes.
4. Workflow step timeouts use `Effect.timeoutFail` and produce the same
   `RuntimeError` (`INTERNAL_ERROR`, step name, `timeoutMs` details) as the
   old `Promise.race` implementation.
5. Workflow progress summaries are derived from persisted run state, not stored
   as a second source of truth. A persisted `running` run with no active local
   executor is reported as `resumable`; an active local executor is reported as
   `in-flight`. Completed steps remain the replay boundary.
6. Fan-out work uses `Effect.all` with bounded concurrency (client asset
   uploads currently use `concurrency: 8`), never `"unbounded"` for inputs the
   platform does not bound.
7. Effect stays out of the Cell authoring surface. Cell code, the app DSL,
   manifests, and adapter contracts remain ordinary async TypeScript. The
   `effect` dependency belongs to `@mezair-cloud/runtime`, `@mezair-cloud/aws`,
   and `@mezair/cloud-cli` only.

#### Verification

Run from `mezair-cloud/`:

```sh
pnpm --filter @mezair-cloud/runtime --filter @mezair-cloud/aws --filter @mezair/cloud-cli typecheck
pnpm --filter @mezair-cloud/runtime --filter @mezair-cloud/aws --filter @mezair/cloud-cli test
```

Behavior that must hold after any reconciliation:

- Missing provider invocation rejects with `RuntimeError` code
  `ADAPTER_ERROR` (see `packages/runtime/test/agent.test.ts`).
- Undeclared tool capability rejects with a `RuntimeError` instance, not a
  wrapped `FiberFailure`.
- Stack polling failure and timeout produce `AWS_STACK_FAILED` /
  `AWS_STACK_TIMEOUT` with the same details shape as before (stack name,
  status, events or attempts/delay).
- Workflow retries exhaust to a failed step run with attempts equal to
  `1 + retries`.

#### Upstream break risks

- New orchestration code added with ad-hoc `setTimeout` retry loops or
  `Promise.race` timeouts should be classified `adapt`: port it to the
  boundary contract above.
- Changes that put `effect` imports into Cell-facing packages or examples
  should be classified `reject`.
- An `effect` major version bump is `adapt`: re-verify `Effect.runPromiseExit`
  boundary behavior and `Schedule` semantics before merging.

### C2: Provider-neutral agent execution control plane

Status: active
Owner project: `mezair-cloud`

#### Intent

Turn Agent Sandbox lifecycle primitives into resumable, inspectable executions
without exposing provider APIs, local OAuth files, raw credentials, or shared
writable workspaces to callers. Keep AWS as the only production-target adapter
during alpha; other providers must implement the same execution conformance
contract later.

#### Owner modules

- `mezair-cloud/packages/runtime/src/agent-execution.ts` — JSON-friendly source,
  policy, event, result, and provider I/O contracts.
- `mezair-cloud/packages/control-plane/src/execution*.ts` and
  `fake-execution-provider.ts` — leases, stores, authenticated HTTP boundary,
  immutable snapshot/grant storage, worker protocol, Node service adapter,
  conformance, budgets, and cleanup receipts.
- `mezair-cloud/packages/aws/src/sandbox.ts` — Lambda MicroVM lifecycle and
  read-only execution transport.
- `mezair-cloud/packages/cli/src/index.ts` — execution conformance, durable
  service, snapshot, and lifecycle client commands.
- `mezair-app/src/main/services/mezair-cloud-execution.service.ts` and the typed
  IPC/UI path — opt-in Desktop execution connection and read-only launch flow.
- Docs: `mezair-cloud/docs/architecture/agent-execution-control-plane.md`,
  `mezair-cloud/docs/architecture/agents.md`, and the Mezair Website Cloud mirror.

#### Required behavior

1. `clientToken` makes execution creation idempotent.
2. Provider events are de-duplicated and receive durable, monotonically
   increasing control-plane cursors. File-backed lease and event mutations are
   serialized within the service process, and malformed persisted collections
   fail closed instead of being treated as valid state.
3. Closing and reconnecting a client cannot duplicate events after its last
   cursor.
4. Git sources are credential-free HTTPS URLs pinned to hexadecimal commits;
   snapshot sources use opaque ids and SHA-256 digests. Source selection records
   the exclusion of `.git`, ignored files, secrets, and unrelated untracked
   files.
5. Model authentication is either control-plane-brokered by credential name or
   an execution-scoped `codex` / `cursor` provider-subscription login. The
   latter stores only provider and `sandbox-session` persistence intent in the
   lease. Local OAuth caches, access tokens, API keys, and credential values
   have no protocol field and must not be copied into snapshots, leases,
   events, results, or artifacts. A provider must reject subscription auth
   unless its worker explicitly advertises that provider.
6. Network policy matches the compiled agent manifest. Read-write execution
   requires the agent filesystem capability. AWS remains read-only and rejects
   working-tree patches in this implementation.
7. TTL, provider-event, and estimated-cost ceilings fail the lease and request
   sandbox cleanup.
8. Collection and cancellation emit cleanup receipts. Teardown is `verified`
   only after provider inspection reports a terminal sandbox.
9. The fake provider conformance loop must pause for approval, resume the same
   run from a cursor, return a patch, and prove teardown.
10. The AWS execution transport uses short-lived MicroVM auth tokens for each
    request and does not persist them.
11. Hosted HTTP handlers fail closed without authentication and call workspace
    authorisation for every user operation. Source-grant downloads use a
    separate execution-bound bearer and bypass user authentication only for
    that exact one-time route. Runnable Node services reject invalid user
    bearer headers before buffering large snapshot request bodies.
12. Snapshot bytes are content-addressed, size-bounded, and served through
    short-lived single-use grants whose raw token is returned once and only a
    SHA-256 verifier is persisted. The worker verifies declared byte counts and
    SHA-256 digests before preparing the workspace. Snapshot and worker grants
    with invalid expiry timestamps fail closed.
13. Desktop keeps the Mezair Cloud bearer encrypted in the Electron main
    process. The renderer sees only endpoint and configured state. Desktop
    uploads a committed Git archive with `.git`, ignored/untracked files,
    working-tree changes, and known secret-file paths excluded; remote launch
    remains read-only and behind the existing Cloud feature flag.
14. The control plane exposes registered execution providers and their
    capability/configuration descriptors without starting a sandbox. A provider
    can be registered but not configured, and clients must show its reason and
    still perform the request-level support check before launch.

#### Verification

Run from `mezair-cloud/`:

```sh
pnpm --filter @mezair-cloud/runtime --filter @mezair-cloud/control-plane --filter @mezair-cloud/aws --filter @mezair/cloud-cli typecheck
pnpm --filter @mezair-cloud/control-plane test
pnpm --filter @mezair-cloud/aws test -- agent.test.ts
pnpm --filter @mezair/cloud-cli test -- cli.test.ts
mezair-cloud executions conformance --json
cd ../mezair-app && pnpm exec tsc --noEmit -p tsconfig.node.json && pnpm exec tsc --noEmit -p tsconfig.web.json && pnpm lint && pnpm test
```

#### Upstream break risks

- A provider-specific field in the Runtime execution request is `reject`.
- Persisting pre-signed source URLs, auth tokens, credential values, or local
  agent OAuth state is `reject`.
- Treating a worker image as subscription-capable without an explicit
  capability advertisement is `reject`.
- Treating a provider descriptor as proof that a particular execution request
  is supported is `reject`; callers must still use the provider's support
  result when selecting a target.
- Making the hosted handler authentication-optional or returning the encrypted
  Desktop bearer to the renderer is `reject`.
- Replacing cursor reads with an unresumable stream is `adapt`: preserve the
  durable cursor as the recovery boundary even if live delivery uses SSE or
  WebSocket.
- Treating a terminate request as verified cleanup without provider inspection
  is `reject`.
- Enabling AWS writes before patch signing, result review, approval gates, and
  cleanup evidence are implemented is `adapt` or `reject` depending on whether
  it can be restored behind read-only policy.

### C3: Portable application data and background work

Status: active
Owner project: `mezair-cloud`

Keep conditional commits, bounded table pages and the job outbox provider-neutral.
Local, in-memory, DynamoDB and D1 hosts share all-or-nothing compare-and-replace
semantics. Reject stale conditions with `CONFLICT` and retain the original state.
Keep the 25-write, 256-KiB record and 1-MiB total portable limits. JSON local
writes serialize within one process and use atomic file replacement.

Pending jobs can be committed with application records. Scheduled Cell jobs call
`ctx.dispatchPendingJobs` without accessing a provider host. Publication uses bounded
passes, conditional leases, stable logical ids and retained failures. Preserve
those ids through AWS and Cloudflare queue delivery so applications can deduplicate
with transaction receipts. Delivery remains at least once. Do not claim atomicity
for HTTP calls, file storage or queue publication itself.

Cloudflare D1, private R2, queue/Cron and OIDC support are experimental runtime
implementations. Artifacts can refer to existing stage-specific resources and
emit a D1 migration. Keep the normal Cell deployment gate until provisioning and
live lifecycle evidence exist. Require the same release evidence on AWS and
Cloudflare. Do not add consumer-specific matching, source formats or business rules.

Owner modules are `packages/runtime/src/database-{commit,page}.ts`,
`packages/runtime/src/job-outbox.ts`, the local/AWS hosts, the AWS queue bridge,
and `packages/cloudflare/src/{database,files,host,http,resources,artifacts}.ts`.
The behavior and open release checks are in
`mezair-cloud/docs/architecture/application-backends.md`.

Verify from `mezair-cloud/` with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm verify:cloudflare-preview`. Real local D1/R2 tests and AWS SDK tests are
required; neither substitutes for live provider evidence.

### C4: Reviewed Desktop delivery and read-only Mesh candidates

Status: active
Owner project: `mezair-app`

Turn-level delivery captures an immutable main-process review of the current
changes in explicitly selected files. Provider edit events identify the files;
they do not establish the files' final contents. Display the exact candidate
before confirmation and reject stale branch, HEAD, index, file, origin or PR
base state. Preserve unrelated staged and working changes. Create commits with
normal Git hooks and signing in an isolated checkout, then verify the reviewed
tree, parent and message before updating the source branch. PRs use a dedicated
branch whose complete diff against its pinned remote base has been reviewed.
Failed external delivery retains a recoverable local or pushed branch.

Mesh branch combination, verification and application are independent facts.
Empty checks mean verification did not run. Persist reviewed commands and their
tested commit/tree, cap execution by the originating run and current policy,
and invalidate evidence if the checkout changes. Retrying verification never
replays branch combination. Applying a verified repository is an explicit
fast-forward from its recorded base in a clean checkout, with a separate
receipt for each repository. Never force, discard local changes or push as
part of application. Hold real Git index and ref/HEAD locks, persist application
intent before changing the checkout, and reconcile an exact clean destination
match after restart. Retain ambiguous outcomes for inspection.

Current-tracked source candidates are a bounded read-only Mesh feature. Capture
selected tracked text files before approval, preserve source Git state, reject
secret paths and secrets in both removed and added patch content, and freeze
the base, candidate commit/tree, included paths and digest. Carry candidate
bytes only in task-key-sealed inputs. Never publish them in a public manifest,
status result or synced workflow template. Enforce the 128-KiB aggregate
candidate payload, file/count limits and full sealed request limits. Require
backend `mesh-job-capability-requirements/1` and worker
`remote-review-candidate/v1`; an older backend or worker must fail closed.
Freeze every selected repository's base and the approved backend/account scope
before approval. Recheck that identity and backend support before submission
or replay, retaining the original sealed request bytes.
Materialize and validate the candidate in an isolated worker checkout before
provider execution. Read-only review must not report the input candidate as
worker-produced changes. Untracked files, binary patches and write-capable
candidate tasks remain unsupported. Workflow edges continue to carry reports,
not predecessor working directories.

This entry concerns Desktop Mesh. Do not weaken C2's separate Cloud execution
source, authentication or read-only boundaries.

Owner modules: `scoped-git.service.ts`, `remote-review-candidate.service.ts`,
`chat-delegation.service.ts`, `workflow.service.ts`, `mesh-dispatch.service.ts`,
`mesh-integration.service.ts`, `mesh-worker.service.ts`, their shared contracts
and typed IPC/UI paths, and backend worker placement/claim capability checks.

Verify Desktop Node/web TypeScript checks, lint, service/real-Git tests and the
full Desktop suite; run backend tests and typecheck for capability changes.
Native UI and physical-device acceptance remain separate evidence.

### C5: Explicit conversational validation

Status: active
Owner project: `mezair-app`

Validation is introduced only by a user request or an explicit workflow step.
Resolve acceptance criteria from the linked work item or the original request
and clarifications. Plans and per-criterion evidence render as a native inline
surface; there is no separate Changes navigation or scenario form. Explicit
review and validation chat actions submit their scoped prompt once the target
conversation is ready, queueing behind an active run when the provider supports
it. They keep the thread's existing permissions.

Keep source snapshots, criteria versions and execution provenance explicit.
Only the verification executor records command outcomes. Browser, manual and
inspection observations are labelled agent-reported and do not constitute human
acceptance. Changing source or criteria invalidates evidence. Workflow checks
must use the retained execution checkout, not another copy of the repository.
Revisions clear prior outcomes; interrupted or unobserved checks cannot pass.
Preserve existing review records, screenshots and decisions through chat and
work-item history. Save reusable workflow instructions without copying evidence.

Owner modules: `validation.service.ts`, the validation surface triple and its
registry entries, work-item launch/history, legacy review route handling,
workflow validation tools and the shared question lifecycle. Local workflow
tool sessions allow only validation, surface reads and conversational questions,
with current role/access checks and revocation when the worker exits. Re-check
the issuing authority after source refresh and approval; a stopped or replaced
session cannot start or continue queued validation commands. Saved
validation steps cannot complete without current per-criterion evidence.
Verify Node/web typechecks, lint, service/real-Git tests, the Desktop suite and
production build. Browser replay is presentation evidence, not native acceptance.

### C6: Reviewed thread shares and explicit ticket publication

Status: active
Owner projects: `mezair-app`, `mezair-website`

Share only the exact main-process snapshot reviewed by the author. Include
visible conversation text and explicitly selected artifacts, native surfaces
and attachments; exclude system prompts, provider events and account keys.
Bound preview custody to its options, expiry and backend/account identity.
Updates are explicit, preserve the link's audience and expiry, and atomically
replace reviewed title metadata and encrypted bytes. Changed access requires
a new link. Saved credentials must be scanned in their serialized and HTML
forms; binary content is disclosed as unscanned.

Each share uses an independent browser fragment key. Guest links permit
possession-based reads. Organisation links additionally require a verified
website identity and current membership for every metadata and byte read,
without requiring a paid reader seat. Fail closed when the backend/viewer
cannot enforce the requested audience. Keep keys out of OAuth URLs, server
requests, analytics, logs and SQLite. Revocation and expiry block future reads;
they cannot recall bytes already downloaded. Account changes invalidate
preview publication and transport operations.

Attaching a link to a ticket is a separate explicit action after reviewing the
connection, target and comment. Keep the complete fragment in the provider's
link. Pin connection identity across asynchronous lookups, recheck share
liveness immediately before posting, and retain durable publication intent.
Never automatically retry a pending or uncertain comment publication.

Owner modules: Desktop share/thread-share/share-ticket services, share IPC/UI
and persistence; Sync share contract, coordinator and hosted access checks;
website artifact viewer, signed read client and fragment sign-in restoration.
Verify desktop and backend suites, migration retention, membership denial,
revocation/expiry, frozen preview bytes, redaction and ticket retry boundaries;
also run typechecks, lint, website viewer tests and production builds. Live
identity-provider and external-ticket acceptance is separate from local mocks.

Recipients may explicitly pick up a thread by downloading a `.mezair-thread`
package from the authorised, decrypted viewer. The package contains the same
redacted structured conversation, selected context and inert snapshot; it is a
readable local copy that cannot be recalled by revocation. Keep fragment keys
out of packages and protocol links. `mezair://pick-up-thread` only opens import
review; it carries no conversation data. File association and manual import
must use the same bounded, frozen main-process validation.

Import creates a fresh private thread only after the recipient chooses their
workspace, persona and local repositories. Preserve source references and full
conversation/context as local artifacts, with bounded background supplied to
the first actual agent request. Treat imported messages and plans as quoted
background, never current approvals or proof of repository state. Do not
resume a sender's provider session, activate a goal, post to a ticket, clone a
repository or start an agent during import. The new thread starts with an
explicit on-request access override; the recipient chooses model and access
before sending. Validate filenames and references, write only app-owned files,
and roll back failed imports without removing unrelated data. Preview builds
remain isolated from OS file/protocol association registration.

### C7: Opt-in automation publication and current-head PR repair

Status: active
Owner project: `mezair-app`

Replace the blanket automation publication ban with an explicit saved
`allowRemotePublishing` choice. Existing definitions default to disabled.
Publication requires repository writes and command execution, remains under
the current provider/persona access ceiling, and covers branches, pull requests
and related review comments in the selected repositories. It does not grant
merge, force-push, branch-deletion or unrelated external-mutation authority.
Carry the instructions into persona, loop, ACP and workflow runs, including
the saved workflow kickoff used after a pause. These instructions express
authorisation for trusted CLI workers; they are not a credential-isolation
boundary or a replacement for provider permissions.
Workflow publication authority is frozen in that run's kickoff. Editing the
automation definition does not revoke a paused workflow's existing grant;
cancel the workflow or narrow its execution access to stop that work.

PR feedback may run automatically with publication enabled. Bind it to the
configured repository and PR, re-read the current provider state, and prepare
an isolated checkout at the verified head. Reject stale, unknown or changed
heads and unsupported fork targets rather than guessing their source. Treat
feedback as task input, never as additional permission. Retain committed
publication checkouts even when their working trees are clean, and suppress
head-change repairs for commits already produced by that automation. Agent
reports and local commits do not establish that publication succeeded.

Owner modules: automation services and persistence, Watchtower sources,
automation shared contracts, database migration 115 and Automations editor.
Verify migration retention, permission defaults and prerequisites, execution
context, PR identity/head races, retained worktrees and feedback suppression;
run desktop typechecks, lint and tests. Live provider publication is separate
acceptance evidence. Full factory intake, durable PR lifecycle control and
policy-based merging remain planned in `mezair-app/docs/plans/software-factories.md`.

### C8: Reviewed software factories and typed source control delivery

Status: implemented; current verification and baseline test failure documented below
Owner project: `mezair-app`

Factory drafting is a bounded foreground utility request: use the selected
provider/model with a medium reasoning budget where supported, and isolate
Codex/Claude data generation from repository tools and ambient project context.
Check for an in-scope delivery repository and compatible saved workflow before
inference; send only a compact workflow catalogue. Organisation choices may use
at most sixty seconds of account-scoped discovery context already loaded by the
editor; never cache authorisation. Validate returned source/workspace/template
and connection identities, and retain fresh save/activation permission checks.
Draft progress and cancellation belong only to the requesting window. A cancelled
or expired request must not replace an editor's newer draft.

A factory is a reviewed typed definition and immutable workflow revision. Saving
or drafting does not activate it. Activation grants standing authority for its
specified source, optional ready label, backlog policy, verification commands,
publication and merge policy;
never derive those permissions from an issue, comment, model output or operator
retry. Source repository identity is immutable. Workflow revisions and expanded
grants apply to future intake; current pauses, account/source revocations and
reductions in merge authority fence active effects. Visibility changes apply to
existing history and require current Mezair membership and factory roles on
all discovery, detail and control paths. Legacy source-checked policies retain
their extra GitHub source permission gate until an owner reviews a migration. Organisation membership alone grants no
repository access or execution identity. Backend WorkOS users, sync accounts and
designated executor enrollments are distinct identity domains.

Persist one issue lifecycle, immutable graph/source evidence, leases, command
observations and operation intent/result receipts. Typed provider writes must
reconcile uncertain outcomes using stable operation keys before retrying. Hold
and renew a fenced run lease across external effects. Guard again after awaits
and immediately before publication or merge. Bind acceptance commands and each
criterion to the exact produced commit/tree, recheck the PR source head and all
required checks/reviews before requesting a merge, and invalidate stale evidence
and head approval after changes. An asynchronous request or queue entry is not a
merge. Observe merge and execute post-merge checks before claiming completion.
Cancellation and takeover remain pending while a merge outcome is unknown;
late acknowledgements must be adopted from receipts even if the run CAS changed.
A merge that wins a cancellation race is irreversible and remains visible as a
merged outcome requiring post-merge verification. Takeover claims/stops the run
before creating a fresh private recipient chat; remote claim correlation never
reuses the executor's private thread ID or local repository IDs as authority.

Factory intake supports GitHub, Azure DevOps, Jira and Linear through a pinned,
credential-free Work Item connection identity and repository/project/team scope.
Legacy definitions continue to read GitHub issues from the delivery repository
using the GitHub CLI. Ready labels/tags are optional: blank means no label gate.
An independent, reviewed `includeExisting` option admits the open backlog; absent
or false preserves intake of items created after first activation. Reconcile
complete bounded connector lists, normalize provider lifecycle states and dates,
and fail rather than advance a cursor over truncated or uncertain results.
The execution clock starts when an item leaves the concurrency queue, is
persisted once and is never renewed by retries. Refresh its issue content and
eligibility before starting the worker.
Deduplicate provider/scope/item identity across connections and retain legacy
GitHub issue keys. Recheck pinned connection scope before and after provider
reads and before current execution effects; changing the UI's active connection
must never redirect a factory. External work item links must never become
unrelated GitHub issue-closing references in PRs.

Delivery supports GitHub and Azure DevOps independently of the work item source.
Canonical `delivery` and `readyLabel` fields replace the GitHub-specific input;
legacy reviewed GitHub records retain their wire shape and fingerprints. Both
adapters share checkout isolation, sealing, secret scanning and verification.
Azure DevOps completion pins `lastMergeSourceCommit`, never bypasses policies,
observes current-iteration checks and required policies, and confirms the merge
commit before post-merge verification. An accepted completion still in progress
cannot be reported as cancelled or completed without provider observation.
Required review approval needs a blocking minimum-reviewer policy that excludes
the PR author and resets approvals on source pushes or requires votes on the
latest/every iteration. Retained PR votes alone do not establish current-head
approval. Reject API continuation pages rather than accepting partial evidence.

Use Git Credential Manager directly for Azure DevOps Git operations when
available. GCM OAuth or Azure CLI sign-in supplies API tokens transiently; no PAT
is required in a factory definition. Disable unattended prompts and credential
traces, pass credential lookup requests over stdin, and keep returned tokens out
of definitions, prompts, argv, receipts, logs and worker environments. Existing
vault-backed PAT connections remain compatible, with GCM/Azure CLI preferred.
Fence network effects again after credential acquisition, immediately before
publication/completion. Repository remote credentials never enter draft prompts.

New organisation factories use explicit `authorization: mezair`: viewing follows
current Mezair organisation membership and factory roles, including an explicit
roster for team/restricted audiences. Provider access belongs to the executor;
viewers need no GitHub/ADO/Jira/Linear credentials. Saving a reviewed policy
revision is the only way to migrate a legacy source-checked factory. Do not
silently widen its historical audience. Registry source identities include
credential-free intake scope; hosted claims use provider-native string IDs and
migration 0009 preserves the pre-existing numeric GitHub claims.

Worker graphs still use isolated local Codex app-server nodes only. Reject
unsupported model provider, remote node or privileged inline
validation configurations before activation. Isolate HOME/CODEX_HOME, retain
only model authentication, disable inherited MCP tools and provider-native
subagents, clamp to the originating/current sandbox and explicitly disable tool
network access. Factory workers cannot invoke main-process validation, delivery,
factory mutation or merge tools. The controller independently seals, scans and
verifies the candidate and performs typed publication/merge. Host reads are not
fully isolated by the provider workspace sandbox; secret-scan the complete
candidate before every publication. Controller candidate sealing disables repo
hooks/signing commands; reviewed sandboxed checks supply verification instead.
Do not weaken C4's separate interactive delivery or C2's Cloud boundaries.

Each saved revision pins a copy of a saved workflow. A revision keeps the
previous pinned graph unless its template changes or the owner explicitly sets
`repinWorkflow` on preview and save; the review confirmation covers the graph
that will be pinned, so a re-pin is reviewed and activated like any other
revision and never alters runs already in progress. Remote revisions refuse to
re-pin or change the graph. `factoryWorkflowIssues` is the one isolation rule for
activation and the renderer's workflow picker. Factory worker threads are named
by `factoryWorkerThreadId`; that name is the provenance key the Workflows view
uses to label factory-started runs and send control back to the factory. The
renderer may save a pinned graph as a new workflow or relink a factory to a
matching saved workflow, but only through a new reviewed revision.

Supported limits are observed shell command count across workers and repairs,
wall-clock duration, concurrency and repair rounds. Reserve acceptance and
post-merge command capacity, meter command-start events, deduplicate observations
and terminate promptly when exhausted. This is not a hard pre-execution command
allowlist or a spend/dollar ceiling. Pin model/persona choices in the graph. The
pure state machine/store can run without Electron; the shipped runtime binding
is the existing trusted Electron automation daemon on a supported, awake host.
Activation must prepare that service successfully and keep it installed while
factory work needs it; no standalone headless server deployment is claimed.

Organisation definitions and runs use recipient-encrypted snapshots. Authorise
and CAS registry metadata separately from encrypted payload claims; only the
designated executor may claim jobs, publish runs or consume commands. Verified
owners/admins revise and activate policies through the authoritative registry.
Current membership/policy gates (plus source gates on legacy policies) and
recipient enrollment govern history rewrap;
never reuse another member's account encryption key. Keep remote source identity
separate from recipient workspace/repository mapping and maintain idempotent,
leased control receipts on both server and executor.

Owner modules: `shared/factories.ts`, `factory-*.service.ts`, factory IPC/preload,
chat tools and renderer, schema migration116, hosted factory registry/access
routes and migration, and the narrow isolated worker/daemon integration.
Verification passed: desktop suite (348 files, 3,177 tests; 4 files and 12 tests
skipped), full Node/web TypeScript checks, lint, production build, hosted backend
suite (43 files, 483 tests) and backend typecheck. `git diff --check` is clean.
No live GitHub write, production migration or deployment was performed or tested.
The workflow re-pin and renderer change re-ran the desktop suite (362 files,
3,335 tests; 4 files and 12 tests skipped), both TypeScript checks, lint and the
production build. Its layouts were checked against the synthetic `?factories`
replay fixture only, not a live factory.

The multi-provider intake and optional-filter change passed the desktop suite
(3,402 tests passed, 12 skipped), both TypeScript checks, lint, production build
and `git diff --check`. The synthetic factory editor was exercised with all four
provider selections, no ready label, backlog on/off and reviewed authority at
desktop and compact widths. Connector pagination/lifecycle, connection scope
changes, cross-source dedupe, overlapping claims, refreshed issue content and
queue-started execution budgets have focused coverage. No live provider write
was performed.

Factory presentation reads use at most four concurrent requests per directory
or non-selected-factory summary batch. Selected-run polling and relative-time
updates pause while the Desktop window is hidden and catch up on return;
polls do not overlap. Navigation invalidates pending presentation responses and
queued reads. These are renderer resource limits only: the daemon continues
authorised execution, and service access checks still govern every read.

Factory presentation now exposes bounded run pages (50 by default, 100 maximum)
and a summary read. Local pages hydrate active runs before terminal history;
SQLite computes local counts without loading receipts. Hosted pages use the
existing authorised `factory.run.list` operation with a factory-bound timestamp/
id cursor and recipient-only encrypted snapshots. Every page rechecks current
membership/source access; paging introduces no execution or publication authority.
Remote summaries describe only the decrypted recent window and set `complete:
false` when history remains. Older backends retain their explicit 100-run window;
the UI labels those counts as recent shared runs. Full run reads remain available
by id, including runs outside that window. No plaintext run-stage index was added
to the hosted backend.

Summary failures retain an independently authorised run page; fallback counts
are incomplete when its cursor indicates more history. Load-more requests and
their errors belong to the selected factory generation, so leaving one factory
releases its presentation guard without affecting another factory's pages.

The dual-provider delivery and Mezair role change passed the full desktop suite
(3,417 passed, 12 skipped), then 70 focused tests after the final current-head
review and continuation guards. Node/web/backend TypeScript checks, lint,
production build and `git diff --check` passed. All 18 hosted factory tests
passed, including migration preservation, role-only access, membership/control
revocation and native issue claim IDs. The full backend suite had 506 passes
and one device-enrollment rate-limit failure in `auth.test.ts`; the same failure
was reproduced in an unchanged HEAD checkout. Synthetic browser checks covered
ADO delivery with Jira intake, no label gate, backlog selection and Mezair
organisation viewing at desktop/compact widths. No live credential exchange,
provider write, production migration or deployment was performed.

Follow-up on 4 November 2026: the enrollment rate-limit test failure is resolved.
Independent hosted-identity test fixtures clear the shared test SessionCoordinator's
cooldown row before changing their fake clock. The production provider gate and
device limits remain unchanged; within-fixture concurrent throttling is still
asserted. All 508 backend tests, backend typecheck, hosted config validation and
34 deployment-isolation checks pass.

Rollout on 1 November 2026: source commit `4c9eb0c0` was pushed to `main`;
migration 0009 was applied to both hosted databases and both backends deployed
through the guarded deployment commands. Staging version
`04d7f76c-7ab5-4d12-ae12-563c95607aa2` and production version
`97d47250-0a6f-4e26-abe9-4cd080285a32` each serve 100% of traffic. Ten live
smoke checks passed per environment, covering descriptor identity, service and
webhook authentication, rejection of cross-environment service credentials,
WorkOS API credentials, the migrated claim schema and recorded deployment.
See `docs/hosted-environment-cutover.md` for the rollout record. Live work item
and source control provider writes were not exercised.

### C9: GitHub Work Item connection identity

GitHub Work Items bind credentials to the selected named connection, independently
of GitHub Code credentials. Preserve encrypted storage and masked settings reads;
never fall back to the general GitHub token. Canonical issue URLs bind host,
repository and issue number; canonical service references reject bare numbers,
mismatched sources and pull requests. Search accepts `42` or `#42` within the
selected connection and resolves them to canonical references. Scope cached
results to connection/source and credential identity.
Explicit review/share publication revalidates its target, retains the existing
pre-publication connection guard and does not retry ambiguous writes. This
connector does not expand C8's factory intake or organisation source permissions.

Owner modules: `github-workitems.service.ts`, Work Item provider/context/settings,
review publication, shared Work Item references, Settings/Work Items UI and schema
migration117, which additively permits GitHub share receipts and preserves old rows.
Verification passed: desktop suite (354 files, 3,203 tests; 4 files and 12 tests
skipped), Node/web TypeScript checks, lint, production build and `git diff --check`.
No live GitHub write, commit or deployment was performed.

### C10: LAN first Mesh route selection and session migration

Status: implemented locally; automated verification passed; physical-device acceptance and deployment pending
Owner project: `mezair-app`

Prefer validated host LAN-address candidates, other private routes, explicit HTTPS
and managed ingress in that order. Route hints never grant trust or weaken URL,
identity, enrollment, endpoint-generation or authorization checks. Cross-machine
clients exclude loopback. Read-only reachability probes carry no account bearer
or admission ticket, use bounded concurrency/deadlines and reserve prompt fallback
capacity. Authenticate one candidate per host at a time with fresh session keys;
close late and abandoned results. No new transport protocol or subnet scanning.

Desktop/daemon and native mobile own stable consumers across active, preparing
and draining connections. Only hosts advertising `machine.stream-handoff/1` can
upgrade proactively. The authenticated subscription completion watermark follows
ordered replay; live events cannot precede subscription. Bound candidate buffers,
recheck current scope/generation/health/demand and stream coverage at promotion,
and deliver each accepted event once. Keep already-sent requests on their original
connection until completion or deadline. Route changes never resend mutations;
uncertain results remain uncertain for operation-specific receipt reconciliation.
Sign-out, account replacement and revocation fence delayed callbacks, pending
responses and advertisements before they can reach a new scope. Final subscriber
release cancels proactive work without interrupting a pending mutation.

Session ownership spans private and managed ingress listeners. Retiring a stale
socket must not erase its replacement's keys; retire abandoned bootstrap records
and authenticated sessions promptly without raising the 64-session cap. Keep
command receipts separate from transient session state. Preserve backend admission
and the existing continuing authorization deadlines; LAN routing is not offline
Mesh and does not grant worker execution.

Monitor local interfaces only while hosting or serving demand. Changed endpoints
publish the latest scoped revision; unchanged samples do not write to the backend.
Account route-change hints contain enrollment IDs only and require the explicit
`machine.routes-changed/1` socket feature opt-in, since old parsers reject unknown
frames. Periodic active-client discovery covers missed hints. Repeated failures
respect dwell/backoff, and background mobile clients cancel network preparation.
`MEZAIR_MESH_ROUTE_UPGRADES=false` disables desktop/daemon upgrades;
`EXPO_PUBLIC_MEZAIR_MESH_ROUTE_UPGRADES=false` does so for a native mobile build.
Neither switch disables ordinary reconnect or changes authorization.

Selected-path UI is sanitized. `Direct` with host LAN-address detail is a preference
hint, not proof of physical LAN routing. iOS uses the maintained local-network
purpose/ATS settings. Android permits private-IP HTTP/WS through maintained Expo
configuration; application URL restrictions, HTTPS broker credentials and encrypted
machine sessions remain mandatory. Generated config and loopback wire tests do
not establish physical permission, LAN latency or native release acceptance.

Owner modules: shared machine route contracts/policy/scheduler, hosted discovery
and account socket hints, Mesh client/runtime/session services, network monitor
and advertisement integration, mobile account/session/network adapters and the
existing connection status surfaces. Verification and outstanding physical cases
are recorded in `mezair-app/docs/plans/sync-mesh/lan-first-connectivity.md`.

### C11: Mezair identity and coordinated namespace cutover

Status: implemented in source; external provisioning and migration pending
Owner projects: Desktop, Cloud, Registry, website

Use Mezair consistently in source identifiers, package names, CLI commands,
protocols, environment variables, paths, documentation and the shared horse-M
artwork. The SVG in `branding/mezair-mark.svg` owns the mark geometry. Keep light
and dark presentation, reduced motion and accessible live text intact.

Public npm packages and private Registry workspace packages use the `@mezair`
scope. Public install surfaces are `@mezair/cli`, `@mezair/cloud-cli` and
`@mezair/registry-cli`; their binaries remain `mezair`, `mezair-cloud` and
`mezair-registry`. Keep workspace imports, scaffolds, Desktop's local file
dependencies, lockfiles, package provenance URLs and release filters consistent.
The npm organization is `mezair`; creation, maintainer authentication and trusted
publishing are external prerequisites, not consequences of renaming source.
Generated Cloud projects resolve their own installed CLI's bundled source before
workspace/global fallbacks. The React starter uses NodeNext-compatible relative
imports and the patched Vite 6 line. The Notes golden path packs and installs the
CLI in isolation, creates a project through that installed binary, installs its
dependencies with scripts disabled, and checks/builds it without workspace aliases.

This is a coordinated breaking identity cutover. Renamed AAD/HKDF/proof contexts,
stored ownership values and message/file namespaces are not a data migration.
Do not weaken validation or silently adopt ciphertext, credentials or databases
from another identity. Startup selects only the Mezair profile and its
`mezair.db`; retained profile directories are never copied and alternate
database filenames are never selected implicitly. Existing Mezair profiles and
explicit development/preview profile selection remain supported. Retain original
profile data. Any future migration needs explicit key custody, export/import
validation and recovery evidence.

Keep the four workspaces independent. Desktop uses the built local CLI package
surfaces; `.github/scripts/prepare-desktop-clis.mjs` prepares them before a
Desktop install. The new domain, repository, package scopes, images, hosted
resources and signing identities require operator-controlled provisioning.
`docs/mezair-identity-cutover.md` records those prerequisites and acceptance
limits. The website uses `https://mezair.dev` as its canonical public origin
and links to the renamed `anthonyhumphreys/mezair` repository. Vercel builds
from `mezair-website` on `main`; the public hostname does not change the
selected WorkOS/backend environment. Preserve every C1–C10 authentication,
custody and evidence boundary.

### C12: Hosted signup admission and subscription access

Waitlist approval admits a verified identity to the paid service; it is not a
subscription entitlement. Before creating a new hosted account, verify the
configured WorkOS client and the exact approved, verified email (or the existing
explicit operator admission). The website may create that admitted account on
its first account/billing request without requiring prior device enrollment.
An account row, sign-in, invitation or checkout redirect never grants hosted
Sync/Mesh writes. Stripe-confirmed subscription/invoice state is authoritative,
including the existing bounded renewal/outage-grace rules. No blanket free beta
grant is created by approval. Retain already-recorded legacy access until its
existing expiry or revocation, without advertising code redemption as signup.

The end of November 2026 is the planned end of closed signup, not the expiry of
a free subscription. Stripe promotion codes can be issued manually and redeemed
inside subscription checkout; do not automatically issue coupons on approval.
Mezair-operated coding agents are a separate fixed monthly add-on, currently
disabled, with their own recurring price and entitlement. The amount and included
usage must be defined before enabling checkout or execution. This compute is not
included in the hosted Sync subscription.

Owner modules: hosted admission/account/billing routes, website account and
checkout surfaces, public signup copy and internal production deployment plan.
Verify pending/unapproved signup denial, approved-but-unsubscribed restrictions,
confirmed payment access and Stripe promotion-code checkout parameters. Live
WorkOS/Stripe acceptance and deployment remain separate from automated tests.

### C13: Isolated Mezair hosted environments

Staging and production use independent Mezair Worker, Durable Object, D1, R2 and
WorkOS identities pinned in the hosted target manifests. The operator authorized
permanent teardown of the preceding Anvil staging resources; no retained staging
account, subscription or encrypted state is imported into the new environments.
Credential values stay outside tracked source and use distinct environment and
service/operator audiences. Keep production credential freshness checks intact.
Production CI compares SHA-256 credential fingerprints from the protected
environment configuration, including individual HMAC values across audiences;
it never needs the staging credential bundle. Refresh that comparison reference
whenever staging credentials rotate. Local deployments may still compare the
independent staging secret source directly. Missing or malformed references fail
closed, and a fingerprint file cannot supply deployable backend credentials.

The Mesh deployment recipe retains the backend source's compatibility flags and
observability settings in generated configurations. Hosted runtime logs redact
query strings. Production deployment is a manual workflow restricted to `main`
and the `mezair-production` environment, with a provider-evidence reference.
Bootstrap deployment keeps checkout, hosted coding agents and managed tunnels
disabled. CI requires explicit protected rollout variables for each environment
and checks required credentials before installing dependencies. Later production
deployments preserve a reviewed saved managed-tunnel opt-in and domain rather
than resetting ingress; enabling it requires the dedicated tunnel secrets and
the existing staging/production credential-isolation checks. A production tunnel
token requires a valid staging tunnel-token fingerprint in both CI preflight and
the deployment wrapper; a core-only bootstrap reference cannot establish token
isolation for managed ingress. Checkout remains
disabled and hosted coding agents stay forced off in these workflows. Admission
approval never substitutes for subscription entitlement.
Managed Tunnel DNS reconciliation must restore proxied CNAMEs even when the
tunnel target already matches; successful allocation cannot leave DNS-only ingress.
WorkOS staging has public signup and its waitlist disabled for internal testing;
production retains waitlist approval.

Owner modules: hosted target manifests and deployment workflows, the Cloudflare
Mesh recipe and hosted Worker configuration. Verify target isolation, generated
runtime settings, migrations, descriptors and signed-channel rejection across
environments. Live bootstrap evidence and remaining operator actions are recorded
in `docs/hosted-environment-cutover.md`; full customer/payment/device acceptance
remains distinct from provisioning.


### C14: Local Claude Code provider

Status: active
Owner projects: `mezair-app`, with public coverage in `mezair-website`

Use the official Anthropic Agent SDK with the user's installed `claude`
executable and local CLI sign-in. The SDK adapter translates into Desktop's
existing agent-client session controls; Claude is not an ACP subprocess.

- `auto` omits the model override and preserves CLI settings. Discover model
  choices through SDK controls without inference; all returned model IDs and
  explicit custom IDs remain selectable. Never impose Haiku or upgrade the
  user's chosen model silently. Switching from a Codex model resets to auto.
- Keep authentication in the local CLI. Return only installed/authenticated
  state and model metadata to the renderer. Do not copy OAuth files or export
  Claude credentials to remote workers. Drop unrelated providers' API keys.
- Preserve persona instructions, queued follow-ups, approvals, user questions,
  streaming text, tool results, successful file-change evidence and cumulative
  usage accounting. Cancellation is interrupted, provider errors are failed.
  Keep Claude sessions attributed to Claude in Dojo and allow its model rates.
  Stop the isolated CLI process group and verify teardown.
- Attach Mezair MCP through SDK stdin configuration with the existing
  session-scoped bearer. Never put it in process arguments or diagnostics.
- Map permission controls to Claude's default, acceptEdits,
  auto, dontAsk, bypassPermissions and plan modes. Auto review depends on the
  installed CLI/account/model and must surface rejection without falling back
  to bypass. Plan mode is not a filesystem sandbox;
  strict read-only personas, sessions and temporary chats remain unavailable.
  Reject these before spawning rather than substituting plan mode. Factory workers,
  browser execution and cloud credential delivery remain on their existing
  provider allowlists. Local workflows and automations use `claude --print`.
- Audit capabilities honestly: native resume uses SDK `resume` on this device;
  cross-device continuation and live MCP connectivity are not claimed verified
  without their own fixtures. Exclude unused SDK-bundled CLI binaries from
  Desktop packages.
- Keep the website's shared provider lists, metadata, installation and workflow
  guides in step with this provider. Its dedicated Claude Code guide must explain
  model selection, CLI defaults, local authentication and current limits.

Verification from `mezair-app/`: run both Desktop TypeScript projects, lint,
`claude-agent-process.test.ts`, the provider/model-picker and agent-client
regression tests, then the Desktop suite and build. Live probes must use
minimal prompts and preserve the user's model preference; the initial
Haiku stream smoke check used a single `OK` response.

### C16: Provider-aware thread access and delegated authority

Status: active
Owner project: `mezair-app`

Keep provider mode mappings in `src/shared/agent-access.ts`. Prefer live ACP
session capabilities, including an explicitly empty list, and reject modes the
provider does not advertise. Ask, Plan, Accept edits and Smart describe native
agent/approval behavior; they must not claim an OS filesystem sandbox. Cursor
Full access auto-approves individual ACP tool permission requests without
persisting an allow-always rule or bypassing provider/organisation denials.
Codex exposes automatic approval review separately from the workspace sandbox;
Claude exposes its native auto-review and allowlist-only controls. Persist these
per-thread approval refinements separately from the four sandbox/access levels.
Translate native Smart/Accept edits before another provider interprets the
transport level; do not turn them into Codex's no-escalation workspace sandbox.
Reject a cross-provider strict workspace-only request that cannot be enforced,
and fence pending proposals if the coordinator's approval settings change.

Carry thread access explicitly on session start, prepared launches and each
normal send. Browser clients compare requested credential access separately
from persona-clamped effective access and reconnect when that request changes.
Normalize inactive startup approval profiles before issuing credentials. Plan
feedback preserves the selected profile while retaining the read-only clamp.
Re-check live workflow settings after asynchronous setup and before turn start.
Changing one thread must not overwrite global defaults or another thread's access.
Use a shared in-memory selection for the chip, ordinary/prepared launches and
sends; localStorage is persistence only. Workspace settings update the same live
default even while chat is unmounted; an older cached default cannot override a
more restrictive workspace default. Explicit thread overrides remain independent. Preserve the source provider when
translating a selection, and require an explicit replacement for an unsupported
profile. Never turn allowlist-only access into default approvals silently.
Invalid display selections stay read-only; remote sends reject invalid or
unsupported profiles and recheck access after asynchronous chat preparation.
Before committing an access change, main retires the thread's provider sessions
and invalidates in-flight starts. Revoke their bearer tokens immediately and
resume the conversation with fresh credentials on the next turn. Bound issued
bearers to their original access ceiling, reauthenticate after receiving request
bytes, and fence approvals against the current bearer, scope and access revision.
Keep requested approval profiles separate from temporary Plan clamps and from
provider-confirmed access. Apply effective changes only after acknowledgement;
rejected controls retain the prior effective authority. The composer identifies
the next-turn selection separately from confirmed provider access.
Reviewed local delegations inherit the coordinator's access unless the task
explicitly requests read-only. Freeze the originating ceiling, recheck it at
approval, preserve persona restrictions, and inherit it for expanded children.
Revalidate worker support after the live ceiling and persona clamps. Reject
unsupported local or remote specialists before inserting any graph children.
Preserve translated approval profiles on saved workflow workers while retaining
their app ceiling. Replay legacy omitted-access fingerprints only for already
saved runs; new fingerprints distinguish omitted and explicit read-only access.
Remote tasks retain their read-only default and target ceilings; current-tracked
review remains strictly read-only. Saved workflows, factories and automations
retain their existing app ceilings. A provider approval mode is not a substitute
for strict read-only execution: Cursor/Devin print workers reject that contract;
Claude print workers retain their read-only tool allowlist with MCP disabled.
These controls apply to Mezair-managed delegation. Provider-native subprocesses
and arbitrary shell-launched CLIs remain subject to the provider's own controls
and inherited process sandbox; do not claim Mezair rewrites their permission flags.

### C15: Consented anonymous website and Desktop statistics

Status: active
Owner projects: `mezair-app`, `mezair-website`

PostHog usage statistics require separate explicit consent. Existing Sentry
crash-reporting consent never grants analytics consent. Desktop migration 118
defaults the local, non-synced statistics flag to off for new and existing users.
Only packaged Desktop builds with configured public ingestion credentials can
send fixed event names and version/platform/architecture properties. Keep local
metric payloads, historic rows, repository/workspace/thread/journey IDs, prompts,
files, paths, credentials and account information local. Rotate the random
analytics ID each launch and on renewed consent; never persist or identify it.
Apply opt-out immediately, abort delivery and discard the pending queue.

The website initializes PostHog only after browser consent and respects DNT/GPC.
Use memory-only identifiers, manual public page views and download platform
labels. Exclude account/auth, artifact share and local review routes, including
when navigating from a public page. Strip queries, fragments, referrers, titles
and SDK-added properties through a fresh allowlist before sending. Keep C6's
share keys out of every analytics path. Disable replay, autocapture, profiles,
surveys and remote feature configuration. Configure tokens/hosts through build
environment values; missing configuration disables collection.

Owners: Desktop `usage-statistics.service.ts`, settings/schema, startup/shutdown
and `metrics.service.ts`; website `instrumentation-client.ts`,
`website-analytics.ts`, `analytics-policy.ts` and `private-analytics.tsx`.
Event definitions and setup are in `mezair-app/docs/analytics.md`.

Verify the Desktop usage-statistics, telemetry, metrics and schema suites, both
TypeScript projects, lint and build. Verify website `test:analytics`, share URL
tests, typecheck and build, plus browser requests before consent, after consent,
after withdrawal and on excluded routes.


### C17: Reviewed local chat checkpoints and hunk actions

Status: active
Owner project: `mezair-app`

Pre-turn checkpoints are best effort and never run a provider or mutate the
user's index, branches or stash. Normal, prepared and queued turns use their
stable user-message/request identity; queued captures happen at delivery, after
the previous turn. Use main-process delivery time when associating delegated
work with queued turns, including after history hydration.

Rewind validates every target and requires a durable undo checkpoint for every
repository before overwriting files. Snapshot initialized submodule working
files recursively, pin their commits in their own Git stores, preserve child
HEAD/index, and remove retained child refs with the parent. Refuse an unavailable
or changed submodule layout and legacy snapshots without child evidence rather
than reporting a false match. Bound nesting and repository count. Capture failures
must not leave orphaned refs. This is local file recovery, not an agent permission
grant or a Git branch reset. Fence concurrent rewinds and managed turns by
canonical checkout paths, including aliases and nested repositories. Recheck
active turns before mutation; releasing the lease is mandatory on failure.
Capture and destructive Git review share the checkout lease with rewind.
Reserve each provider session before asynchronous send preparation so concurrent
idle follow-ups queue in order; release preparation on failure and retain the
authoritative delivery timestamp across retries and later events.
Bind confirmation to the complete current tree, including submodules, and check
it again after saving undo. A changed preview requires a fresh confirmation for
rewind, undo and edit/resend. Persist the exact validated execution checkout;
repair recovery must never fall back to the ordinary checkout. Validate current
thread/repository/workspace membership before preview and restore. Keep Undo
scoped to its source workspace. Before cascaded deletion loses checkpoint rows,
retain local cleanup metadata transactionally and retry unavailable Git-ref
cleanup in the background, including after restart. Never delete a newer ref
that reused a checkpoint name.

Review actions use the repository/status/diff snapshot actually displayed.
Repository switches immediately invalidate actionable files; stale hunk
fingerprints fail closed. Generate apply-compatible literal-path diffs regardless
of user prefix settings, leave executable-bit changes out of content-hunk
patches, and unstage both sides of a rename. Whole-file discard reverses the
reviewed patch and refuses changed contents; disable it while the agent is
working. Keep a failed edited
request and its attachments recoverable; resolve a branch point against complete
history before excluding the edited message. Delegation draft controls belong to
the transcript's thread/run identity and survive turn-list remounts.
Verification operations remain in flight across those remounts and reconcile
their completion through the same shared state. Keep inline edits mounted while
a thread is busy, allow retained attachments without text, and scope failed
composer recovery to its original workspace, thread and persona. Refresh the
current repository after mutations even if a manual refresh raced completion.
Disable Git color for machine-parsed diffs and require whole-file unstaging for
renames. Panel controls always retain one enabled keyboard tab stop.

Recovery scope changes, local/synced workspace deletion and ref cleanup must share
those leases so cascades cannot remove an in-flight undo. Include the provider's
canonical cwd when checking active work, including repo-less workspace sessions.
Checkpoint the provider's immutable repo/path bindings and restart stale sessions
when the thread's repository selection changes. Missing secondary checkouts are
best-effort omissions, never a reason to silently retarget execution or bypass
membership checks. Retain recovery by insertion order, independent of wall clocks.
Schema 122 independently retains child-ref cleanup manifests and backfills legacy
paths before a repository is forgotten. Cleanup batches advance past offline rows.
Bound reviewed Git subprocesses and their filters; branch checkout, creation, pull
and merge share the recovery lease. Force positive diff context, apply untracked
hunks using the same no-index patch, and refuse parent-level submodule discard.
Refresh open Review after recovery and disable hunk discard during active work.
Queue every failed composer action until its own scoped composer acknowledges
applying it. First-message edits use the explicitly created destination thread.
Keyboard arrows begin at the focused enabled option after a panel is toggled off.
Rendered regressions fail on uncaught browser exceptions.

Ordinary sends reserve the provider before checkpoint and local-reply preparation;
queue admission sees that reservation and preparation completion drains or fails
pending work deterministically. Preserve explicit repo-less scaffold and headless
Mesh execution roots while validating repo-bound path cardinality. Current
workspace membership is authoritative at every new content delivery, including
post-acknowledgement ACP prompts, guides, structured feedback, pending answers,
accepted approvals and local output; do not consume a denied pending request.
Keep cancellation available. Resolve explicit provider approval options by their
actual grant, and cancel automatic grants safely after scope removal. Native
stream callbacks retain scope failures for the awaited send rather than throwing
through an EventEmitter. Live MCP context fails closed for detached scope.
Quarantined workspace projection and binding updates commit atomically; lease
contention keeps the sealed update retryable and schedules a bounded retry.
Main-process discard checks overlapping active sessions inside the checkout lease.
Forks and replacement-session startup respect navigation from their source thread.
Recovery acknowledges text separately from attachments, keeps overflow available
without repeating text, and persists current scoped attachment drafts through
composer remounts. Reject a blocked /new instead of clearing its text. Release
pending payloads for destinations the local thread catalogue confirms deleted.

Pin the thread workspace identity at session creation as well as its repository
bindings. A workspace reset that leaves a thread unassigned cannot turn an old
workspace grant into an unrestricted legacy-thread session.

For C17, delegated worker ownership begins before asynchronous startup and lasts
through native process close. Destructive review and rewind reject overlapping
worker paths even if the coordinating chat is idle. POSIX Git timeout cleanup
waits for child and live process-group termination; progressing pulls have a
separate hard/idle deadline. Retire deferred quarantine work with its sync
session. Validate startup content at Codex/ACP dispatch and Claude SDK child
creation, including deferred startup retries. Main commits visible local-model
exchanges before queued continuation capture; temporary history stays in memory.
Composer drafts include workspace identity, and renderer-owned recovery survives
route unmounts and checks both normal and work-item destinations. Completed
optional prefills cannot resurrect removed files or prevent sending. Temporary
navigation invalidates earlier normal-thread creation requests.

The combined model/run-settings panel retains keyboard focus when a run starts
and replaces model selection with locked-state settings. Opening it while busy
focuses an editable setting; Escape closes it and returns focus to the trigger.
