---
target: chat UI
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/Users/anthonyhumphreys/Code/mezair/mezair-app/src/renderer/components/chat/ChatView.tsx"
target_fingerprint: "sha256:b1dc578b2607c74dbdc6cdb2daeba837ad784b961821b51f33ce2d1c847b3b1b"
target_path: /Users/anthonyhumphreys/Code/mezair/mezair-app/src/renderer/components/chat/ChatView.tsx
timestamp: 2026-11-07T19-46-45Z
slug: src-renderer-components-chat-chatview-tsx
---
# Chat UI critique — 26/40 (Acceptable)
Method: dual-agent; browser unavailable (Chrome extension not connected), source-only review.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Rich status but split across 6+ locations |
| 2 | Match real world | 3 | "Work done" vs "Work completed"; Guide/Queue/Side question jargon |
| 3 | User control | 2 | No edit-and-resend; regenerate unwired; no Esc-to-stop |
| 4 | Consistency | 2 | Enter means newline while busy; mixed widths 1040/760/72ch |
| 5 | Error prevention | 3 | Approval cards good; "Approve for session" scope unstated |
| 6 | Recognition | 3 | Rail filter syntax as static help text |
| 7 | Flexibility | 2 | 4 shortcuts; no thread nav, approve keys, Up-to-edit |
| 8 | Minimalist | 2 | Up to 9 strips above composer; 3 turn-end footers |
| 9 | Error recovery | 3 | Classified errors w/ retry; remote/cloud errors are loose <p> |
| 10 | Help | 3 | Syntax + shortcut popovers, thin |

Priority issues:
- [P0] Above-composer pile-up (ChatView.tsx:1170-1300) -> single Attention slot
- [P1] Approvals: no keyboard path, accent on riskier choice, duplicated, session scope unstated
- [P1] Enter changes meaning while busy (ChatInput.tsx:1717)
- [P2] Turn end: usage + outcome + changes footers repeat files
- [P2] Delegations render at transcript end, not in spawning turn (ChatTranscript.tsx:224)

Detector: 2 warnings, both false positives (side-tab on quote block ArtifactAnnotationsPanel.tsx:297; Plex Mono declared in DESIGN.md prose).
Gaps vs best-in-class: edit/resend, regenerate, checkpoints/rewind, side-by-side diff review w/ hunk accept, global needs-you inbox, unread markers, context meter, keyboard thread nav, timestamps.
