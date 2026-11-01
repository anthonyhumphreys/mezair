# Claude Code

Install and sign in to Claude Code on the same computer as Mezair. If you
already use `claude` in a terminal, Mezair uses that installation and login.

1. Open **Settings → Providers & models → AI connections** and enable
   **Claude Code**. Make it primary to use it for new chats and app utilities.
2. Use **Check again** to refresh installation, sign-in and available models.
   If needed, use **Sign in with Claude Code** or run `claude auth login` in
   a terminal, then check again.
3. Select a Claude model in the chat composer or the primary model field.
   **Use CLI default** (`auto`) keeps the model from your Claude Code settings.
   All models returned by the CLI are selectable, and you can enter a custom
   Claude model ID. Access and usage limits follow your Claude plan.

The provider uses Anthropic's Agent SDK with the installed CLI. It supports
streamed replies, tool calls and results, edit evidence, approval requests,
questions, queued follow-ups and cancellation. Reopening a native session
uses its local Claude session ID. A fork starts a new thread with transcript
context. Local workflow and automation steps use Claude's print mode.

Permission choices map to Claude's default, accept-edits and bypass modes.
Plan mode uses Claude's own planning restrictions; it is not a filesystem
sandbox. Strict read-only sessions, temporary chats, browser execution,
remote credential delivery, native goal controls and software factory workers are unavailable for
this provider. Claude login material stays with the local CLI.

Model discovery and login checks do not send inference prompts. The explicit
**Test connection** button sends a small request using the selected model.
