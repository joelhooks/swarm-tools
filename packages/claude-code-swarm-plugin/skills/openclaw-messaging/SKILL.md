---
name: openclaw-messaging
description: Send messages, system events, and agent notifications through the openclaw CLI. Use when an agent needs to notify a user (Telegram, Slack, Discord), trigger another agent, broadcast updates, send system events, or coordinate agent-to-agent communication via swarmmail. Covers all three messaging layers - external channels, agent invocation, and internal swarmmail.
---

# OpenClaw Messaging

Three messaging layers, from user-facing to agent-internal.

## 1. System Events (Most Common for Agents)

Notify the active agent session (Grimlock) of state changes, completions, or discoveries.

```bash
# Immediate delivery — agent processes NOW
openclaw system event --mode now --text "Deployed atproto-agents to prod. CF Worker live at agents.joelhooks.com"

# Batched — delivered on next heartbeat (default 15m)
openclaw system event --text "Non-urgent: test suite passing, 47/47 green"

# Wait for agent response
openclaw system event --mode now --text "Need decision: use D1 or KV for session state?" --expect-final --json
```

**When to use:** After shipping to main, completing a task, discovering something important, or needing a decision routed through the system agent.

## 2. Direct Messages (External Channels)

Send to Telegram, Slack, Discord, WhatsApp, Signal, and 12+ other channels.

### Send

```bash
# Telegram (most common)
openclaw message send --channel telegram --target @joelhooks -m "Build complete, PR ready for review"

# Telegram with chat ID
openclaw message send --channel telegram --target 123456789 -m "Deployment finished"

# Slack
openclaw message send --channel slack --target "#dev-ops" -m "CI green, merging to main"

# With media attachment
openclaw message send --channel telegram --target @joelhooks -m "Architecture diagram" --media ./diagram.png

# Silent (no notification sound, Telegram only)
openclaw message send --channel telegram --target @joelhooks -m "FYI: background job done" --silent

# Dry run (preview without sending)
openclaw message send --channel telegram --target @joelhooks -m "test" --dry-run
```

### Broadcast

Same message to multiple targets:

```bash
openclaw message broadcast --channel telegram --targets @joelhooks 123456789 -m "System maintenance in 5 min"
```

### Read

Fetch recent messages from a conversation:

```bash
openclaw message read --channel telegram --target @joelhooks --limit 10 --json
openclaw message read --channel slack --target "#general" --limit 5
```

### React / Edit / Delete

```bash
openclaw message react --channel slack --target "#dev" --message-id 1234 --emoji thumbsup
openclaw message edit --channel telegram --target 123456789 --message-id 42 -m "Updated text"
openclaw message delete --channel telegram --target 123456789 --message-id 42
```

## 3. Agent Invocation

Trigger an agent turn and optionally deliver the response to a channel.

```bash
# Trigger agent, get response in terminal
openclaw agent -m "Summarize today's PRs" --json

# Trigger specific named agent
openclaw agent --agent ops -m "Check deployment status"

# Trigger agent AND deliver reply to Telegram
openclaw agent -m "Generate status report" --deliver --reply-channel telegram --reply-to @joelhooks

# With thinking level
openclaw agent -m "Analyze error logs" --thinking high

# Target existing session
openclaw agent --session-id abc123 -m "Continue from where we left off"
```

## 4. Swarmmail (Agent-to-Agent)

Internal message queue for coordinating between swarm workers. Available as MCP tools within agent sessions.

```
swarmmail_init       — Start mail session (call once at session start)
swarmmail_send       — Send message to another agent
swarmmail_inbox      — Check incoming messages
swarmmail_reserve    — Lock files for exclusive editing
swarmmail_release    — Release file locks
swarmmail_ack        — Acknowledge message receipt
swarmmail_health     — Check session health
```

Swarmmail is for inter-agent coordination only. For user-facing notifications, use `openclaw message send` or `openclaw system event`.

## 5. Directory Lookups

Find targets before sending:

```bash
openclaw directory self --channel telegram          # Your bot's info
openclaw directory peers --channel telegram          # Known contacts
openclaw directory groups --channel telegram         # Groups the bot is in
openclaw directory peers --channel slack             # Slack users
```

## Quick Reference

| Goal | Command |
|------|---------|
| Notify system agent (urgent) | `openclaw system event --mode now --text "..."` |
| Notify system agent (can wait) | `openclaw system event --text "..."` |
| Message user on Telegram | `openclaw message send --channel telegram --target @user -m "..."` |
| Message Slack channel | `openclaw message send --channel slack --target "#channel" -m "..."` |
| Send to multiple people | `openclaw message broadcast --channel telegram --targets @a @b -m "..."` |
| Trigger agent + deliver reply | `openclaw agent -m "..." --deliver --reply-channel telegram --reply-to @user` |
| Read conversation history | `openclaw message read --channel telegram --target @user --limit 10` |
| Preview without sending | Add `--dry-run` to any send/broadcast command |
| JSON output for scripting | Add `--json` to any command |

## Channel Support

Telegram, Slack, Discord, WhatsApp, Signal, iMessage, Google Chat, MS Teams, Mattermost, Matrix, Nostr, Feishu, Nextcloud Talk, BlueBubbles, Line, Zalo, Tlon.

Check active channels: `openclaw channels status`

## Common Patterns

### Post-deploy notification
```bash
openclaw system event --mode now --text "Shipped v1.2.3 to prod. Changes: new auth flow, fixed rate limiter."
openclaw message send --channel telegram --target @joelhooks -m "v1.2.3 live on prod"
```

### Agent handoff with context
```bash
openclaw system event --mode now --text "Completed Phase 1 encryption. All tests passing. Ready for Phase 2 HITL gate review."
```

### Swarm worker status update
```bash
openclaw system event --mode now --text "Worker task-42 complete: implemented D1 schema migration. 12 tests added."
```

### Verifying message delivery
Use `--json` output to confirm delivery status. For critical notifications, check the response for success before proceeding:
```bash
openclaw message send --channel telegram --target @joelhooks -m "Deploy complete" --json
# Response includes delivery status — check "status": "delivered" before continuing workflow
```
