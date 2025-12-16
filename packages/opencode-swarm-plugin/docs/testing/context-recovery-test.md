# Context Recovery Manual Test Scenario

## Overview

This test scenario verifies that the swarm coordination system can survive context death and recover from checkpoints. It proves that work-in-progress state is preserved across session boundaries, enabling agents to resume work after catastrophic context loss.

**What this tests:**
- Automatic checkpoint creation at progress milestones (25%, 50%, 75%)
- State persistence to swarm-mail event store
- Recovery mechanism that restores agent state
- Continuity of work across session boundaries

**Success criteria:**
- Agent can resume work from exact state before context loss
- All file modifications are tracked
- Progress percentage is preserved
- Coordinator context and directives are restored

---

## Prerequisites

### Required Setup
1. **Project with swarm-mail initialized**
   ```bash
   cd /path/to/your/project
   # Ensure swarm-mail database exists
   ```

2. **OpenCode Swarm Plugin installed**
   ```bash
   npm install opencode-swarm-plugin
   # or
   bun add opencode-swarm-plugin
   ```

3. **Test bead structure**
   - Epic bead with at least one subtask
   - Example:
     ```bash
     beads_create_epic(
       epic_title: "Test Context Recovery",
       subtasks: [
         { title: "Modify test files", files: ["test/file1.ts", "test/file2.ts"] }
       ]
     )
     ```

4. **Two terminal windows/sessions**
   - Session A: For initial work (will be killed)
   - Session B: For recovery

---

## Test Procedure

### Phase 1: Start Initial Work Session

**Session A - Terminal 1**

1. **Initialize swarm mail**
   ```typescript
   swarmmail_init(
     project_path: "/absolute/path/to/project",
     task_description: "bd-123.1: Test context recovery feature"
   )
   ```
   
   **Expected result:**
   ```json
   {
     "success": true,
     "data": {
       "agent_name": "BlueLake",  // Random agent name
       "project_key": "/absolute/path/to/project"
     }
   }
   ```
   
   **Verify:**
   - ✅ Agent name assigned (e.g., "BlueLake")
   - ✅ Project key matches your path

2. **Reserve files for work**
   ```typescript
   swarmmail_reserve(
     paths: ["test/file1.ts", "test/file2.ts"],
     reason: "bd-123.1: Context recovery test",
     ttl_seconds: 3600
   )
   ```
   
   **Expected result:**
   ```json
   {
     "success": true,
     "data": {
       "reservation_ids": [1, 2],
       "agent_name": "BlueLake",
       "expires_at": 1234567890
     }
   }
   ```
   
   **Verify:**
   - ✅ Reservation IDs returned
   - ✅ Files locked to this agent

3. **Make some file modifications**
   ```bash
   # Modify test/file1.ts
   echo "// First change" >> test/file1.ts
   ```
   
   **Expected result:**
   - File modified on disk
   
   **Verify:**
   - ✅ File contains new content

4. **Report 50% progress (triggers auto-checkpoint)**
   ```typescript
   swarm_progress(
     project_key: "/absolute/path/to/project",
     agent_name: "BlueLake",
     bead_id: "bd-123.1",
     status: "in_progress",
     progress_percent: 50,
     message: "Completed first file modification",
     files_touched: ["test/file1.ts"]
   )
   ```
   
   **Expected result:**
   ```json
   {
     "success": true,
     "data": {
       "checkpoint_created": true,
       "message": "Progress reported and checkpoint saved"
     }
   }
   ```
   
   **Verify:**
   - ✅ Checkpoint creation confirmed
   - ✅ Progress percentage is 50
   - ✅ Files touched recorded

5. **Verify checkpoint was created in swarm-mail**
   ```typescript
   // Query the event store directly (if you have access)
   // Or check via beads metadata
   beads_query(status: "in_progress")
   ```
   
   **Expected result:**
   - Bead shows 50% progress
   - Checkpoint event exists in event store
   
   **Verify:**
   - ✅ Checkpoint event type: "swarm_checkpoint_created"
   - ✅ Recovery data includes: epic_id, bead_id, files, progress_percent, files_modified

