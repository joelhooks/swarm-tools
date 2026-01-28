---
name: session-to-hivemind
description: "Store session transcripts in hivemind for cross-session memory"
homepage: https://github.com/joelhooks/swarm-tools
metadata:
  {
    "clawdbot": {
      "emoji": "🧠",
      "events": ["command:new", "session:end"],
      "requires": {
        "bins": ["swarm"]
      },
      "install": [
        {"kind": "plugin", "label": "swarm-tools plugin"}
      ]
    }
  }
---

# Session to Hivemind

Automatically stores session summaries and transcripts in hivemind for cross-session memory.

## What It Does

- On `command:new` (new session): Queries hivemind for relevant prior context
- On `session:end`: Stores session summary with key learnings

## Why

Context compaction loses information. This hook:

1. Preserves important learnings across sessions
2. Enables cross-session continuity
3. Builds institutional memory over time

## Configuration

Enabled by default when swarm-tools plugin is active.
