---
"opencode-swarm-plugin": patch
---

## 🔧 CLI No Longer Chokes on Missing Evalite

```
  BEFORE                           AFTER
    ┌──────────┐                    ┌──────────┐
    │ swarm    │                    │ swarm    │
    │ setup    │ ──ERROR──►         │ setup    │ ──WORKS──►
    │          │  evalite/runner    │          │
    └──────────┘  not found         └──────────┘
```

Fixed `Cannot find module 'evalite/runner'` error when running `swarm` CLI after npm install.

**Root cause:** `evalTools` was imported in the main plugin bundle, but `evalite` is a devDependency not available in production installs.

**Fix:** Removed `evalTools` from the main bundle. To run evals, use `bunx evalite run` directly.
