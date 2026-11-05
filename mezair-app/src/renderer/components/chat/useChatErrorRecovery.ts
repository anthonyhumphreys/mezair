import { useCallback, useMemo } from 'react';
import type { AgentProvider, ChatAttachment } from '../../../shared/types';
import type { ChatEntry } from '../../contexts/ChatContext';
import type { ChatModelOption } from '../../utils/chat-model-options';
import { MODEL_PROVIDER_LABELS } from '../../utils/model-picker';
import type { ChatErrorProviderOption } from './ChatErrorNotice';

/**
 * CH5 — recovery wiring for ChatErrorNotice, extracted from ChatView.
 * Recovery stages the last prompt in the composer for review; it never
 * resends a command after a partial or uncertain run.
 */
export function useChatErrorRecovery({
  entries,
  modelOptions,
  modelProvider,
  onReusePrompt,
  onModelChange,
}: {
  entries: ChatEntry[];
  modelOptions: ChatModelOption[];
  modelProvider: AgentProvider;
  onReusePrompt?: (message: string, attachments?: ChatAttachment[]) => void;
  onModelChange: (model: string, provider: AgentProvider) => void;
}) {
  const onRetry = useCallback(() => {
    const lastUser = [...entries].reverse().find((entry) => entry.kind === 'user');
    if (lastUser?.kind === 'user') {
      onReusePrompt?.(lastUser.content, lastUser.attachments ?? []);
    }
  }, [entries, onReusePrompt]);

  const onSwitchProvider = useCallback(
    (provider: AgentProvider) => {
      const option = modelOptions.find((item) => item.provider === provider);
      if (option) onModelChange(option.id, provider);
    },
    [modelOptions, onModelChange],
  );

  const providers = useMemo<ChatErrorProviderOption[]>(() => {
    const seen = new Set<AgentProvider>();
    const options: ChatErrorProviderOption[] = [];
    for (const option of modelOptions) {
      if (seen.has(option.provider) || option.provider === modelProvider) continue;
      seen.add(option.provider);
      options.push({ provider: option.provider, label: MODEL_PROVIDER_LABELS[option.provider] });
    }
    return options;
  }, [modelOptions, modelProvider]);

  return { providers, onRetry, retryLabel: 'Reuse prompt', onSwitchProvider };
}
