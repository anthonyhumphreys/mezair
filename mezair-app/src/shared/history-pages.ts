import type { ChatMessage } from './types';

export interface ChatHistoryCursor {
  threadId: string;
  timestamp: string;
  rowId: number;
  snapshotRowId: number;
  temporaryId?: string;
}
export interface ChatHistoryPageRequest {
  threadId: string;
  before?: ChatHistoryCursor | null;
  limit?: number;
}
export interface ChatHistoryPage {
  messages: ChatMessage[];
  before: ChatHistoryCursor | null;
}
