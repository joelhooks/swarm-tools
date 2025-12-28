# CLI Refactor Research: bin/swarm.ts → Effect-TS Command Modules

## Problem Statement

`bin/swarm.ts` is 5176 lines - a god file containing:
- 20+ CLI commands (setup, doctor, init, query, dashboard, replay, export, stats, history, eval, serve, etc.)
- ASCII art and branding
- Argument parsing for each command
- Business logic mixed with presentation
- Dynamic imports (now fixed to static)

## Goal

Break into focused command modules using Effect-TS, TDD style per "Working Effectively with Legacy Code" (Feathers).

## Proposed Structure

```
bin/
├── swarm.ts              # Entry point - just routing
├── commands/
│   ├── setup.ts          # Interactive installer
│   ├── doctor.ts         # Health checks
│   ├── init.ts           # Project initialization
│   ├── query.ts          # SQL analytics
│   ├── dashboard.ts      # Live monitoring
│   ├── replay.ts         # Event replay
│   ├── export.ts         # Data export
│   ├── stats.ts          # Statistics
│   ├── history.ts        # Swarm history
│   ├── eval/
│   │   ├── status.ts
│   │   ├── history.ts
│   │   └── run.ts
│   ├── serve.ts          # Dashboard server
│   └── tool.ts           # Tool execution
├── lib/
│   ├── args.ts           # Argument parsing (Effect Schema)
│   ├── output.ts         # Formatting, colors, ASCII art
│   └── context.ts        # Shared CLI context (project path, db, etc.)
└── branding.ts           # ASCII art, version display
```

## Effect-TS Patterns to Apply

### 1. Command as Effect Program

```typescript
import { Effect, Console } from "effect";
import { Args, Command, Options } from "@effect/cli";

const queryCommand = Command.make("query", {
  preset: Options.optional(Options.text("preset")),
  sql: Options.optional(Options.text("sql")),
  format: Options.withDefault(Options.choice("format", ["table", "json", "csv"]), "table"),
}).pipe(
  Command.withHandler(({ preset, sql, format }) =>
    Effect.gen(function* () {
      const db = yield* SwarmMailService;
      const rows = preset 
        ? yield* executePreset(db, preset)
        : yield* executeQuery(db, sql!);
      yield* Console.log(formatOutput(rows, format));
    })
  )
);
```

### 2. Shared Context via Layers

```typescript
const CLIContext = Context.GenericTag<{
  projectPath: string;
  db: LibSQLDatabase;
  hive: HiveAdapter;
}>("CLIContext");

const CLILive = Layer.effect(
  CLIContext,
  Effect.gen(function* () {
    const projectPath = process.cwd();
    const db = yield* getSwarmMailLibSQL(projectPath);
    const hive = yield* createHiveAdapter({ projectPath });
    return { projectPath, db, hive };
  })
);
```

### 3. Error Handling

```typescript
class CommandError extends Data.TaggedError("CommandError")<{
  command: string;
  message: string;
  cause?: unknown;
}> {}

// In command handler
Effect.catchTag("CommandError", (e) =>
  Console.error(`${red("✗")} ${e.command}: ${e.message}`)
);
```

## TDD Approach (Feathers Style)

### Phase 1: Characterization Tests

Before changing anything, write tests that capture current behavior:

```typescript
describe("swarm query", () => {
  it("executes preset query and formats as table", async () => {
    const result = await runCLI(["query", "--preset", "failed_decompositions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("┌"); // Table border
  });
  
  it("errors on invalid preset", async () => {
    const result = await runCLI(["query", "--preset", "nonexistent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown preset");
  });
});
```

### Phase 2: Extract and Test

1. Extract one command at a time
2. Keep old code as fallback
3. Feature flag to switch between old/new
4. Remove old code only after new passes all characterization tests

### Phase 3: Seams (from Feathers)

Identify seams where we can substitute behavior:
- **Argument parsing** - Replace manual parsing with @effect/cli
- **Output formatting** - Extract to testable functions
- **Database access** - Already behind SwarmMailService
- **File system** - Use Effect's FileSystem service

## Migration Order (Risk-Based)

1. **Low risk, high value**: `version`, `help` - trivial, good warmup
2. **Medium risk**: `query`, `stats`, `history` - read-only, well-defined
3. **Higher risk**: `setup`, `doctor`, `init` - side effects, user interaction
4. **Highest risk**: `serve`, `dashboard` - long-running, WebSocket

## Dependencies

- `@effect/cli` - Command-line parsing
- `@effect/platform` - FileSystem, Terminal
- `effect` - Core (already installed)

## Success Criteria

- [ ] Each command in its own file (<200 lines)
- [ ] Entry point is just routing (<50 lines)
- [ ] 100% characterization test coverage before refactor
- [ ] All tests pass after refactor
- [ ] No behavior changes (pure refactor)
- [ ] Build produces single bundled CLI

## References

- "Working Effectively with Legacy Code" - Michael Feathers (pdf-brain)
- @effect/cli documentation
- Current bin/swarm.ts (5176 lines)
