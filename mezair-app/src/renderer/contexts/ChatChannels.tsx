import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ChatContextValue } from './ChatContext';
type ModelValue = Pick<
  ChatContextValue,
  | 'model'
  | 'modelProvider'
  | 'modelOptions'
  | 'modelPickerPreferences'
  | 'reasoningLevel'
  | 'reasoningOptions'
  | 'collaborationMode'
  | 'setModel'
  | 'setReasoningLevel'
  | 'setCollaborationMode'
>;
const ModelContext = createContext<ModelValue | null>(null);
export function useChatModel(): ModelValue {
  const value = useContext(ModelContext);
  if (!value) throw Error('useChatModel requires ChatProvider');
  return value;
}
type ArtifactsValue = Pick<
  ChatContextValue,
  'activeArtifacts' | 'discardArtifact' | 'shareArtifact' | 'unshareArtifact'
>;
const ArtifactsContext = createContext<ArtifactsValue | null>(null);
export function useChatArtifacts(): ArtifactsValue {
  const value = useContext(ArtifactsContext);
  if (!value) throw Error('useChatArtifacts requires ChatProvider');
  return value;
}
type ExecutionValue = Pick<
  ChatContextValue,
  'session' | 'busy' | 'liveThreadStatuses' | 'activePlan' | 'agentUIIntents' | 'activeGoal'
>;
const ExecutionContext = createContext<ExecutionValue | null>(null);
export function useChatExecution(): ExecutionValue {
  const value = useContext(ExecutionContext);
  if (!value) throw Error('useChatExecution requires ChatProvider');
  return value;
}
type CommandsValue = Pick<
  ChatContextValue,
  | 'send'
  | 'steer'
  | 'followUp'
  | 'startSideQuestion'
  | 'returnFromSideQuestion'
  | 'switchPersona'
  | 'interrupt'
  | 'stopSession'
  | 'invalidateThreadAccess'
  | 'startNewSession'
  | 'ensureChatThread'
>;
const CommandsContext = createContext<CommandsValue | null>(null);
export function useChatCommands(): CommandsValue {
  const value = useContext(CommandsContext);
  if (!value) throw Error('useChatCommands requires ChatProvider');
  return value;
}
export type ChatChannelsValue = ModelValue & ArtifactsValue & ExecutionValue & CommandsValue;
/** Text bytes stay outside channels used by controls and unrelated views. */
export function ChatStateChannels({
  value,
  children,
}: {
  value: ChatChannelsValue;
  children: ReactNode;
}) {
  const model = useMemo<ModelValue>(
    () => ({
      model: value.model,
      modelProvider: value.modelProvider,
      modelOptions: value.modelOptions,
      modelPickerPreferences: value.modelPickerPreferences,
      reasoningLevel: value.reasoningLevel,
      reasoningOptions: value.reasoningOptions,
      collaborationMode: value.collaborationMode,
      setModel: value.setModel,
      setReasoningLevel: value.setReasoningLevel,
      setCollaborationMode: value.setCollaborationMode,
    }),
    [
      value.model,
      value.modelProvider,
      value.modelOptions,
      value.modelPickerPreferences,
      value.reasoningLevel,
      value.reasoningOptions,
      value.collaborationMode,
      value.setModel,
      value.setReasoningLevel,
      value.setCollaborationMode,
    ],
  );
  const artifacts = useMemo<ArtifactsValue>(
    () => ({
      activeArtifacts: value.activeArtifacts,
      discardArtifact: value.discardArtifact,
      shareArtifact: value.shareArtifact,
      unshareArtifact: value.unshareArtifact,
    }),
    [value.activeArtifacts, value.discardArtifact, value.shareArtifact, value.unshareArtifact],
  );
  const execution = useMemo<ExecutionValue>(
    () => ({
      session: value.session,
      busy: value.busy,
      liveThreadStatuses: value.liveThreadStatuses,
      activePlan: value.activePlan,
      agentUIIntents: value.agentUIIntents,
      activeGoal: value.activeGoal,
    }),
    [
      value.session,
      value.busy,
      value.liveThreadStatuses,
      value.activePlan,
      value.agentUIIntents,
      value.activeGoal,
    ],
  );
  const commands = useMemo<CommandsValue>(
    () => ({
      send: value.send,
      steer: value.steer,
      followUp: value.followUp,
      startSideQuestion: value.startSideQuestion,
      returnFromSideQuestion: value.returnFromSideQuestion,
      switchPersona: value.switchPersona,
      interrupt: value.interrupt,
      stopSession: value.stopSession,
      invalidateThreadAccess: value.invalidateThreadAccess,
      startNewSession: value.startNewSession,
      ensureChatThread: value.ensureChatThread,
    }),
    [
      value.send,
      value.steer,
      value.followUp,
      value.startSideQuestion,
      value.returnFromSideQuestion,
      value.switchPersona,
      value.interrupt,
      value.stopSession,
      value.invalidateThreadAccess,
      value.startNewSession,
      value.ensureChatThread,
    ],
  );
  return (
    <ModelContext.Provider value={model}>
      <ArtifactsContext.Provider value={artifacts}>
        <ExecutionContext.Provider value={execution}>
          <CommandsContext.Provider value={commands}>{children}</CommandsContext.Provider>
        </ExecutionContext.Provider>
      </ArtifactsContext.Provider>
    </ModelContext.Provider>
  );
}