---

### Phase 2: Simulate Context Death

**Session A - Terminal 1**

6. **Kill the session abruptly**
   ```bash
   # Press Ctrl+C or kill the terminal
   # DO NOT gracefully close - simulate crash
   ```
   
   **Expected result:**
   - Session terminates immediately
   - No cleanup runs
   
   **Verify:**
   - ✅ Session ended ungracefully
   - ✅ Agent did NOT release reservations
   - ✅ Work state is "frozen" in event store

---

### Phase 3: Recover State in New Session

**Session B - Terminal 2**

7. **Start fresh session (simulate new agent)**
   ```typescript
   swarmmail_init(
     project_path: "/absolute/path/to/project",
     task_description: "Recovering from context death"
   )
   ```
   
   **Expected result:**
   ```json
   {
     "success": true,
     "data": {
       "agent_name": "CrimsonPeak",  // DIFFERENT agent name
       "project_key": "/absolute/path/to/project"
     }
   }
   ```
   
   **Verify:**
   - ✅ New agent name (different from Session A)
   - ✅ Fresh session started

8. **Attempt recovery**
   ```typescript
   swarm_recover(
     project_key: "/absolute/path/to/project",
     bead_id: "bd-123.1"
   )
   ```
   
   **Expected result:**
   ```json
   {
     "success": true,
     "data": {
       "recovered": true,
       "checkpoint": {
         "epic_id": "bd-123",
         "bead_id": "bd-123.1",
         "strategy": "file-based",
         "files": ["test/file1.ts", "test/file2.ts"],
         "recovery": {
           "last_checkpoint": 1234567890,
           "files_modified": ["test/file1.ts"],
           "progress_percent": 50,
           "last_message": "Completed first file modification"
         },
         "directives": {
           "shared_context": "Test context recovery feature",
           "coordinator_notes": "Resume from 50% completion"
         }
       },
       "message": "State recovered from checkpoint at 50%"
     }
   }
   ```
   
   **Verify:**
   - ✅ Recovery successful
   - ✅ Progress is 50% (matches last checkpoint)
   - ✅ Files modified list is correct
   - ✅ Last message preserved
   - ✅ Strategy and directives restored

9. **Verify file reservations were transferred**
   ```typescript
   // Check inbox for reservation status
   swarmmail_inbox(limit: 5)
   ```
   
   **Expected result:**
   - Reservations still exist (orphaned from BlueLake)
   - OR recovery automatically transferred ownership to CrimsonPeak
   
   **Verify:**
   - ✅ Files are either still reserved or available for new reservation
   - ✅ No reservation conflicts

10. **Resume work with recovered state**
    ```bash
    # Modify test/file2.ts (continue where Session A left off)
    echo "// Second change" >> test/file2.ts
    ```
    
    **Expected result:**
    - File modified successfully
    
    **Verify:**
    - ✅ Agent can continue work
    - ✅ File modifications build on previous state

11. **Report completion**
    ```typescript
    swarm_complete(
      project_key: "/absolute/path/to/project",
      agent_name: "CrimsonPeak",
      bead_id: "bd-123.1",
      summary: "Completed context recovery test - survived session death",
      files_touched: ["test/file1.ts", "test/file2.ts"]
    )
    ```
    
    **Expected result:**
    ```json
    {
      "success": true,
      "data": {
        "bead_closed": true,
        "reservations_released": true,
        "ubs_scan_passed": true
      }
    }
    ```
    
    **Verify:**
    - ✅ Bead marked complete
    - ✅ Reservations released
    - ✅ All files touched recorded (both sessions combined)

---

## Verification Checklist

### Checkpoint Creation
- [ ] Auto-checkpoint triggered at 50% progress
- [ ] Checkpoint includes epic_id, bead_id, strategy
- [ ] Files list preserved
- [ ] Progress percentage stored
- [ ] Files modified list accurate
- [ ] Last message captured

