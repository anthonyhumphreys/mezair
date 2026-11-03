import type { ChatHistoryPageRequest, ChatHistoryPage } from '../../shared/history-pages.js';
import type { ChatMessage } from '../../shared/types.js';
import { getDb } from '../db/database.js';
import {
  isTemporaryChatThread,
  loadChatHistory,
  parseChatEvent,
  parseAttachments,
} from './chat-persistence.service.js';

/** Bounded keyset reads preserve full-history ordering, including timestamp ties. */
export function loadChatHistoryPage(request: ChatHistoryPageRequest): ChatHistoryPage {
  if (
    !request ||
    typeof request.threadId !== 'string' ||
    !request.threadId ||
    request.threadId.length > 200
  )
    throw new Error('Invalid history thread.');
  const limit = request.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('History page limit must be between 1 and 200.');
  const before = request.before;
  if (
    before &&
    (before.threadId !== request.threadId ||
      typeof before.timestamp !== 'string' ||
      before.timestamp.length > 100 ||
      !Number.isSafeInteger(before.rowId) ||
      before.rowId < 0 ||
      !Number.isSafeInteger(before.snapshotRowId) ||
      before.snapshotRowId < 0)
  )
    throw new Error('Invalid history cursor.');
  if (isTemporaryChatThread(request.threadId)) {
    const messages = loadChatHistory(request.threadId);
    const end = before?.temporaryId
      ? messages.findIndex((message) => message.id === before.temporaryId)
      : messages.length;
    if (end < 0) throw new Error('History cursor is no longer available.');
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    return {
      messages: page,
      before:
        start > 0
          ? {
              threadId: request.threadId,
              timestamp: page[0].timestamp,
              rowId: start,
              snapshotRowId: messages.length,
              temporaryId: page[0].id,
            }
          : null,
    };
  }
  const db = getDb();
  const snapshotRowId =
    before?.snapshotRowId ??
    (
      db
        .prepare('SELECT coalesce(max(rowid),0) AS last FROM chat_messages WHERE thread_id=?')
        .get(request.threadId) as { last: number }
    ).last;
  const rows = db
    .prepare(
      `SELECT rowid AS sequence,id,role,content,attachments_json,timestamp,persona_id,session_id,thread_id,repo_id,event_json FROM chat_messages WHERE thread_id=? AND rowid<=? ${before ? 'AND (timestamp<? OR (timestamp=? AND rowid<?))' : ''} ORDER BY timestamp DESC,rowid DESC LIMIT ?`,
    )
    .all(
      request.threadId,
      snapshotRowId,
      ...(before ? [before.timestamp, before.timestamp, before.rowId] : []),
      limit + 1,
    ) as Array<{
    sequence: number;
    id: string;
    role: ChatMessage['role'];
    content: string;
    attachments_json: string | null;
    timestamp: string;
    persona_id: string | null;
    session_id: string | null;
    thread_id: string | null;
    repo_id: string | null;
    event_json: string | null;
  }>;
  const more = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    messages: page.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      event: parseChatEvent(row.event_json),
      personaId: row.persona_id ?? undefined,
      sessionId: row.session_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      repoContext: row.repo_id ?? undefined,
      attachments: parseAttachments(row.attachments_json),
    })),
    before:
      more && page.length
        ? {
            threadId: request.threadId,
            timestamp: page[0].timestamp,
            rowId: page[0].sequence,
            snapshotRowId,
          }
        : null,
  };
}
