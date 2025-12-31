# ADR-002: Modular CLI Commands with Effect-TS Services

```
        ╔═══════════════════════════════════════════════════════════════╗
        ║                                                               ║
        ║   FROM MONOLITH TO MODULES                                    ║
        ║                                                               ║
        ║   bin/swarm.ts (5416 lines)                                   ║
        ║         │                                                     ║
        ║         ▼                                                     ║
        ║   ┌─────────────────────────────────────────────────────┐     ║
        ║   │  commands/                                          │     ║
        ║   │    ├── setup.ts      ├── doctor.ts                  │     ║
        ║   │    ├── init.ts       ├── migrate.ts                 │     ║
        ║   │    ├── serve.ts      ├── eval/                      │     ║
        ║   │    └── ...           │   ├── status.ts              │     ║
        ║   │                      │   ├── history.ts             │     ║
        ║   │                      │   └── run.ts                 │     ║
        ║   └─────────────────────────────────────────────────────┘     ║
        ║         │                                                     ║
        ║         ▼                                                     ║
        ║   ┌─────────────────────────────────────────────────────┐     ║
        ║   │  services/ (Effect-TS)                              │     ║
        ║   │    ├── FileSystem.ts   ├── Process.ts               │     ║
        ║   │    ├── Database.ts     ├── Config.ts                │     ║
        ║   │    └── Logger.ts                                    │     ║
        ║   └─────────────────────────────────────────────────────┘     ║
        ║                                                               ║
        ╚═══════════════════════════════════════════════════════════════╝
```

## Status

**Proposed** - December 2025

## Context

### The Problem

`bin/swarm.ts` has grown organically to **5416 lines** with ~30 commands inline:

```
setup, doctor, init, config, serve, viz, update, agents, migrate, db,
cells, logs, stats, o11y, history, eval (status/history/run), capture,
query, dashboard, replay, export, version, help, tool
```

**Pain points:**

1. **Cognitive load** - Understanding one command requires scrolling past 5000+ lines
2. **Testing friction** - Commands deeply coupled to file I/O, process spawning, database
3. **No dependency injection** - Hard to mock dependencies for testing
4. **Error handling** - Inconsistent, mostly try/catch with manual logging
5. **Shared state** - Global constants, inline helper functions
6. **Effect already in swarm-mail** - Patterns exist but not leveraged in CLI

### What We Want

1. **Command modules** - Each command in its own file, testable in isolation
2. **Effect services** - Dependency injection for FileSystem, Process, Database, Config
3. **Typed errors** - Discriminated unions instead of string messages
4. **Composable** - Small pieces that work together
5. **TDD-friendly** - Can test command logic without touching filesystem

## Decision

**Hybrid incremental approach:**

1. **Phase 1**: Extract commands into `bin/commands/*.ts` modules (keep imperative)
2. **Phase 2**: Create Effect services for core dependencies (FileSystem, Process, Config)
3. **Phase 3**: Migrate commands to use Effect services (command by command)
4. **Phase 4**: Add typed errors and Effect-native testing

### Architecture

```
packages/opencode-swarm-plugin/
├── bin/
│   ├── swarm.ts              # Thin router (dispatch to commands)
│   ├── commands/
│   │   ├── index.ts          # Command registry
│   │   ├── setup.ts          # Interactive installer
│   │   ├── doctor.ts         # Health check
│   │   ├── init.ts           # Project initialization
│   │   ├── serve.ts          # SSE server
│   │   ├── migrate.ts        # DB migration
│   │   ├── cells.ts          # Cell management
│   │   ├── logs.ts           # Log viewing
│   │   ├── stats.ts          # Health metrics
│   │   ├── eval/
│   │   │   ├── index.ts      # Eval subcommand router
│   │   │   ├── status.ts
│   │   │   ├── history.ts
│   │   │   └── run.ts
│   │   └── ...
│   ├── services/             # Effect-TS services
│   │   ├── FileSystem.ts     # File operations
│   │   ├── Process.ts        # spawn, exec
│   │   ├── Database.ts       # libSQL adapter
│   │   ├── Config.ts         # ~/.config/opencode
│   │   ├── Logger.ts         # Structured logging
│   │   └── index.ts          # Layer composition
│   └── lib/
│       ├── colors.ts         # ANSI helpers
│       ├── seasonal.ts       # Season messages
│       ├── templates.ts      # Agent/command templates
│       └── version.ts        # Version checking
```

