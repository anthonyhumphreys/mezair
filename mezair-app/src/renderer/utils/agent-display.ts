import type { AgentProvider, CodexEvent } from '../../shared/types';
import { agentProviderLabel } from '../../shared/agent-providers';

export { agentProviderLabel };

/**
 * H13 — provider display labels for user-facing strings.
 *
 * ACP events carry `agentLabel` stamped by the protocol layer ('Cursor',
 * 'Devin'). Codex-family events leave it undefined; callers that only have an
 * event should use `agentEventLabel`, and callers that also know the session
 * provider can use `agentProviderLabel` for a stronger fallback.
 *
 * Display label for the agent that produced an event — prefers the stamped
 * `agentLabel`, then the session provider, then a generic 'Agent'.
 */
export function agentEventLabel(
  event: Pick<CodexEvent, 'agentLabel'>,
  provider?: AgentProvider,
): string {
  return event.agentLabel ?? agentProviderLabel(provider) ?? 'Agent';
}
