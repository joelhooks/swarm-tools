# @swarmtools/evals

```
    🐝   EVAL SUITE   🐝
━━━━━━━━━━━━━━━━━━━━━━━━━━
  Swarm Intelligence QA
```

Evaluation suite for swarm-tools multi-agent coordination. Uses [Evalite](https://evalite.dev) to measure coordinator behavior, decomposition quality, and compaction correctness.

## Purpose

This package contains the evaluation framework for the swarm-tools ecosystem. Extracting evals into a separate package ensures:

1. **Clean Dependencies** - Main plugin doesn't need evalite/vitest in production
2. **Faster Installs** - Eval deps only needed for development/CI
3. **Isolated Testing** - Eval suite can evolve independently from plugin

## What Gets Evaluated

- **Coordinator Protocol** - Does the coordinator spawn workers vs doing work itself?
- **Coordinator Behavior** - LLM behavior after compaction (stays in coordinator role)
- **Compaction Resumption** - Context injection correctness after compaction
- **Compaction Prompt Quality** - Quality of continuation prompts generated
- **Task Decomposition** - Quality of task splitting, file conflict detection
- **Strategy Selection** - Correct strategy choice for task characteristics
- **Decision Quality** - Strategy selection quality and precedent relevance

## Usage

```bash
# Run all evals
bun run test

# Build for publishing
bun run build

# Type check
bun run typecheck
```

## Package Structure

This package is part of the swarm-tools monorepo:

- `opencode-swarm-plugin` - Main plugin (peer dependency)
- `swarm-mail` - Event sourcing primitives (peer dependency)
- `@swarmtools/evals` - This package

## Development

Evals use real coordinator sessions captured to `~/.config/swarm-tools/sessions/*.jsonl`. See `docs/README.md` in this package for details on session capture and eval architecture.

## License

MIT