### Command Interface

Each command exports a standard interface:

```typescript
// bin/commands/types.ts
import type { Effect } from "effect";

export interface CommandArgs {
  readonly _tag: string;
  readonly [key: string]: unknown;
}

export interface CommandResult {
  readonly exitCode: 0 | 1;
  readonly message?: string;
}

export interface Command<Args extends CommandArgs = CommandArgs> {
  readonly name: string;
  readonly description: string;
  readonly parseArgs: (argv: string[]) => Args;
  readonly execute: (args: Args) => Effect.Effect<CommandResult, CommandError, CommandServices>;
}
```

### Service Definitions

```typescript
// bin/services/FileSystem.ts
import { Context, Effect, Layer } from "effect";

export interface FileSystem {
  readonly readFile: (path: string) => Effect.Effect<string, FileNotFoundError | ReadError>;
  readonly writeFile: (path: string, content: string) => Effect.Effect<void, WriteError>;
  readonly exists: (path: string) => Effect.Effect<boolean, never>;
  readonly mkdir: (path: string, options?: { recursive?: boolean }) => Effect.Effect<void, MkdirError>;
  readonly rm: (path: string, options?: { recursive?: boolean }) => Effect.Effect<void, RmError>;
  readonly readDir: (path: string) => Effect.Effect<string[], ReadDirError>;
  readonly stat: (path: string) => Effect.Effect<FileStats, StatError>;
}

export const FileSystem = Context.GenericTag<FileSystem>("@swarm/FileSystem");

// Live implementation using Node.js fs
export const FileSystemLive = Layer.succeed(FileSystem, {
  readFile: (path) =>
    Effect.tryPromise({
      try: () => import("fs").then((fs) => fs.promises.readFile(path, "utf-8")),
      catch: (error) =>
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new FileNotFoundError({ path })
          : new ReadError({ path, cause: error }),
    }),
  // ... other methods
});

// Test implementation using in-memory map
export const FileSystemTest = (files: Map<string, string>) =>
  Layer.succeed(FileSystem, {
    readFile: (path) =>
      files.has(path)
        ? Effect.succeed(files.get(path)!)
        : Effect.fail(new FileNotFoundError({ path })),
    // ... other methods
  });
```

### Process Service

```typescript
// bin/services/Process.ts
import { Context, Effect, Layer } from "effect";

export interface ProcessSpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Process {
  readonly spawn: (
    cmd: string,
    args: string[],
    options?: SpawnOptions
  ) => Effect.Effect<ProcessSpawnResult, SpawnError>;
  readonly exec: (command: string) => Effect.Effect<string, ExecError>;
}

export const Process = Context.GenericTag<Process>("@swarm/Process");

export const ProcessLive = Layer.succeed(Process, {
  spawn: (cmd, args, options) =>
    Effect.tryPromise({
      try: async () => {
        const { spawn } = await import("child_process");
        return new Promise((resolve, reject) => {
          const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
          let stdout = "";
          let stderr = "";
          proc.stdout?.on("data", (data) => (stdout += data));
          proc.stderr?.on("data", (data) => (stderr += data));
          proc.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
          proc.on("error", reject);
        });
      },
      catch: (error) => new SpawnError({ cmd, args, cause: error }),
    }),
  // ...
});

// Test implementation that records calls
export const ProcessTest = (handlers: Map<string, ProcessSpawnResult>) =>
  Layer.succeed(Process, {
    spawn: (cmd, args) =>
      handlers.has(cmd)
        ? Effect.succeed(handlers.get(cmd)!)
        : Effect.fail(new SpawnError({ cmd, args, cause: "No mock handler" })),
    // ...
  });
```

### Typed Errors

```typescript
// bin/services/errors.ts
import { Data } from "effect";

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly path: string;
}> {}

export class ReadError extends Data.TaggedError("ReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class WriteError extends Data.TaggedError("WriteError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly cmd: string;
  readonly args: string[];
  readonly cause: unknown;
}> {}

export class DependencyMissingError extends Data.TaggedError("DependencyMissingError")<{
  readonly name: string;
  readonly install: string;
}> {}

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly path?: string;
}> {}

// Union type for pattern matching
export type CommandError =
  | FileNotFoundError
  | ReadError
  | WriteError
  | SpawnError
  | DependencyMissingError
  | ConfigError;
```

### Command Example: Doctor

