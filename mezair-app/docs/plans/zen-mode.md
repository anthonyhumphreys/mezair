# Zen mode

Status: proposal. Not implemented.

## Intent

Zen mode is a chat-first shell. The conversation and its thread list own the window; every other
section of the app is one keystroke away in the jump menu instead of permanently occupying the
sidebar. It is aimed at the developer who spends most of the day supervising agents and only
occasionally visits Repositories, Work items, Automations or Settings.

Zen mode does **not** blur workspace boundaries. PRODUCT.md treats workspace scope as a trust
boundary ("Scope state visibly and correctly", anti-reference "hidden workspace boundaries"). In Zen
mode the user still explicitly chooses the workspace; the choice simply moves from a navigation
rail to a compact switcher at the top of the thread list, and the active workspace stays named in
the thread header and composer.

## User-facing behaviour

### Shell

- `Sidebar` collapses to a single column: workspace switcher, **New thread**, the thread list
  (`ChatThreadRail` content), and a footer with the jump-menu trigger and the activity centre
  indicator.
- Global items (Home, Activity), workspace items (Overview, Repositories, Library, Work items,
  Code review, Security, Automations, Factories, Workflows, Browser, Editor, Git, Settings…) are
  removed from the sidebar and listed in the command palette under a **Go to** section.
- The `/chat` route is the Zen home. Navigating to any other route keeps the Zen sidebar; the main
  pane shows that route with a slim breadcrumb (`Workspace name / Section`) and a **Back to thread**
  affordance (`⌘0`) that returns to the last active thread.
- Pinned sidebar items (`togglePinned`) survive as up to five "Go to" shortcuts in the footer so
  users who rely on one or two tools are not forced through the palette.

### Workspace switcher

- Sits at the top of the Zen sidebar: monogram + workspace name + chevron. Opens a listbox of
  workspaces with their attention counts from `workspaceActivity` (approvals waiting, failed runs,
  live runs).
- Switching uses the existing `switchWorkspace` + undo toast. Thread list, composer scope and
  side panels all re-scope; nothing from the previous workspace remains visible.
- `⌘⇧W` opens the switcher; `⌘⇧1…9` switches directly to workspace N in list order.
- A cross-workspace attention badge on the switcher ("2 elsewhere need you") lets the user
  notice approvals in other workspaces without merging their threads into this list.

### Jump menu

- `⌘K` is unchanged. In Zen mode the palette opens with **Go to** first, then **Threads** (all
  threads in the active workspace, fuzzy by title/summary), then existing actions.
- `⌘P` (or `⌘T`) opens the palette pre-filtered to Threads for fast thread switching.
- Each Go-to row shows the shortcut if one exists and whether the section has attention.

### Entering and leaving

- Settings → Appearance → **Layout**: Standard | Zen. Also a palette command "Toggle Zen mode"
  and the shortcut `⌘⌥Z` (`⌘⇧Z` is redo in editors).
- The setting is global (per device), not per workspace. Rationale: the user asked that Zen users
  choose the workspace, which implies a single shell with a switcher, not a mix of shells.

## Implementation plan

### 1. Setting

- Extending `ChatLayout` (`src/shared/types.ts:1076`) is the wrong axis: it controls the thread
  list's grouping (classic/workitems), which Zen still needs. Add a separate `shellLayout:
  'standard' | 'zen'` setting.
- Schema: new migration adding `shell_layout TEXT NOT NULL DEFAULT 'standard'` to the settings
  table; bump `SCHEMA_VERSION`. Map it in `settings.service.ts` next to `chatLayout`
  (`normaliseShellLayout`) and add it to `sync-entity-domain.ts` so it follows the device-sync
  rules of other appearance settings.
- Expose via the existing settings IPC; no new channel needed.

### 2. Shell composition

- `Shell.tsx` chooses between `<Sidebar>` and a new `<ZenSidebar>` based on `shellLayout`.
- `ZenSidebar` (`src/renderer/components/layout/ZenSidebar.tsx`) composes:
  - `ZenWorkspaceSwitcher` (new; reuses `useWorkspace()` and the rename/delete affordances from
    `WorkspaceRail` behind a context menu).
  - The thread list. Extract the list body of `ChatThreadRail` into `ChatThreadList` so it can be
    rendered by both the chat view's rail (Standard) and the Zen sidebar. In Zen mode `ChatView`
    stops rendering its own rail.
  - Footer: palette trigger, pinned Go-to shortcuts, `SidebarActivityCenter`.
- Thread selection state currently lives in `ChatView`. Lift `activeThreadId` and the thread list
  data (`useChatViewData`) into a `ChatThreadsContext` provided above the router, so the Zen
  sidebar and `ChatView` share one source of truth. Standard mode uses the same context; this is a
  prerequisite refactor with no visible change.

### 3. Routing

- Add `/chat/:threadId` so a thread is addressable from the palette and from notifications.
  `ChatView` reads the param and falls back to the stored last thread. Keep `/chat` working.
- `⌘0` "Back to thread" navigates to `/chat/:lastThreadId`.

### 4. Command palette

- Add a `Go to` section built from the same `navigation` model the sidebar uses
  (`navigation.primary`, `navigation.automate`, `navigation.tools`), filtered by feature
  availability, so Zen and Standard can never drift.
- Add a `Threads` section sourced from `ChatThreadsContext`.
- Add "Toggle Zen mode".

### 5. Visibility of scope (trust boundary)

- Thread header: workspace monogram + name at `text-text-secondary`, not tertiary.
- Composer setup summary already includes the persona and device; prepend the workspace name in
  Zen mode.
- Cross-workspace notifications deep-link with `?workspace=<id>`; following one switches
  workspace through the normal undoable path and shows the toast.

### 6. Tests

- Settings round-trip and migration for `shell_layout`.
- `ChatThreadsContext`: selection survives route changes; switching workspace clears selection.
- Palette: Go-to items equal the sidebar's visible items for a given feature-availability input.
- Shell snapshot test: Zen renders no workspace navigation items in the sidebar.

## Open questions

1. Should Zen hide the status bar too, or keep it for git branch / run state?
2. Is `⌘⌥Z` acceptable for the toggle, or should it be palette/settings only?
3. Should pinned Go-to shortcuts be capped at five, or follow the existing pin list exactly?

## Out of scope

- A merged all-workspaces thread list (T3-style). If wanted later, it depends on the
  thread-scoped `ChatView` refactor in step 2 and on making the workspace visible on every row.
