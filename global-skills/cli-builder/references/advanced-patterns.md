# Advanced CLI Patterns

## Interactive Prompts

For interactive CLIs, use `@clack/prompts` (lightweight, pretty):

```typescript
import * as p from "@clack/prompts";

async function setup() {
  p.intro("Project Setup");

  const name = await p.text({
    message: "Project name?",
    placeholder: "my-project",
    validate: (v) => (v.length < 1 ? "Name required" : undefined),
  });

  const template = await p.select({
    message: "Choose a template",
    options: [
      { value: "basic", label: "Basic" },
      { value: "full", label: "Full Featured" },
    ],
  });

  const features = await p.multiselect({
    message: "Select features",
    options: [
      { value: "typescript", label: "TypeScript" },
      { value: "testing", label: "Testing" },
      { value: "linting", label: "Linting" },
    ],
  });

  const confirmed = await p.confirm({
    message: "Create project?",
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  const s = p.spinner();
  s.start("Creating project...");
  await createProject({ name, template, features });
  s.stop("Project created!");

  p.outro("Done! Run `cd ${name} && bun dev`");
}
```

## Config File Loading

Support multiple config formats:

```typescript
import { existsSync } from "fs";
import { readFile } from "fs/promises";

interface Config {
  name: string;
  debug: boolean;
}

const CONFIG_FILES = [
  "myapp.config.ts",
  "myapp.config.js",
  "myapp.config.json",
  ".myapprc",
  ".myapprc.json",
];

async function loadConfig(): Promise<Config> {
  const defaults: Config = { name: "default", debug: false };

  for (const file of CONFIG_FILES) {
    if (!existsSync(file)) continue;

    if (file.endsWith(".ts") || file.endsWith(".js")) {
      const mod = await import(`./${file}`);
      return { ...defaults, ...mod.default };
    }

    if (file.endsWith(".json") || file.startsWith(".")) {
      const content = await readFile(file, "utf-8");
      return { ...defaults, ...JSON.parse(content) };
    }
  }

  return defaults;
}
```

## Plugin System

Allow extending CLI with plugins:

```typescript
interface Plugin {
  name: string;
  commands?: Record<string, Command>;
  hooks?: {
    beforeRun?: () => Promise<void>;
    afterRun?: () => Promise<void>;
  };
}

class CLI {
  private plugins: Plugin[] = [];
  private commands: Record<string, Command> = {};

  use(plugin: Plugin) {
    this.plugins.push(plugin);
    if (plugin.commands) {
      Object.assign(this.commands, plugin.commands);
    }
  }

  async run(args: string[]) {
    // Run beforeRun hooks
    for (const p of this.plugins) {
      await p.hooks?.beforeRun?.();
    }

    // Execute command
    const [cmd, ...rest] = args;
    await this.commands[cmd]?.run(rest);

    // Run afterRun hooks
    for (const p of this.plugins) {
      await p.hooks?.afterRun?.();
    }
  }
}
```

## Watching Files

```typescript
import { watch } from "fs";

function watchFiles(
  dir: string,
  callback: (event: string, filename: string) => void
) {
  const watcher = watch(dir, { recursive: true }, (event, filename) => {
    if (filename && !filename.includes("node_modules")) {
      callback(event, filename);
    }
  });

  // Cleanup on exit
  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });

  return watcher;
}

// Usage
watchFiles("./src", (event, file) => {
  console.log(`${event}: ${file}`);
  // Trigger rebuild, restart, etc.
});
```

## Parallel Execution

```typescript
async function runParallel<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 4
) {
  const chunks = [];
  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(fn));
  }
}

// Usage
await runParallel(files, async (file) => {
  await processFile(file);
}, 8);
```

## Testing CLIs

```typescript
import { describe, test, expect } from "bun:test";
import { $ } from "bun";

describe("mycli", () => {
  test("--help shows usage", async () => {
    const result = await $`bun ./src/cli.ts --help`.text();
    expect(result).toContain("Usage:");
  });

  test("unknown command fails", async () => {
    try {
      await $`bun ./src/cli.ts unknown`.quiet();
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error.exitCode).toBe(1);
    }
  });

  test("init creates files", async () => {
    const tmpDir = await $`mktemp -d`.text();
    await $`bun ./src/cli.ts init --path ${tmpDir.trim()}`;

    const files = await $`ls ${tmpDir.trim()}`.text();
    expect(files).toContain("package.json");
  });
});
```

## Graceful Shutdown

```typescript
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\nShutting down...");

  // Cleanup: close connections, save state, etc.
  await cleanup();

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```
