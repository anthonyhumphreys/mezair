import { describe, expect, it } from 'vitest';
import {
  buildAcpPrintInvocation,
  resolveCursorPrintModeArgs,
  resolveDevinCliPermissionMode,
} from '../acp-print-cli.js';
import type { CodexMode } from '../../../shared/types.js';

const WRITING = { approvalPolicy: 'never' as const, sandbox: 'workspace-write' as const };
const READ_ONLY = { approvalPolicy: 'on-request' as const, sandbox: 'read-only' as const };
const FULL = { approvalPolicy: 'never' as const, sandbox: 'danger-full-access' as const };

describe('resolveDevinCliPermissionMode (H7)', () => {
  it('maps Mezair access levels onto real devin --permission-mode values', () => {
    expect(resolveDevinCliPermissionMode('read-only', WRITING)).toBe('auto');
    expect(resolveDevinCliPermissionMode('on-request', WRITING)).toBe('accept-edits');
    expect(resolveDevinCliPermissionMode('workspace-auto', WRITING)).toBe('smart');
    expect(resolveDevinCliPermissionMode('full-access', WRITING)).toBe('dangerous');
  });

  it('a read-only persona clamp wins over a permissive access level', () => {
    expect(resolveDevinCliPermissionMode('full-access', READ_ONLY)).toBe('auto');
    expect(resolveDevinCliPermissionMode('workspace-auto', READ_ONLY)).toBe('auto');
  });

  it('uses only modes the devin CLI accepts', () => {
    const valid = new Set(['auto', 'accept-edits', 'smart', 'dangerous']);
    for (const mode of [
      'read-only',
      'on-request',
      'workspace-auto',
      'full-access',
    ] as CodexMode[]) {
      for (const policy of [WRITING, READ_ONLY, FULL]) {
        expect(valid).toContain(resolveDevinCliPermissionMode(mode, policy));
      }
    }
  });
});

describe('resolveCursorPrintModeArgs', () => {
  it('forces read-only policies into --mode ask', () => {
    expect(resolveCursorPrintModeArgs('workspace-auto', READ_ONLY)).toEqual(['--mode', 'ask']);
    expect(resolveCursorPrintModeArgs('read-only', WRITING)).toEqual(['--mode', 'ask']);
  });

  it('maps workspace-auto and full-access to the matching flags', () => {
    expect(resolveCursorPrintModeArgs('workspace-auto', WRITING)).toEqual(['--auto-review']);
    expect(resolveCursorPrintModeArgs('full-access', FULL)).toEqual(['--force']);
    expect(resolveCursorPrintModeArgs('on-request', WRITING)).toEqual([]);
  });
});

describe('buildAcpPrintInvocation', () => {
  it('runs Claude with a selected model and honors the persona access ceiling', () => {
    const invocation = buildAcpPrintInvocation({
      provider: 'claude',
      model: 'haiku',
      mode: 'full-access',
      policy: READ_ONLY,
      prompt: 'inspect',
    });
    expect(invocation.executable).toBe('claude');
    expect(invocation.args).toContain('haiku');
    expect(invocation.args).toContain('plan');
    expect(invocation.args).toContain('Read,Glob,Grep');
    expect(invocation.args).not.toContain('bypassPermissions');
    const automatic = buildAcpPrintInvocation({
      provider: 'claude',
      model: 'auto',
      mode: 'on-request',
      policy: WRITING,
      prompt: 'inspect',
    });
    expect(automatic.args).not.toContain('--model');
  });
  it('builds a devin --print invocation with the mapped permission mode', () => {
    const { executable, args } = buildAcpPrintInvocation({
      provider: 'devin',
      model: 'swe-2-max',
      mode: 'workspace-auto',
      policy: WRITING,
      prompt: 'do the thing',
    });
    expect(executable).toBe('devin');
    expect(args).toEqual([
      '--print',
      '--permission-mode',
      'smart',
      '--respect-workspace-trust',
      'false',
      '--model',
      'swe-2-max',
      '--',
      'do the thing',
    ]);
  });

  it.each(['cursor', 'devin'] as const)(
    'rejects a read-only %s worker instead of substituting approval mode',
    (provider) => {
      expect(() =>
        buildAcpPrintInvocation({
          provider,
          model: 'auto',
          mode: 'full-access',
          policy: READ_ONLY,
          prompt: 'inspect',
        }),
      ).toThrow('cannot guarantee a read-only sandbox');
    },
  );

  it.each([
    ['claude', 'auto'],
    ['devin', 'smart'],
    ['cursor', '--auto-review'],
  ] as const)('preserves inherited automatic review for %s', (provider, flag) => {
    const invocation = buildAcpPrintInvocation({
      provider,
      mode: 'on-request',
      permissionProfile: 'auto-review',
      policy: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
      prompt: 'inspect',
    });
    expect(invocation.args).toContain(flag);
    expect(invocation.args).not.toContain('--force');
    expect(invocation.args).not.toContain('dangerous');
  });
  it('builds a cursor print invocation with model and mode flags', () => {
    const { executable, args } = buildAcpPrintInvocation({
      provider: 'cursor',
      model: 'claude-fable-5',
      mode: 'workspace-auto',
      policy: WRITING,
      prompt: 'run it',
    });
    expect(executable).toBe('cursor-agent');
    expect(args).toEqual([
      '-p',
      '--output-format',
      'text',
      '--model',
      'claude-fable-5',
      '--auto-review',
      'run it',
    ]);
  });
});
