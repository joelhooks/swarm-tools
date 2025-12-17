# Evalite - Swarm Decomposition Evals

TypeScript-native evaluation framework for testing swarm task decomposition quality.

## Quick Start

```bash
# Watch mode for development
pnpm eval:dev

# Run all evals once
pnpm eval:run

# CI mode with 80% threshold
pnpm eval:ci
```

## Structure

```
evals/
├── evalite.config.ts       # Evalite configuration
├── scorers/
│   └── index.ts           # Custom scorers (independence, balance, coverage, clarity)
├── fixtures/
│   └── decomposition-cases.ts  # Test cases with expected outcomes
└── *.eval.ts              # Eval files (auto-discovered)
```

## Custom Scorers

### Subtask Independence (0-1)

Checks no files appear in multiple subtasks. File conflicts cause merge conflicts and coordination overhead.

### Complexity Balance (0-1)

Measures coefficient of variation (CV) of estimated_complexity across subtasks. CV < 0.3 scores 1.0, decreases linearly to 0 at CV = 1.0.

### Coverage Completeness (0-1)

If expected.requiredFiles specified: ratio of covered files.
Otherwise: checks subtask count is within min/max range.

### Instruction Clarity (0-1)

Average quality score per subtask based on:

- Description length > 20 chars (+0.2)
- Files specified (+0.2)
- Non-generic title (+0.1)

## Writing Evals

```typescript
import { evalite } from "evalite";
import { subtaskIndependence, coverageCompleteness } from "./scorers/index.js";

evalite("My decomposition test", {
  data: async () => {
    return [
      {
        input: "Add OAuth authentication",
        expected: {
          minSubtasks: 3,
          maxSubtasks: 6,
          requiredFiles: ["src/auth/oauth.ts", "src/middleware/auth.ts"],
        },
      },
    ];
  },
  task: async (input) => {
    // Call your decomposition logic here
    // Should return CellTree JSON as string
  },
  scorers: [subtaskIndependence, coverageCompleteness],
});
```

## CellTree Format

Scorers expect output as JSON string matching:

```typescript
{
  epic: {
    title: string;
    description: string;
  }
  subtasks: Array<{
    title: string;
    description?: string;
    files?: string[];
    estimated_complexity?: number; // 1-3
  }>;
}
```

## Fixtures

See `fixtures/decomposition-cases.ts` for example test cases covering:

- OAuth implementation
- Rate limiting
- TypeScript migration
- Admin dashboard
- Memory leak debugging
- Feature flag system

## Notes

- Evalite v1.0.0-beta.15 installed
- Built on Vitest
- Runs locally, no API keys required
- Results cached in `node_modules/.evalite/`
- Clear cache if needed: `rm -rf node_modules/.evalite`
