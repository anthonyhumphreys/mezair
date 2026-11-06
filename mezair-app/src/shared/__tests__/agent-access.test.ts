import { describe, expect, it } from 'vitest';
import {
  advertisedAccessModes,
  providerAccessMode,
  workflowAccessMode,
  portableAgentAccess,
  inheritedPermissionProfile,
} from '../agent-access';
import { ACP_AGENT_PROVIDERS } from '../agent-providers';

describe('provider access contracts', () => {
  it('never translates native Smart or Accept edits into Codex no-escalation sandbox authority', () => {
    expect(portableAgentAccess('devin', 'workspace-auto')).toEqual({
      mode: 'on-request',
      permissionProfile: 'auto-review',
    });
    expect(portableAgentAccess('claude', 'workspace-auto')).toEqual({
      mode: 'on-request',
      permissionProfile: 'accept-edits',
    });
    expect(portableAgentAccess('codex', 'workspace-auto')).toEqual({
      mode: 'workspace-auto',
      permissionProfile: 'default',
    });
    expect(() => inheritedPermissionProfile('codex', 'dont-ask')).toThrow('cannot inherit');
  });
  it.each(ACP_AGENT_PROVIDERS)('%s keeps planning separate from tool approval', (provider) => {
    expect(providerAccessMode(provider, 'full-access', 'plan')).toBe('plan');
    expect(providerAccessMode(provider, 'on-request', 'plan')).toBe('plan');
  });
  it('honours the reviewed chat override while retaining the ceiling for saved workflows', () => {
    expect(workflowAccessMode('full-access', 'on-request', true)).toBe('full-access');
    expect(workflowAccessMode('read-only', 'full-access')).toBe('read-only');
    expect(workflowAccessMode(undefined, 'workspace-auto')).toBe('workspace-auto');
    expect(workflowAccessMode('full-access', 'on-request')).toBe('on-request');
  });
  it('keeps missing and explicitly empty capability responses distinct', () => {
    expect(advertisedAccessModes({})).toBeUndefined();
    expect(advertisedAccessModes({ modes: { availableModes: [] } })).toEqual([]);
    expect(
      advertisedAccessModes({ modes: { availableModes: [{ id: 'smart' }, null, { id: 1 }] } }),
    ).toEqual(['smart']);
  });
});