```typescript
// bin/commands/doctor.ts
import { Effect, pipe } from "effect";
import { Process, FileSystem, Config, Logger } from "../services";
import type { Command, CommandResult } from "./types";
import { DependencyMissingError } from "../services/errors";
import { DEPENDENCIES } from "../lib/dependencies";

interface DoctorArgs {
  readonly _tag: "DoctorArgs";
  readonly debug: boolean;
}

const checkDependency = (dep: Dependency) =>
  Effect.gen(function* (_) {
    const process = yield* _(Process);
    
    const result = yield* _(
      process.spawn(dep.command, dep.checkArgs),
      Effect.catchAll(() => Effect.succeed({ exitCode: 1, stdout: "", stderr: "" }))
    );
    
    if (result.exitCode !== 0) {
      return { dep, available: false };
    }
    
    const versionMatch = result.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return { dep, available: true, version: versionMatch?.[1] };
  });

const doctor: Command<DoctorArgs> = {
  name: "doctor",
  description: "Check dependency health with detailed status",
  
  parseArgs: (argv) => ({
    _tag: "DoctorArgs" as const,
    debug: argv.includes("--debug") || argv.includes("-d"),
  }),
  
  execute: (args) =>
    Effect.gen(function* (_) {
      const logger = yield* _(Logger);
      const config = yield* _(Config);
      
      yield* _(logger.intro(`swarm doctor v${config.version}`));
      
      if (args.debug) {
        yield* _(logger.step("Debug info:"));
        yield* _(logger.message(`  Runtime: ${typeof Bun !== "undefined" ? "Bun" : "Node.js"}`));
        yield* _(logger.message(`  Platform: ${process.platform}`));
      }
      
      yield* _(logger.startSpinner("Checking dependencies..."));
      
      const results = yield* _(
        Effect.all(DEPENDENCIES.map(checkDependency), { concurrency: "unbounded" })
      );
      
      yield* _(logger.stopSpinner("Dependencies checked"));
      
      const required = results.filter((r) => r.dep.required);
      const optional = results.filter((r) => !r.dep.required);
      const requiredMissing = required.filter((r) => !r.available);
      
      yield* _(logger.step("Required dependencies:"));
      for (const { dep, available, version } of required) {
        if (available) {
          yield* _(logger.success(`${dep.name}${version ? ` v${version}` : ""}`));
        } else {
          yield* _(logger.error(`${dep.name} - not found`));
          yield* _(logger.message(`   └─ Fix: ${dep.install}`));
        }
      }
      
      yield* _(logger.step("Optional dependencies:"));
      for (const { dep, available, version } of optional) {
        if (available) {
          yield* _(logger.success(`${dep.name}${version ? ` v${version}` : ""} - ${dep.description}`));
        } else {
          yield* _(logger.warn(`${dep.name} - not found (${dep.description})`));
        }
      }
      
      if (requiredMissing.length > 0) {
        yield* _(logger.outro(`Missing ${requiredMissing.length} required. Run 'swarm setup'.`));
        return { exitCode: 1 as const };
      }
      
      yield* _(logger.outro("All required dependencies installed!"));
      return { exitCode: 0 as const };
    }),
};

export default doctor;
```

### Testing Commands

```typescript
// bin/commands/doctor.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import doctor from "./doctor";
import { ProcessTest, FileSystemTest, ConfigTest, LoggerTest } from "../services";

describe("doctor command", () => {
  it("reports missing required dependency", async () => {
    // Arrange: OpenCode not installed
    const processHandlers = new Map([
      ["opencode", { exitCode: 1, stdout: "", stderr: "not found" }],
    ]);
    
    const logs: string[] = [];
    const testLayer = Layer.mergeAll(
      ProcessTest(processHandlers),
      FileSystemTest(new Map()),
      ConfigTest({ version: "1.0.0" }),
      LoggerTest(logs),
    );
    
    // Act
    const result = await Effect.runPromise(
      doctor.execute({ _tag: "DoctorArgs", debug: false }).pipe(
        Effect.provide(testLayer)
      )
    );
    
    // Assert
    expect(result.exitCode).toBe(1);
    expect(logs.some((l) => l.includes("OpenCode - not found"))).toBe(true);
  });
  
  it("succeeds when all required dependencies present", async () => {
    const processHandlers = new Map([
      ["opencode", { exitCode: 0, stdout: "v1.2.3", stderr: "" }],
    ]);
    
    const logs: string[] = [];
    const testLayer = Layer.mergeAll(
      ProcessTest(processHandlers),
      FileSystemTest(new Map()),
      ConfigTest({ version: "1.0.0" }),
      LoggerTest(logs),
    );
    
    const result = await Effect.runPromise(
      doctor.execute({ _tag: "DoctorArgs", debug: false }).pipe(
        Effect.provide(testLayer)
      )
    );
    
    expect(result.exitCode).toBe(0);
  });
});
```

