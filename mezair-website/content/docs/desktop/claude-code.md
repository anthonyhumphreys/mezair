---
title: Use Claude Code in Mezair
navTitle: Claude Code
description: Connect your installed Claude Code CLI, choose models, and use your local Claude sign-in in Mezair Desktop.
product: Mezair Desktop
section: Guides
journey: build
order: 65
---

# Use Claude Code in Mezair

Mezair Desktop can run Claude Code against your local repositories using your
installed `claude` CLI and its existing sign-in. Choose Claude Code for a chat,
make it your primary provider, or assign it to a local workflow step.

## Connect your CLI

1. Install Claude Code using [Anthropic's setup guide](https://code.claude.com/docs/en/setup).
   If you already use it in a terminal on this computer, keep that installation.
2. Confirm it is available and sign in:

   ```bash
   claude --version
   claude auth login
   claude auth status
   ```

3. In Mezair, open **Settings → Providers & models → AI connections** and enable
   **Claude Code**. Make it primary if you want it for new chats and app-level
   AI tasks.
4. Choose **Check again** to refresh sign-in status and available models. You
   can also start Claude's browser sign-in from this panel.

Mezair uses the official Anthropic Agent SDK with your installed executable.
Authentication stays with Claude Code; Mezair does not copy its OAuth files
into its database or send them to another machine. You do not need to enter
an Anthropic API key into Mezair for this login path.

## Choose a model

The chat model picker, primary model field and local workflow editors offer
the models reported by your CLI. You can also enter a custom model ID.

| Choice | Behavior |
| --- | --- |
| Use CLI default (`auto`) | Keeps the model from your Claude Code configuration. A CLI configured for Haiku keeps using that preference. |
| A listed model | Uses that model for the chat or workflow step. |
| A custom model ID | Passes the selected ID to Claude Code. Availability depends on your account. |

Choose any model your Claude account supports. Model access and usage limits
follow your Claude plan. Model discovery and sign-in checks do not send model
prompts; **Test connection** sends a small request using the selected model.

Claude turns do not use Codex's reasoning-effort or priority-tier controls.

## Work in a local chat

Claude Code chats support streamed replies, tool calls and results, successful
file-change evidence, approvals and structured questions. Persona instructions
and repository context accompany the session. Follow-up messages use **Queue**
while a turn is running; you can interrupt the turn or stop the session.

Reopening a Claude session on the same computer uses its native session ID.
Branching starts a new Claude thread with conversation context.

| Permission choice | Claude behavior |
| --- | --- |
| Agent | Uses Claude's default permission checks. |
| Accept edits | Applies file edits without asking and keeps Claude's other permission checks. |
| Full access | Bypasses Claude's permission checks. Choose this only when you intend that access. |
| Plan | Uses Claude's planning mode. This is not a filesystem sandbox. |

## Workflows and automations

Enable Claude Code before assigning it to a local workflow step or specialist.
Each step stores its own provider and model. Persona automations use the primary
provider and its selected model.

These background runs use `claude --print`. They record the final text without
the interactive chat's tool, diff or reasoning events. Review their output and
repository changes before keeping the work.

## Current limits

- Claude Code execution and login stay on the local Desktop. Browser execution,
  cloud execution and remote credential delivery do not support this provider.
- Strict read-only sessions, read-only side questions and temporary chats are
  unavailable for Claude Code. Plan mode does not provide the same isolation.
- Native goal controls and mid-turn Guide are unavailable; use Queue for follow-ups.
- Software factory workers currently require Codex.
- Provider availability still depends on the installed CLI, its login and your
  Claude account's model access and remaining usage.

## Ask your coding agent to help

```prompt
Help me connect the Claude Code CLI on this computer to Mezair Desktop, following
https://mezair.dev/docs/desktop/claude-code. Check whether claude is installed and
signed in, then explain how to enable it under Settings → Providers & models.
Keep my current CLI model as the default unless I choose another model. Show me
how to select available models in chat and local workflows. Do not send a test
prompt or change my Claude configuration unless I ask. The expected result is
a connected local provider with my model preference preserved.
```

## Related reading

- [Chat, personas and models](/docs/desktop/chat-personas-and-llm)
- [Chat, surfaces and agent runs](/docs/desktop/chat-canvas-and-agent-runs)
- [Agent workflows](/docs/desktop/agent-workflows)
- [Settings and diagnostics](/docs/desktop/settings-and-diagnostics)
