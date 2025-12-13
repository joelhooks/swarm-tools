---
name: cli-builder
description: Guide for building TypeScript CLIs with Bun. Use when creating command-line tools, adding subcommands to existing CLIs, or building developer tooling. Covers argument parsing, subcommand patterns, output formatting, and distribution.
tags:
  - cli
  - typescript
  - bun
  - tooling
---

# CLI Builder

Build TypeScript command-line tools with Bun.

## When to Build a CLI

CLIs are ideal for:
- Developer tools and automation
- Project-specific commands (`swarm`, `bd`, etc.)
- Scripts that need arguments/flags
- Tools that compose with shell pipelines

## Quick Start

### Minimal CLI

```typescript
#!/usr/bin/env bun
// scripts/my-tool.ts

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help") {
  console.log(`
Usage: my-tool <command>

Commands:
  hello    Say hello
  help     Show this message
`);
  process.exit(0);
}

if (command === "hello") {
  console.log("Hello, world!");
}
```

Run with: `bun scripts/my-tool.ts hello`

### With Argument Parsing

Use `parseArgs` from Node's `util` module (works in Bun):

```typescript
#!/usr/bin/env bun
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: "string", short: "n" },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Usage: greet [options] <message>

Options:
  -n, --name <name>   Name to greet
  -v, --verbose       Verbose output
  -h, --help          Show help
`);
  process.exit(0);
}

const message = positionals[0] || "Hello";
const name = values.name || "World";

console.log(`${message}, ${name}!`);
if (values.verbose) {
  console.log(`  (greeted at ${new Date().toISOString()})`);
}
```

## Subcommand Pattern

For CLIs with multiple commands, use a command registry:

```typescript
#!/usr/bin/env bun
import { parseArgs } from "util";

type Command = {
  description: string;
  run: (args: string[]) => Promise<void>;
};

const commands: Record<string, Command> = {
  init: {
    description: "Initialize a new project",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          template: { type: "string", short: "t", default: "default" },
        },
      });
      console.log(`Initializing with template: ${values.template}`);
    },
  },

  build: {
    description: "Build the project",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          watch: { type: "boolean", short: "w", default: false },
        },
      });
      console.log(`Building...${values.watch ? " (watch mode)" : ""}`);
    },
  },
};

function showHelp() {
  console.log(`
Usage: mytool <command> [options]

Commands:`);
  for (const [name, cmd] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(12)} ${cmd.description}`);
  }
  console.log(`
Run 'mytool <command> --help' for command-specific help.
`);
}

// Main
const [command, ...args] = process.argv.slice(2);

if (!command || command === "help" || command === "--help") {
  showHelp();
  process.exit(0);
}

const cmd = commands[command];
if (!cmd) {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}

await cmd.run(args);
```

## Output Formatting

### Colors (without dependencies)

```typescript
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg: string) {
  console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

function warn(msg: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}
```

### JSON Output Mode

Support `--json` for scriptable output:

```typescript
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const result = { status: "ok", items: ["a", "b", "c"] };

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Status:", result.status);
  console.log("Items:", result.items.join(", "));
}
```

### Progress Indicators

```typescript
function spinner(message: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  const id = setInterval(() => {
    process.stdout.write(`\r${frames[i++ % frames.length]} ${message}`);
  }, 80);

  return {
    stop: (finalMessage?: string) => {
      clearInterval(id);
      process.stdout.write(`\r${finalMessage || message}\n`);
    },
  };
}

// Usage
const spin = spinner("Loading...");
await someAsyncWork();
spin.stop("✓ Done!");
```

## File System Operations

```typescript
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";

// Ensure directory exists before writing
async function writeFileWithDir(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

// Read JSON with defaults
async function readJsonFile<T>(path: string, defaults: T): Promise<T> {
  if (!existsSync(path)) return defaults;
  const content = await readFile(path, "utf-8");
  return { ...defaults, ...JSON.parse(content) };
}
```

## Shell Execution

```typescript
import { $ } from "bun";

// Simple command
const result = await $`git status`.text();

// With error handling
try {
  await $`npm test`.quiet();
  console.log("Tests passed!");
} catch (error) {
  console.error("Tests failed");
  process.exit(1);
}

// Capture output
const branch = await $`git branch --show-current`.text();
console.log(`Current branch: ${branch.trim()}`);
```

## Error Handling

```typescript
class CLIError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
    this.name = "CLIError";
  }
}

async function main() {
  try {
    await runCommand();
  } catch (error) {
    if (error instanceof CLIError) {
      console.error(`Error: ${error.message}`);
      process.exit(error.exitCode);
    }
    throw error; // Re-throw unexpected errors
  }
}

main();
```

## Distribution

### package.json bin field

```json
{
  "name": "my-cli",
  "bin": {
    "mycli": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build ./src/cli.ts --outfile ./dist/cli.js --target node"
  }
}
```

### Shebang for direct execution

```typescript
#!/usr/bin/env bun
// First line of your CLI script
```

Make executable: `chmod +x scripts/my-cli.ts`

## Best Practices

1. **Always provide --help** - Users expect it
2. **Exit codes matter** - 0 for success, non-zero for errors
3. **Support --json** - For scriptability and piping
4. **Fail fast** - Validate inputs early
5. **Be quiet by default** - Use --verbose for noise
6. **Respect NO_COLOR** - Check `process.env.NO_COLOR`
7. **Stream large output** - Don't buffer everything in memory