### Main Router

```typescript
// bin/swarm.ts (minimal - just routing)
#!/usr/bin/env node
import { Effect, Layer } from "effect";
import { commands } from "./commands";
import { LiveServices } from "./services";

const argv = process.argv.slice(2);
const commandName = argv[0] ?? "setup";

const command = commands[commandName];

if (!command) {
  console.error(`Unknown command: ${commandName}`);
  process.exit(1);
}

const args = command.parseArgs(argv.slice(1));

Effect.runPromise(
  command.execute(args).pipe(
    Effect.provide(LiveServices),
    Effect.catchAll((error) => {
      console.error(`Error: ${error._tag}: ${error.message}`);
      return Effect.succeed({ exitCode: 1 as const });
    })
  )
).then((result) => {
  process.exit(result.exitCode);
});
```

## Implementation Plan

### Phase 1: Command Extraction (No Effect Yet)

**Goal:** Split monolith into modules without changing behavior.

1. **Create directory structure**
   - `bin/commands/` for command modules
   - `bin/lib/` for shared utilities (colors, templates, seasonal)

2. **Extract commands one by one** (TDD: characterization tests first)
   - Start with simplest: `version`, `help`, `config`
   - Then: `doctor`, `init`
   - Then complex: `setup`, `serve`, `eval/*`

3. **Create thin router** in `bin/swarm.ts`

4. **Verify**: All existing tests pass, CLI behavior unchanged

### Phase 2: Core Effect Services

**Goal:** Create testable service interfaces.

1. **FileSystem service**
   - Live: Node.js fs
   - Test: In-memory Map

2. **Process service**
   - Live: child_process spawn/exec
   - Test: Mock handlers

3. **Config service**
   - Live: Read from ~/.config/opencode
   - Test: In-memory config

4. **Logger service**
   - Live: @clack/prompts
   - Test: Collect to array

5. **Database service**
   - Live: libSQL via swarm-mail
   - Test: In-memory

### Phase 3: Migrate Commands to Effect

**Goal:** Convert commands to use Effect services.

Order (simplest to complex):
1. `version` - Just reads config
2. `config` - Reads config, checks files
3. `doctor` - Spawns processes, checks deps
4. `cells` - Database queries
5. `logs` - File reading, filtering
6. `stats`, `history`, `o11y` - Database + formatting
7. `init` - File writes, git checks
8. `migrate` - Database migration
9. `setup` - Everything (final boss)

### Phase 4: Typed Errors

**Goal:** Replace string errors with discriminated unions.

1. Define error types per domain
2. Add error recovery/retry logic where appropriate
3. User-friendly error formatting

## Testing Strategy

### Characterization Tests (Phase 1)

Before extracting a command, capture its current behavior:

```typescript
// bin/commands/doctor.characterization.test.ts
import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";

describe("doctor command (characterization)", () => {
  it("exits 0 when all required deps present", () => {
    // This test captures CURRENT behavior, not desired behavior
    const result = execSync("bun bin/swarm.ts doctor", { encoding: "utf-8" });
    expect(result).toContain("All required dependencies installed");
  });
});
```

### Unit Tests (Phase 2-4)

Test command logic with mock services:

```typescript
describe("doctor command", () => {
  it("checks all dependencies", async () => {
    // Test with mock Process service
  });
});
```

### Integration Tests

Test real file/process interactions:

```typescript
describe("doctor command (integration)", () => {
  it("actually checks opencode binary", async () => {
    // Uses LiveServices
  });
});
```

## Alternatives Considered

### 1. Yargs/Commander.js

Use a CLI framework instead of manual routing.

**Pros:**
- Automatic help generation
- Argument parsing built-in

**Cons:**
- Another dependency
- Doesn't solve testing problem
- Effect integration awkward

**Verdict:** Not worth the dependency for our needs.

### 2. Full Effect from Start

Convert entire CLI to Effect in one pass.

**Pros:**
- No intermediate state
- Clean design

**Cons:**
- Massive change, high risk
- Blocks progress on other work
- Hard to review

