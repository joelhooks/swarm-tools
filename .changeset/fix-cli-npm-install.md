---
"opencode-swarm-plugin": patch
---

## 🔧 Fix CLI Breaking on npm Install

> "The best code is no code at all."
> — Jeff Atwood

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE: npm install → "Cannot find module '../src/index'"  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  bin/swarm.ts ──import──► ../src/query-tools.js  ❌         │
│                                                             │
│  Published package:                                         │
│  ├── bin/swarm.ts     (raw TypeScript)                      │
│  ├── dist/            (compiled JS)                         │
│  └── src/             ❌ NOT PUBLISHED                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  AFTER: npm install → works                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  dist/bin/swarm.js ──bundled──► all deps inlined  ✅        │
│                                                             │
│  Published package:                                         │
│  ├── dist/bin/swarm.js  (compiled, bundled)                 │
│  └── dist/              (all modules)                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**The Problem:**

CLI used dynamic imports pointing to `../src/` which doesn't exist in published packages. This broke `bun install -g opencode-swarm-plugin` with "Cannot find module" errors.

**The Fix:**

1. **Compile CLI to dist/** - Added `bin/swarm.ts` to build entries
2. **Static imports** - Replaced 20 dynamic imports with static ones (bundler resolves them)
3. **Update bin path** - `package.json` bin now points to `./dist/bin/swarm.js`

**Why dynamic imports were wrong:**

- "Lazy loading for performance" on an M4 Max is absurd
- Bun tree-shakes unused imports anyway
- Dynamic imports bypass bundler resolution
- Paths break when `src/` isn't published

**What changed:**

- `scripts/build.ts` - Added CLI build entry
- `package.json` - bin points to compiled output
- `bin/swarm.ts` - All imports now static, paths relative to src/

**Testing:**

```bash
# Build
bun run build

# Test locally
node dist/bin/swarm.js version

# Test global install
bun install -g .
swarm version
```
