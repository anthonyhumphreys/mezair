import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_ACCESS_LEVELS,
  readThreadAccessStore,
  writeThreadAccessStore,
  resolveThreadAccessSelection,
  resolveThreadAccessForDisplay,
  remoteThreadAccessError,
  beginThreadAccessChange,
  awaitThreadAccessChange,
  assertThreadAccessReady,
  chatAccessLevelIsElevated,
  chatAccessLevelLabel,
  chatAccessLevelRequiresConfirm,
  chatAccessLevelShortLabel,
  chatAccessOptionSelected,
  chatAccessOptionsForProvider,
  chatAppliedModeLabel,
  expectedAcpAppliedMode,
  isChatAccessLevel,
  markAccessLevelApplied,
  reconcileThreadAccessStore,
  resolveChatAccessChipLabel,
  resolveThreadAccessLevel,
  resolveThreadPermissionProfile,
  setThreadAccessLevel,
  type ThreadAccessStore,
} from '../thread-access';

describe('chatAccessLevelLabel', () => {
  it('maps every codex mode to the CH1 user-facing label', () => {
    expect(chatAccessLevelLabel('read-only')).toBe('Read only');
    expect(chatAccessLevelLabel('on-request')).toBe('Ask for extra access');
    expect(chatAccessLevelLabel('workspace-auto')).toBe('Auto in workspace');
    expect(chatAccessLevelLabel('full-access')).toBe('Full access');
  });

  it('covers every level in CHAT_ACCESS_LEVELS', () => {
    for (const level of CHAT_ACCESS_LEVELS) {
      expect(chatAccessLevelLabel(level)).toBeTruthy();
      expect(chatAccessLevelShortLabel(level)).toBeTruthy();
    }
  });
});

describe('chatAccessLevelIsElevated', () => {
  it('flags auto-approve and full-access as elevated', () => {
    expect(chatAccessLevelIsElevated('workspace-auto')).toBe(true);
    expect(chatAccessLevelIsElevated('full-access')).toBe(true);
  });

  it('treats read-only and on-request as neutral', () => {
    expect(chatAccessLevelIsElevated('read-only')).toBe(false);
    expect(chatAccessLevelIsElevated('on-request')).toBe(false);
  });
});

describe('chatAccessLevelRequiresConfirm', () => {
  it('only requires confirmation for full access', () => {
    expect(chatAccessLevelRequiresConfirm('full-access')).toBe(true);
    expect(chatAccessLevelRequiresConfirm('workspace-auto')).toBe(false);
    expect(chatAccessLevelRequiresConfirm('on-request')).toBe(false);
    expect(chatAccessLevelRequiresConfirm('read-only')).toBe(false);
  });
});

describe('isChatAccessLevel', () => {
  it('accepts valid levels and rejects anything else', () => {
    expect(isChatAccessLevel('full-access')).toBe(true);
    expect(isChatAccessLevel('yolo')).toBe(false);
    expect(isChatAccessLevel(undefined)).toBe(false);
    expect(isChatAccessLevel(4)).toBe(false);
  });
});

describe('resolveThreadAccessLevel', () => {
  const store: ThreadAccessStore = {
    defaultLevel: 'on-request',
    appliedLevel: 'on-request',
    threads: { 'thread-1': 'workspace-auto' },
  };

  it('returns the per-thread override when present', () => {
    expect(resolveThreadAccessLevel(store, 'thread-1')).toBe('workspace-auto');
  });

  it('keeps a picked-up thread at on-request even when its workspace default is elevated', () => {
    const pickedUp = setThreadAccessLevel(store, 'picked-up-thread', 'on-request');

    expect(resolveThreadAccessLevel(pickedUp, 'picked-up-thread', 'full-access')).toBe(
      'on-request',
    );
  });

  it('falls back to the workspace default for unknown threads', () => {
    expect(resolveThreadAccessLevel(store, 'thread-2')).toBe('on-request');
    expect(resolveThreadAccessLevel(store, null)).toBe('on-request');
  });

  it('falls back to on-request without a store', () => {
    expect(resolveThreadAccessLevel(null, 'thread-1')).toBe('on-request');
  });
});

describe('setThreadAccessLevel', () => {
  const base: ThreadAccessStore = {
    defaultLevel: 'on-request',
    appliedLevel: null,
    threads: {},
  };

  it('records a per-thread override', () => {
    const next = setThreadAccessLevel(base, 't1', 'full-access');
    expect(next.threads.t1).toBe('full-access');
    expect(base.threads.t1).toBeUndefined();
  });

  it('updates the default when there is no thread', () => {
    const next = setThreadAccessLevel(base, null, 'read-only');
    expect(next.defaultLevel).toBe('read-only');
  });
});