**Verdict:** Incremental is safer and allows continuous delivery.

### 3. Keep Monolith, Just Add Tests

Add tests to existing structure.

**Pros:**
- Fastest initial progress

**Cons:**
- Tests would be fragile (mocking globals)
- Doesn't solve maintainability
- Technical debt compounds

**Verdict:** Treating symptoms, not cause.

## Consequences

### Positive

1. **Testability** - Each command testable in isolation
2. **Maintainability** - Find code faster, smaller files
3. **Composability** - Services reusable across commands
4. **Error handling** - Typed errors, consistent recovery
5. **Onboarding** - Easier for new contributors
6. **Effect ecosystem** - Can use Effect's scheduling, retries, etc.

### Negative

1. **Learning curve** - Team must understand Effect basics
2. **Initial overhead** - More files, more boilerplate
3. **Migration period** - Two patterns coexist temporarily

### Neutral

1. **Directory structure** - More directories, but organized
2. **Import paths** - Slightly longer imports

## Success Metrics

1. **Test coverage** - 80%+ for command logic
2. **File size** - No file >500 lines
3. **Dependencies** - Services have <3 dependencies each
4. **Error types** - All errors are typed (no string throws)

## References

- [Effect-TS Documentation](https://effect.website)
- [TDD Skill](/.opencode/skills/tdd/)
- [Existing Effect usage in swarm-mail](packages/swarm-mail/src/sessions/)
- [ADR-001: Async Background Workers](./001-async-background-workers.md)

---

## Implementation Progress

> **For agents resuming this work:** 
> 1. Query hivemind: `hivemind_find({ query: "ADR-002 CLI refactor", limit: 10 })`
> 2. Check this checklist for current state
> 3. Pick next unchecked item in dependency order

### Worker Protocol

**EVERY worker MUST:**
1. Check off completed items in this ADR (change `[ ]` to `[x]`)
2. Store completion memory: `hivemind_store({ information: "ADR-002: Completed <task>. <decisions made, gotchas found>", tags: "adr-002,cli-refactor,<specific-tags>" })`
3. Add entry to Completion Log at bottom

---

### Phase 1: Foundation

#### lib/ modules
- [ ] `bin/lib/colors.ts` - ANSI color helpers (dim, bold, italic, box-drawing)
- [ ] `bin/lib/colors.test.ts` - Unit tests
- [ ] `bin/lib/seasonal.ts` - Bee art, getSeasonalMessage(), holiday themes
- [ ] `bin/lib/seasonal.test.ts` - Unit tests
- [ ] `bin/lib/dependencies.ts` - Dependency interface, DEPENDENCIES constant
- [ ] `bin/lib/dependencies.test.ts` - Unit tests
- [ ] `bin/lib/version.ts` - checkForUpdates(), version comparison
- [ ] `bin/lib/version.test.ts` - Unit tests
- [ ] `bin/lib/server.ts` - DurableStreamServer setup, port handling, graceful shutdown
- [ ] `bin/lib/server.test.ts` - Unit tests
- [ ] `bin/lib/index.ts` - Barrel export

#### Type definitions
- [ ] `bin/commands/types.ts` - Command interface, CommandArgs, CommandResult, CommandServices
- [ ] `bin/services/errors.ts` - FileNotFoundError, ReadError, WriteError, SpawnError, DependencyMissingError, ConfigError, DatabaseError

---

### Phase 2: Effect Services

#### FileSystem Service
- [ ] `bin/services/FileSystem.ts` - readFile, writeFile, exists, mkdir, rm, readDir, stat
- [ ] `bin/services/FileSystem.test.ts` - Tests with FileSystemTest (in-memory Map)

#### Process Service
- [ ] `bin/services/Process.ts` - spawn, exec with typed errors
- [ ] `bin/services/Process.test.ts` - Tests with ProcessTest (mock handlers)

#### Config Service
- [ ] `bin/services/Config.ts` - getConfigPath, getVersion, getProjectPath
- [ ] `bin/services/Config.test.ts` - Tests with ConfigTest

#### Logger Service
- [ ] `bin/services/Logger.ts` - @clack/prompts wrapper (intro, outro, spinner, etc.)
- [ ] `bin/services/Logger.test.ts` - Tests with LoggerTest (array collector)

#### Database Service
- [ ] `bin/services/Database.ts` - libSQL adapter from swarm-mail
- [ ] `bin/services/Database.test.ts` - Tests with createInMemorySwarmMail

#### Service Composition
- [ ] `bin/services/index.ts` - Barrel export + LiveServices Layer composition

---

### Phase 3: Commands

#### Simple Commands (no DB deps)
- [ ] `bin/commands/version.ts` - Show version, check updates
- [ ] `bin/commands/version.test.ts`
- [ ] `bin/commands/help.ts` - Show command list and usage
- [ ] `bin/commands/help.test.ts`
- [ ] `bin/commands/config.ts` - Show config paths
- [ ] `bin/commands/config.test.ts`
- [ ] `bin/commands/update.ts` - Run npm/bun update
- [ ] `bin/commands/update.test.ts`

#### Process Commands
- [ ] `bin/commands/doctor.ts` - Check dependency health
- [ ] `bin/commands/doctor.test.ts`
- [ ] `bin/commands/init.ts` - Initialize swarm in project
- [ ] `bin/commands/init.test.ts`
- [ ] `bin/commands/migrate.ts` - PGLite→libSQL, beads→hive migrations
- [ ] `bin/commands/migrate.test.ts`

#### Database Commands
- [ ] `bin/commands/cells.ts` - List/query hive cells
- [ ] `bin/commands/cells.test.ts`
- [ ] `bin/commands/logs.ts` - View and filter swarm logs
- [ ] `bin/commands/logs.test.ts`
- [ ] `bin/commands/stats.ts` - Show health metrics
- [ ] `bin/commands/stats.test.ts`
- [ ] `bin/commands/history.ts` - Swarm activity timeline
- [ ] `bin/commands/history.test.ts`
- [ ] `bin/commands/query.ts` - SQL queries with presets
- [ ] `bin/commands/query.test.ts`
- [ ] `bin/commands/db.ts` - Database info and debug
- [ ] `bin/commands/db.test.ts`

#### Server Commands
- [ ] `bin/commands/serve.ts` - Start SSE server
- [ ] `bin/commands/serve.test.ts`
- [ ] `bin/commands/viz.ts` - Alias for serve
- [ ] `bin/commands/dashboard.ts` - Live terminal UI
- [ ] `bin/commands/dashboard.test.ts`

#### Eval Subcommands
- [ ] `bin/commands/eval/index.ts` - Subcommand router
- [ ] `bin/commands/eval/status.ts` - Show eval phase and thresholds
- [ ] `bin/commands/eval/status.test.ts`
- [ ] `bin/commands/eval/history.ts` - Score trends over time
- [ ] `bin/commands/eval/history.test.ts`
- [ ] `bin/commands/eval/run.ts` - Execute evals with gate checking
- [ ] `bin/commands/eval/run.test.ts`

#### Observability Commands
- [ ] `bin/commands/o11y.ts` - Observability health dashboard
- [ ] `bin/commands/o11y.test.ts`
- [ ] `bin/commands/replay.ts` - Replay epic events with timing
- [ ] `bin/commands/replay.test.ts`
- [ ] `bin/commands/export.ts` - Export events as JSON/CSV/OTLP
- [ ] `bin/commands/export.test.ts`
- [ ] `bin/commands/capture.ts` - Capture eval events
- [ ] `bin/commands/capture.test.ts`

#### Other Commands
- [ ] `bin/commands/tool.ts` - List and execute plugin tools
- [ ] `bin/commands/tool.test.ts`
- [ ] `bin/commands/agents.ts` - Generate agents.md
- [ ] `bin/commands/agents.test.ts`

#### Complex Commands
- [ ] `bin/commands/setup.ts` - Interactive installer (FINAL BOSS)
- [ ] `bin/commands/setup.test.ts`

---

### Phase 4: Integration

- [ ] `bin/commands/index.ts` - Command registry (Map<string, Command>)
- [ ] `bin/swarm.ts` - Thin router (~100 lines)
- [ ] Verify all existing tests pass
- [ ] Verify CLI behavior unchanged

---

### Completion Log

<!-- Workers: Add entry when completing ANY checkbox above -->
<!-- Format: YYYY-MM-DD | checkbox item | agent name | hivemind memory ID | notes -->

| Date | Task | Agent | Memory ID | Notes |
|------|------|-------|-----------|-------|
| | | | | |

---

```
          🐝 → 📦 → 📦 → 📦
         /        /        \
   monolith   commands    services
   (before)   (phase 1)   (phase 2-4)
   
   "From one big thing to many small things"
```
