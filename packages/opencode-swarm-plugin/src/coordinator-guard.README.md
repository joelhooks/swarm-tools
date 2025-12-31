# Coordinator Guard - Runtime Violation Enforcement

**Status**: ✅ Active (integrated into plugin `tool.execute.before` hook)

## What It Does

The coordinator guard **REJECTS** (throws errors) when coordinators attempt to perform work that should be delegated to workers. This is runtime enforcement - even if a coordinator tries to edit files, the guard catches and blocks it.

## Why It Exists

**Problem**: Coordinators were violating protocol 19.6% of the time by:
- Editing files directly instead of spawning workers
- Running tests instead of reviewing worker output
- Reserving files (workers reserve, coordinators don't edit)

**Solution**: Runtime guard that throws `CoordinatorGuardError` when violations are detected.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Plugin Hook Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  tool.execute.before                                        │
│    │                                                        │
│    ├─ Detect coordinator context                           │
│    │  (hive_create_epic, swarm_decompose, task spawn)      │
│    │                                                        │
│    ├─ If coordinator context active:                       │
│    │    │                                                   │
│    │    ├─ checkCoordinatorGuard()                         │
│    │    │    │                                              │
│    │    │    ├─ Check if tool is forbidden                 │
│    │    │    ├─ Check agent context (coordinator vs worker)│
│    │    │    └─ Return { blocked, error }                  │
│    │    │                                                   │
│    │    └─ If blocked: THROW CoordinatorGuardError         │
│    │       (tool execution stops here)                     │
│    │                                                        │
│    └─ Also: detectCoordinatorViolation() for analytics     │
│       (warning only, doesn't block)                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Violations Detected

### 1. File Modification (`coordinator_edited_file`)

**Blocked tools**: `edit`, `write`

**Error message**:
```
❌ COORDINATOR VIOLATION: Coordinators must spawn a worker to edit files.

You attempted to edit: src/auth.ts

Coordinators orchestrate work, they don't implement it.

Instead:
1. Use swarm_spawn_subtask to spawn a worker for this file
2. Let the worker reserve the file and make edits
3. Review the worker's output when complete
```

### 2. Test Execution (`coordinator_ran_tests`)

**Blocked tools**: `bash` with test commands

**Patterns detected**:
- `bun test`
- `npm test`, `npm run test`
- `yarn test`, `pnpm test`
- `jest`, `vitest`, `mocha`, `ava`, `tape`
- `*.test.ts`, `*.spec.js`

**Error message**:
```
❌ COORDINATOR VIOLATION: Coordinators must not run tests.

You attempted to run: bun test src/

Workers run tests as part of their implementation verification.
Coordinators review the test results.

Instead:
1. Let workers run tests in their implementation workflow
2. Workers call swarm_complete which runs tests automatically
3. Review test results from worker output
```

### 3. File Reservation (`coordinator_reserved_files`)

**Blocked tools**: `swarmmail_reserve`, `agentmail_reserve`

**Error message**:
```
❌ COORDINATOR VIOLATION: Coordinators must not reserve files.

You attempted to reserve: src/auth/**

Workers reserve files before editing to prevent conflicts.
Coordinators don't edit files, so they don't reserve them.

Instead:
1. Spawn workers via swarm_spawn_subtask
2. Workers will reserve files they need to modify
3. Coordinate if multiple workers need the same files
```

## How It Works

### Coordinator Context Detection

The guard only activates when coordinator context is set. This happens when:

1. **Epic creation**: `hive_create_epic` is called
2. **Decomposition**: `swarm_decompose` is called
3. **Worker spawn**: Task tool spawns a swarm-worker agent

Context is **session-scoped** - each session has its own coordinator state.

### Guard Check Flow

```typescript
// In tool.execute.before hook
if (isInCoordinatorContext(sessionId)) {
  const guardResult = checkCoordinatorGuard({
    agentContext: "coordinator",
    toolName,
    toolArgs: output.args,
  });

  if (guardResult.blocked && guardResult.error) {
    throw guardResult.error; // ❌ BLOCKS tool execution
  }
}
```

### Worker Safety

Workers are **never blocked** by the guard. The `agentContext` parameter distinguishes:

- `agentContext: "coordinator"` → guard checks apply
- `agentContext: "worker"` → guard is bypassed

In practice, workers don't trigger coordinator context, so they're not affected.

## Usage

### Programmatic Usage

```typescript
import { checkCoordinatorGuard, CoordinatorGuardError } from "opencode-swarm-plugin";

// Check if a tool call would be blocked
const result = checkCoordinatorGuard({
  agentContext: "coordinator",
  toolName: "edit",
  toolArgs: { filePath: "src/auth.ts" },
});

if (result.blocked) {
  console.error(result.error?.message);
  console.log(result.error?.suggestion);
  // Don't proceed with tool call
}
```

### Error Handling

```typescript
try {
  // This would be blocked by the guard
  await editFile("src/auth.ts");
} catch (error) {
  if (error instanceof CoordinatorGuardError) {
    console.error("Coordinator violation:", error.violationType);
    console.log("Suggestion:", error.suggestion);
    console.log("Payload:", error.payload);
  }
}
```

## Integration with Analytics

The guard works alongside `planning-guardrails.ts`:

- **Guard** (coordinator-guard.ts): BLOCKS violations by throwing
- **Analytics** (planning-guardrails.ts): WARNS and captures events

Both run in the same hook:

```typescript
// 1. Enforce guard (BLOCKS if violation)
const guardResult = checkCoordinatorGuard(...);
if (guardResult.blocked) throw guardResult.error;

// 2. Capture analytics (WARNS only)
const violation = detectCoordinatorViolation(...);
if (violation.isViolation) console.warn(violation.message);
```

This means:
- Violations are **prevented** by the guard
- Violations are **logged** for analysis
- Eval capture gets violation events

## Testing

### Unit Tests

```bash
bun test src/coordinator-guard.test.ts
```

**Coverage**:
- ✅ Blocks coordinator file edits
- ✅ Blocks coordinator test execution
- ✅ Blocks coordinator file reservations
- ✅ Allows workers to edit/test/reserve
- ✅ Error messages include helpful suggestions
- ✅ Test execution patterns match all runners

### Integration Tests

```bash
bun test src/coordinator-guard.integration.test.ts
```

**Coverage**:
- ✅ Guard integrates with coordinator context system
- ✅ Session-scoped context works correctly
- ✅ Workers bypass guard even when coordinator context active
- ✅ Errors include actionable suggestions

## Expected Impact

**Goal**: Reduce coordinator violation rate from 19.6% to under 5%

**Mechanism**: Runtime rejection prevents violations from completing

**Hypothesis**: Coordinators will learn to spawn workers when the guard rejects their edit attempts

## Related Files

- `src/coordinator-guard.ts` - Guard implementation
- `src/coordinator-guard.test.ts` - Unit tests
- `src/coordinator-guard.integration.test.ts` - Integration tests
- `src/planning-guardrails.ts` - Analytics and warnings (non-blocking)
- `src/index.ts` - Plugin integration (hook wiring)
- `src/eval-capture.ts` - Violation event capture for evals

## Future Enhancements

1. **Violation Rate Monitoring**: Dashboard showing guard blocks over time
2. **Escape Hatch**: `--force-coordinator-edit` flag for emergencies
3. **Learning Mode**: Warn-only mode for training period, then enforce
4. **Custom Messages**: Per-project violation messages in config
5. **Allowlist**: Specific files coordinators CAN edit (e.g., README.md)