### Recovery Mechanism
- [ ] New session can query checkpoint by bead_id
- [ ] All checkpoint data restored correctly
- [ ] Directives and context preserved
- [ ] Recovery returns actionable state object

### State Continuity
- [ ] Work can resume from exact checkpoint state
- [ ] File modifications from Session A are visible
- [ ] Progress percentage matches last checkpoint (50%)
- [ ] Completion acknowledges full file list (both sessions)

### Edge Cases
- [ ] Recovery fails gracefully if no checkpoint exists
- [ ] Recovery handles multiple checkpoints (returns latest)
- [ ] Orphaned reservations don't block recovery
- [ ] Recovery works across different agent names

---

## Expected Failure Modes (Negative Testing)

### Test 1: Recovery with No Checkpoint
```typescript
swarm_recover(
  project_key: "/path/to/project",
  bead_id: "bd-999.1"  // Non-existent bead
)
```

**Expected result:**
```json
{
  "success": false,
  "error": "No checkpoint found for bead bd-999.1"
}
```

### Test 2: Recovery Before Any Progress
```typescript
// Create bead but never report progress
swarm_recover(
  project_key: "/path/to/project",
  bead_id: "bd-123.2"
)
```

**Expected result:**
```json
{
  "success": false,
  "error": "No checkpoint found - agent never reported progress"
}
```

### Test 3: Manual Checkpoint Creation
```typescript
// Agent can force checkpoint at any time
swarm_checkpoint(
  project_key: "/path/to/project",
  bead_id: "bd-123.1",
  checkpoint_data: {
    progress_percent: 33,
    files_modified: ["test/file1.ts"],
    message: "Manual checkpoint before risky operation"
  }
)
```

**Expected result:**
```json
{
  "success": true,
  "data": {
    "checkpoint_id": 42,
    "message": "Manual checkpoint created"
  }
}
```

---

## Troubleshooting

### Issue: Recovery returns empty checkpoint
**Cause:** Checkpoint event not committed to event store  
**Fix:** Verify `swarm_progress` was called with `progress_percent >= 25`

### Issue: Files modified in Session A not visible in Session B
**Cause:** File changes not committed to git or filesystem  
**Fix:** Ensure file writes are flushed before killing session

### Issue: Reservation conflicts after recovery
**Cause:** Orphaned reservations from dead agent  
**Fix:** Implement TTL-based reservation expiry or manual release by project_key

### Issue: Multiple checkpoints confuse recovery
**Cause:** Recovery not selecting latest checkpoint  
**Fix:** Verify recovery queries `ORDER BY timestamp DESC LIMIT 1`

---

## Advanced Scenarios

### Scenario A: Coordinator Death
1. Coordinator spawns 5 worker agents
2. Coordinator dies at 60% overall completion
3. New coordinator recovers state for all workers
4. Workers continue reporting to new coordinator

### Scenario B: Cascading Recovery
1. Worker A checkpoints at 50%
2. Worker A dies
3. Worker B recovers Worker A's state
4. Worker B checkpoints at 75%
5. Worker B dies
6. Worker C recovers Worker B's state (which includes Worker A's progress)

### Scenario C: Partial File Reservation
1. Agent reserves 10 files
2. Modifies 3 files
3. Dies at 30%
4. Recovery agent only needs to work on remaining 7 files

---

## Success Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Recovery accuracy | 100% state match | _____ |
| Time to recover | < 5 seconds | _____ |
| Data loss | 0 bytes | _____ |
| Checkpoint overhead | < 100ms per checkpoint | _____ |
| Storage per checkpoint | < 10KB | _____ |

---

## Conclusion

This manual test proves that:
1. ✅ Agents can survive catastrophic context loss
2. ✅ Work state is preserved in event-sourced storage
3. ✅ Recovery is deterministic and accurate
4. ✅ Multi-session workflows are possible

**Sign-off:** If all verification checkboxes are marked and success metrics met, the context recovery feature is production-ready.
