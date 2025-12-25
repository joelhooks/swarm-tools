---
"opencode-swarm-plugin": minor
"swarm-mail": patch
---

## 🔭 Swarm Observability: See What Your Bees Are Doing

> "Observability is about instrumenting your system in a way that ensures sufficient information about a system's runtime is collected and analyzed so that when something goes wrong, it can help you understand why."
> — Chip Huyen, *AI Engineering*

New CLI commands to understand swarm health and history:

### `swarm stats`

```
┌─────────────────────────────────────────┐
│        🐝  SWARM STATISTICS  🐝         │
├─────────────────────────────────────────┤
│ Total Swarms: 42   Success: 87%         │
│ Avg Duration: 4.2min                    │
├─────────────────────────────────────────┤
│ BY STRATEGY                             │
│ ├─ file-based      92% (23/25)          │
│ ├─ feature-based   78% (14/18)          │
│ ├─ risk-based      67% (2/3)            │
├─────────────────────────────────────────┤
│ COORDINATOR HEALTH                      │
│ Violation Rate:   2%                    │
│ Spawn Efficiency: 94%                   │
│ Review Rate:      88%                   │
└─────────────────────────────────────────┘
```

Options: `--since 24h/7d/30d`, `--json`

### `swarm history`

Timeline of recent swarm activity with filtering:
- `--status success/failed/in_progress`
- `--strategy file-based/feature-based/risk-based`
- `--verbose` for subtask details

### Prompt Insights Integration

Coordinators and workers now receive injected insights from past swarm outcomes:
- Strategy success rates as markdown tables
- Anti-pattern warnings for low-success strategies
- File/domain-specific learnings from semantic memory

This creates a feedback loop where swarms learn from their own history.

### Also in this release

- **swarm-dashboard** (WIP): React/Vite visualizer scaffold
- **ADR-006**: Swarm PTY decision document
- **CI fix**: Smarter changeset detection prevents empty PR errors
