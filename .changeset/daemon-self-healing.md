---
"swarm-mail": minor
---

## 🐝 Daemon Mode Now Self-Heals

The daemon socket connection was fragile - it would error out instead of recovering from common scenarios like stale PID files or race conditions.

**Changes:**

### 1. New Default Port: 15433
Moved from 5433 (too close to Postgres default) to 15433. Override with `SWARM_MAIL_SOCKET_PORT`.

### 2. Self-Healing Connection Logic
New flow tries connecting FIRST before starting:

```
1. Health check → if healthy, connect immediately
2. Check for stale PID → clean up if process dead
3. Try startDaemon with retry loop
4. On EADDRINUSE, wait and retry health check (another process may have started it)
5. Only error after all recovery attempts fail
```

### 3. Exported `cleanupPidFile`
Now available for external cleanup scenarios.

**What this fixes:**
- "Failed to listen at 127.0.0.1" errors
- Stale PID files blocking startup
- Race conditions when multiple processes start simultaneously
- Daemon crashes requiring manual `pkill` intervention

**Tests added:** 4 new tests covering self-healing scenarios.