describe('native permission profile persistence', () => {
  it('keeps approval controls on their thread and resets them when an access level changes', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'on-request',
      appliedLevel: null,
      defaultProfile: 'auto-review',
      threads: { first: 'on-request', second: 'on-request' },
      profiles: { first: 'auto-review' },
    };
    expect(resolveThreadPermissionProfile(store, 'first')).toBe('auto-review');
    expect(resolveThreadPermissionProfile(store, 'second')).toBe('default');
    expect(
      resolveThreadPermissionProfile(setThreadAccessLevel(store, 'first', 'full-access'), 'first'),
    ).toBe('default');
  });
});

describe('reconcileThreadAccessStore', () => {
  it('keeps the store when settings match what we applied', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'read-only',
      appliedLevel: 'read-only',
      threads: {},
    };
    expect(reconcileThreadAccessStore(store, 'read-only')).toBe(store);
  });

  it('adopts an externally changed settings value as the default', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'on-request',
      appliedLevel: 'on-request',
      threads: { t1: 'full-access' },
    };
    const next = reconcileThreadAccessStore(store, 'workspace-auto');
    expect(next.defaultLevel).toBe('workspace-auto');
    expect(next.threads.t1).toBe('full-access');
  });
});

describe('markAccessLevelApplied', () => {
  it('records the applied level without mutating overrides', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'on-request',
      appliedLevel: null,
      threads: { t1: 'read-only' },
    };
    const next = markAccessLevelApplied(store, 'read-only');
    expect(next.appliedLevel).toBe('read-only');
    expect(next.threads.t1).toBe('read-only');
  });
});

// ---------------------------------------------------------------------------
// H9 — provider-truthful access options
// ---------------------------------------------------------------------------

describe('chatAccessOptionsForProvider', () => {
  it('returns the four CodexMode levels for Codex-family providers', () => {
    const options = chatAccessOptionsForProvider('codex').filter((o) => !o.permissionProfile);
    expect(options.map((option) => option.level)).toEqual([
      'read-only',
      'on-request',
      'workspace-auto',
      'full-access',
    ]);
    expect(options.every((option) => option.appliedMode === undefined)).toBe(true);
  });

  it('returns Cursor modes ask/agent/plan mapped to transport levels', () => {
    const options = chatAccessOptionsForProvider('cursor');
    expect(options.map((option) => option.appliedMode)).toEqual(['ask', 'agent', 'plan', 'agent']);
    expect(options[0].level).toBe('read-only');
    expect(options[1].level).toBe('on-request');
    expect(options[2].collaborationMode).toBe('plan');
    expect(options[2].level).toBeNull();
  });

  it('returns the full Devin mode list including smart and bypass', () => {
    const options = chatAccessOptionsForProvider('devin');
    expect(options.map((option) => option.appliedMode)).toEqual([
      'ask',
      'accept-edits',
      'smart',
      'bypass',
      'plan',
    ]);
    expect(options.find((option) => option.appliedMode === 'bypass')?.elevated).toBe(true);
    expect(options.find((option) => option.appliedMode === 'smart')?.level).toBe('workspace-auto');
  });

  it('does not replace an explicitly empty capability list with defaults', () => {
    expect(chatAccessOptionsForProvider('devin', [])).toEqual([]);
  });
  it.each(['claude', 'cursor', 'devin'] as const)(
    'never claims that %s Ask or Plan is a strict sandbox',
    (provider) => {
      const options = chatAccessOptionsForProvider(provider);
      expect(options.find((o) => o.appliedMode === 'plan')?.description).toContain(
        'not a filesystem sandbox',
      );
      const ask = options.find((o) => o.appliedMode === 'ask');
      if (ask) expect(ask.disabledReason).toContain('Strict read-only');
    },
  );
  it('distinguishes Cursor Full access from Agent even though both use agent mode', () => {
    const options = chatAccessOptionsForProvider('cursor');
    expect(resolveChatAccessChipLabel(options, 'full-access', 'agent')).toBe('Full access');
    expect(options.filter((o) => chatAccessOptionSelected(o, 'full-access', 'agent'))).toHaveLength(
      1,
    );
  });
  it('offers provider-native approval refinements separately from sandbox authority', () => {
    expect(
      chatAccessOptionsForProvider('codex').find((o) => o.permissionProfile === 'auto-review'),
    ).toMatchObject({ level: 'on-request', label: 'Approve for me' });
    const claude = chatAccessOptionsForProvider('claude');
    expect(claude.find((o) => o.appliedMode === 'accept-edits')?.permissionProfile).toBe(
      'accept-edits',
    );
    expect(claude.find((o) => o.appliedMode === 'auto')?.permissionProfile).toBe('auto-review');
    expect(claude.find((o) => o.appliedMode === 'dont-ask')?.permissionProfile).toBe('dont-ask');
  });
  it('honours a session-advertised accessModes subset and drops unknown ids', () => {
    const options = chatAccessOptionsForProvider('devin', ['ask', 'bogus-mode']);
    expect(options.map((option) => option.appliedMode)).toEqual(['ask']);
  });
});

