/** Compact timestamps for chat messages and the thread list. */

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "14:32", "Yesterday 14:32", "3 Nov 14:32", or "3 Nov 2025" for older years. */
export function formatMessageTime(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const current = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(date, current)) return time;
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${time}`;
  if (date.getFullYear() === current.getFullYear()) {
    return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
  }
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "now", "4m", "2h", "3d", "5w" — for dense rows. */
export function formatShortAgo(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** "42s", "4m 05s", "1h 12m" — elapsed time for live work. */
export function formatElapsed(fromIso: string | undefined, now = Date.now()): string | null {
  if (!fromIso) return null;
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
