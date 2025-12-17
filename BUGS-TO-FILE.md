# Bugs to File After OpenCode Restart

## 1. PGLite corruption causes permanent failure until restart
- streams database at `.opencode/streams` got corrupted
- WASM aborts with "Aborted(). Build with -sASSERTIONS for more info."
- Corrupted instance cached in `instances` Map
- No way to recover without restarting OpenCode
- FIX: Add cache invalidation on error, retry with fresh instance

## 2. Fallback to in-memory loses all data
- When persistent PGLite fails, falls back to `new PGlite()` (in-memory)
- All beads, events, reservations lost
- FIX: Should fail loudly instead of silently losing data, or at least warn user

## 3. No health check / recovery mechanism
- No way to detect corrupted database
- No way to force re-initialization
- FIX: Add `swarm_health` tool that can detect and recover from corruption

## Current State
- Wave 1 (swarm-mail rename) COMPLETED by worker
- Plugin rename NOT started
- All beads filed during this session LOST (in corrupted DB)
- Need to restart OpenCode and re-file beads