describe('expectedAcpAppliedMode', () => {
  it('is undefined for Codex-family providers', () => {
    expect(expectedAcpAppliedMode('codex', 'full-access')).toBeUndefined();
    expect(expectedAcpAppliedMode(undefined, 'full-access')).toBeUndefined();
  });

  it('maps Devin levels onto accept-edits/smart/bypass', () => {
    expect(expectedAcpAppliedMode('devin', 'read-only')).toBe('ask');
    expect(expectedAcpAppliedMode('devin', 'on-request')).toBe('accept-edits');
    expect(expectedAcpAppliedMode('devin', 'workspace-auto')).toBe('smart');
    expect(expectedAcpAppliedMode('devin', 'full-access')).toBe('bypass');
  });

  it('collapses Cursor levels onto ask/agent', () => {
    expect(expectedAcpAppliedMode('cursor', 'read-only')).toBe('ask');
    expect(expectedAcpAppliedMode('cursor', 'full-access')).toBe('agent');
  });

  it('plan collaboration mode wins over the level', () => {
    expect(expectedAcpAppliedMode('devin', 'full-access', 'plan')).toBe('plan');
    expect(expectedAcpAppliedMode('cursor', 'on-request', 'plan')).toBe('plan');
  });

  it('clamps to read-only when the persona cannot write files', () => {
    expect(expectedAcpAppliedMode('devin', 'full-access', 'default', false)).toBe('ask');
  });
});

describe('chatAppliedModeLabel', () => {
  it('labels ACP mode ids and ignores Codex internals', () => {
    expect(chatAppliedModeLabel('ask')).toBe('Ask');
    expect(chatAppliedModeLabel('accept-edits')).toBe('Accept edits');
    expect(chatAppliedModeLabel('smart')).toBe('Smart');
    expect(chatAppliedModeLabel('bypass')).toBe('Full access');
    expect(chatAppliedModeLabel('plan')).toBe('Plan');
    expect(chatAppliedModeLabel('workspace-write')).toBeNull();
  });
});

describe('chatAccessOptionSelected / resolveChatAccessChipLabel', () => {
  const devinOptions = chatAccessOptionsForProvider('devin');

  it('prefers the applied provider mode over the stored level', () => {
    const smart = devinOptions.find((option) => option.appliedMode === 'smart')!;
    const bypass = devinOptions.find((option) => option.appliedMode === 'bypass')!;
    // Stored level says full-access but the provider applied 'smart'.
    expect(chatAccessOptionSelected(smart, 'full-access', 'smart')).toBe(true);
    expect(chatAccessOptionSelected(bypass, 'full-access', 'smart')).toBe(false);
  });

  it('falls back to level matching when no applied mode is known', () => {
    const ask = devinOptions.find((option) => option.appliedMode === 'ask')!;
    expect(chatAccessOptionSelected(ask, 'read-only')).toBe(true);
    expect(chatAccessOptionSelected(ask, 'full-access')).toBe(false);
  });

  it('labels the chip with the applied mode when it differs', () => {
    expect(resolveChatAccessChipLabel(devinOptions, 'full-access', 'smart')).toBe('Smart');
    expect(resolveChatAccessChipLabel(devinOptions, 'on-request', 'accept-edits')).toBe(
      'Accept edits',
    );
    expect(resolveChatAccessChipLabel(devinOptions, 'on-request')).toBe('Accept edits');
  });

  it('labels plan mode from either the option or the applied id', () => {
    const cursorOptions = chatAccessOptionsForProvider('cursor');
    expect(resolveChatAccessChipLabel(cursorOptions, 'on-request', 'plan')).toBe('Plan');
  });
});

