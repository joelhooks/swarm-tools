# Git Worktree Support

## Problem

Git worktrees allow working on multiple branches simultaneously. Each worktree has its own working directory but shares the `.git` repository with the main repo.

Previously, when swarm-mail operations ran in a worktree, they would create separate `.opencode/` directories in each worktree, leading to:

- Separate databases per worktree
- Lost coordination between agents in different worktrees
- Migration detection looking in the wrong location

## Solution

The `worktree.ts` module detects git worktrees and resolves all database paths to the main repository:

```typescript
import { isWorktree, getMainRepoPath, resolveDbPath } from "swarm-mail/db";

// Detect worktree
if (isWorktree("/path/to/worktree")) {
  // Get main repo path
  const mainPath = getMainRepoPath("/path/to/worktree");
  // /path/to/main-repo

  // Resolve DB path (always uses main repo)
  const dbPath = resolveDbPath("/path/to/worktree");
  // /path/to/main-repo/.opencode/swarm.db
}
```

## How It Works

### Worktree Detection

In a git worktree, `.git` is a **FILE** (not a directory) containing:

```
gitdir: /path/to/main/.git/worktrees/<name>
```

`isWorktree()` checks if `.git` is a file vs a directory.

### Main Repo Path Resolution

`getMainRepoPath()` parses the `.git` file and navigates up from the worktrees directory:

```
/path/to/main/.git/worktrees/<name>  (gitdir from .git file)
       ↓
/path/to/main  (go up 3 levels: name → worktrees → .git → main)
```

### Database Path Resolution

`resolveDbPath()` ensures all worktrees use the main repo's `.opencode/` directory:

```typescript
// Worktree
resolveDbPath("/path/to/worktree");
// → /path/to/main-repo/.opencode/swarm.db

// Main repo (pass-through)
resolveDbPath("/path/to/main-repo");
// → /path/to/main-repo/.opencode/swarm.db
```

## Integration

### Migration Detection

`getOldProjectDbPaths()` in `streams/index.ts` now uses worktree resolution:

```typescript
export function getOldProjectDbPaths(projectPath: string): {
  libsql: string;
  pglite: string;
} {
  const mainRepoPath = getMainRepoPath(projectPath);
  const localDir = join(mainRepoPath, ".opencode");
  return {
    libsql: join(localDir, "streams.db"),
    pglite: join(localDir, "streams"),
  };
}
```

This ensures migration detection looks in the main repo's `.opencode/`, not the worktree's.

## References

- [Git Worktree Docs](https://git-scm.com/docs/git-worktree)
- Original issue: https://github.com/joelhooks/opencode-swarm-plugin/issues/52
- Inspired by: https://github.com/steveyegge/beads/blob/main/docs/WORKTREES.md

## Testing

See `worktree.test.ts` for comprehensive tests including:

- Worktree detection
- Main repo path resolution
- DB path resolution
- Integration with `getOldProjectDbPaths()`
