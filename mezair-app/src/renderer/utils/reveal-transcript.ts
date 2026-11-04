export const REVEAL_TRANSCRIPT_EVENT = 'mezair:reveal-transcript';
export interface RevealTranscriptRequest {
  turnKey?: string;
  surfaceId?: string;
  requestId?: string;
  after?: () => void;
}
export function revealTranscriptItem(request: RevealTranscriptRequest): void {
  window.dispatchEvent(new CustomEvent(REVEAL_TRANSCRIPT_EVENT, { detail: request }));
}