describe('current access authority', () => {
  it('displays read-only and blocks remote sends when a saved restriction cannot translate', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'on-request',
      defaultSelected: true,
      defaultProfile: 'dont-ask',
      defaultProvider: 'claude',
      appliedLevel: null,
      threads: {},
    };
    const display = resolveThreadAccessForDisplay(store, 'thread', 'full-access', 'codex');
    expect(display).toMatchObject({
      mode: 'read-only',
      permissionProfile: 'default',
      selectionError: expect.any(String),
    });
    expect(remoteThreadAccessError({ accessError: display.selectionError })).toContain(
      'allowlist-only',
    );
    expect(remoteThreadAccessError({ permissionProfile: 'default' })).toBeUndefined();
    expect(
      remoteThreadAccessError({ permissionMode: 'read-only', permissionProfile: 'auto-review' }),
    ).toBeUndefined();
  });
  it('blocks remote sends during access changes and for profiles the remote contract cannot carry', () => {
    expect(remoteThreadAccessError({ accessChanging: true })).toContain('changing');
    expect(remoteThreadAccessError({ permissionProfile: 'dont-ask' })).toContain('cannot preserve');
    expect(remoteThreadAccessError({ permissionProfile: 'auto-review' })).toContain(
      'cannot preserve',
    );
  });

  it('retains an explicit empty-thread reduction while a workspace default prop is stale', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'read-only',
      defaultSelected: true,
      appliedLevel: 'read-only',
      threads: {},
    };
    expect(resolveThreadAccessSelection(store, 'new-thread', 'full-access', 'codex').mode).toBe(
      'read-only',
    );
    expect(reconcileThreadAccessStore(store, 'full-access')).toBe(store);
  });
  it('drains another transition begun while a send is waiting', async () => {
    let releaseFirst!: () => void;
    let releaseNext!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const nextGate = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const first = beginThreadAccessChange('drain', 'thread', () => firstGate);
    let second!: Promise<void>;
    void first.then(() => {
      second = beginThreadAccessChange('drain', null, () => nextGate);
    });
    let sent = false;
    const waiting = awaitThreadAccessChange('drain', 'thread').then(() => {
      sent = true;
    });
    releaseFirst();
    await first;
    await Promise.resolve();
    expect(sent).toBe(false);
    expect(() => assertThreadAccessReady('drain', 'thread')).toThrow('changing');
    releaseNext();
    await second;
    await waiting;
    expect(() => assertThreadAccessReady('drain', 'thread')).not.toThrow();
  });

  it('keeps the current reduction when persistence rejects the write', () => {
    const old = JSON.stringify({ defaultLevel: 'full-access', appliedLevel: null, threads: {} });
    vi.stubGlobal('localStorage', {
      getItem: () => old,
      setItem: () => {
        throw new Error('quota');
      },
    });
    try {
      const initial = readThreadAccessStore('storage-failure');
      writeThreadAccessStore(
        'storage-failure',
        setThreadAccessLevel(initial, 'thread', 'read-only'),
      );
      expect(
        resolveThreadAccessSelection(
          readThreadAccessStore('storage-failure'),
          'thread',
          undefined,
          'codex',
        ).mode,
      ).toBe('read-only');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('never broadens Claude allowlist-only access when switching to Codex', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'on-request',
      defaultProfile: 'dont-ask',
      defaultProvider: 'claude',
      appliedLevel: null,
      threads: {},
    };
    expect(() => resolveThreadAccessSelection(store, 'thread', undefined, 'codex')).toThrow(
      'allowlist-only',
    );
  });
  it('translates Smart into automatic approval review when switching to Codex', () => {
    const store: ThreadAccessStore = {
      defaultLevel: 'workspace-auto',
      defaultProvider: 'devin',
      appliedLevel: null,
      threads: {},
    };
    expect(resolveThreadAccessSelection(store, 'thread', undefined, 'codex')).toEqual({
      mode: 'on-request',
      permissionProfile: 'auto-review',
    });
  });
  it('blocks a send until main has fenced the old access and the current selection is committed', async () => {
    let revoke!: () => void;
    const revocation = new Promise<void>((resolve) => {
      revoke = resolve;
    });
    let sent = false;
    const change = beginThreadAccessChange('fence', 'thread', async () => {
      await revocation;
      writeThreadAccessStore('fence', {
        defaultLevel: 'read-only',
        appliedLevel: null,
        threads: {},
      });
    });
    const sending = awaitThreadAccessChange('fence', 'thread').then(() => {
      sent = true;
    });
    await Promise.resolve();
    expect(sent).toBe(false);
    revoke();
    await change;
    await sending;
    expect(
      resolveThreadAccessSelection(readThreadAccessStore('fence'), 'thread', undefined, 'codex')
        .mode,
    ).toBe('read-only');
  });
});
