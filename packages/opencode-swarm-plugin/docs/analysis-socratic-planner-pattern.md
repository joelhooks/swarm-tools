# Socratic Planner Pattern Analysis

**Analysis Date:** 2025-12-13  
**Source:** obra/superpowers repo  
**Cell:** opencode-swarm-plugin-v737h.1

## Executive Summary

The Socratic Planner is a two-phase workflow that transforms rough ideas into executable implementation plans through:

1. **Brainstorming** - Collaborative refinement using Socratic questioning
2. **Writing Plans** - Detailed task breakdown for engineers with zero context

The pattern emphasizes **incremental validation**, **extreme granularity**, and **context-free execution**. It's designed to prevent premature commitment while ensuring execution clarity.

---

## Core Principles

### Brainstorming Phase

1. **One Question at a Time** - Never overwhelm with multiple questions in a single message. If a topic needs exploration, break it into sequential questions.

2. **Multiple Choice Preferred** - Easier for users to answer than open-ended when possible, but open-ended is fine when necessary.

3. **Project Context First** - Always check current state (files, docs, recent commits) before asking questions.

4. **Focus on Understanding** - Extract purpose, constraints, and success criteria before proposing solutions.

5. **Explore 2-3 Alternatives** - Always propose multiple approaches with trade-offs. Lead with your recommendation and explain why.

6. **Incremental Validation (200-300 Words)** - Present design in digestible sections, validate each section before continuing. Cover: architecture, components, data flow, error handling, testing.

7. **YAGNI Ruthlessly** - Remove unnecessary features from all designs. Don't build what you don't need.

8. **Be Flexible** - Go back and clarify when something doesn't make sense. The process is iterative.

### Writing Plans Phase

9. **Bite-Sized Tasks (2-5 Minutes Each)** - Each step is ONE action:
   - "Write the failing test" (step)
   - "Run it to make sure it fails" (step)
   - "Implement minimal code to pass" (step)
   - "Run tests to verify" (step)
   - "Commit" (step)

10. **Zero Context Assumption** - Write for a "junior engineer with poor taste, no judgment, no project context." Assume they're skilled but know nothing about your toolset or problem domain.

11. **Exact File Paths Always** - Never say "create a file" - say `exact/path/to/file.py`. Include line numbers for modifications: `existing.py:123-145`.

12. **Complete Code in Plans** - Don't say "add validation" - show the exact code to write.

13. **DRY, YAGNI, TDD** - Enforce these principles in every task. Test-first, minimal implementation, no duplication.

14. **Exact Commands with Expected Output** - Don't say "run tests" - say `pytest tests/path/test.py::test_name -v` and specify what "PASS" looks like.

15. **Frequent Commits** - Every task ends with a commit. Small, atomic changes.

---

## Anti-Patterns to Avoid

### Brainstorming Anti-Patterns

❌ **Multiple Questions per Message** - Overwhelms user, creates decision paralysis  
✅ **One question, wait for answer, next question**

❌ **Proposing One Solution** - Forces user down a single path  
✅ **2-3 alternatives with trade-offs, recommend one with reasoning**

❌ **Presenting Entire Design at Once** - User can't validate incrementally  
✅ **200-300 word sections, check after each**

❌ **Building for Future Needs** - YAGNI violation  
✅ **Ruthlessly strip unnecessary features**

❌ **Starting Questions Before Context** - Asking blind questions  
✅ **Check files/docs/commits first, then ask informed questions**

### Writing Plans Anti-Patterns

❌ **Large Tasks** - "Build the auth system" (30+ minutes)  
✅ **Bite-sized steps: "Write failing test for login" (2-5 min)**

❌ **Assuming Context** - "Update the auth flow" (which file?)  
✅ **`src/auth/login.py:45-67` - exact path and lines**

❌ **Vague Instructions** - "Add error handling"  
✅ **Complete try-catch block with specific exceptions**

❌ **Skipping Test Failures** - "Write test and implementation"  
✅ **Step 1: Write test. Step 2: Run to verify FAIL. Step 3: Implement.**

❌ **Batch Commits** - "Commit all the auth changes"  
✅ **Commit after each passing test**

❌ **Trusting Engineer's Taste** - "Style as appropriate"  
✅ **Exact code, exact format, zero judgment calls**

---

## Implementation Details

### Brainstorming Workflow

```markdown
Phase 1: Understanding the Idea
├─ Check project state (files, docs, commits)
├─ Ask questions one at a time
├─ Prefer multiple choice when possible
└─ Focus: purpose, constraints, success criteria

Phase 2: Exploring Approaches
├─ Propose 2-3 different approaches
├─ Present trade-offs for each
├─ Lead with recommendation + reasoning
└─ Wait for user decision

Phase 3: Presenting the Design
├─ Break into 200-300 word sections
├─ Ask "Does this look right so far?" after each
├─ Cover: architecture, components, data flow, errors, testing
└─ Be ready to backtrack and clarify

Phase 4: Documentation
├─ Save to: docs/plans/YYYY-MM-DD-<topic>-design.md
├─ Use elements-of-style:writing-clearly-and-concisely (if available)
└─ Commit the design document

Phase 5: Implementation Setup (if continuing)
├─ Ask: "Ready to set up for implementation?"
├─ Use superpowers:using-git-worktrees (create isolated workspace)
└─ Use superpowers:writing-plans (create detailed plan)
```

### Writing Plans Workflow

```markdown
Setup
├─ Run in dedicated worktree (created by brainstorming)
└─ Announce: "I'm using the writing-plans skill..."

Plan Structure
├─ Header (REQUIRED format - see below)
├─ Task 1: [Component Name]
│ ├─ Files: (Create/Modify/Test with exact paths)
│ ├─ Step 1: Write failing test (with code)
│ ├─ Step 2: Run test, verify FAIL (exact command + expected output)
│ ├─ Step 3: Write minimal implementation (with code)
│ ├─ Step 4: Run test, verify PASS (exact command)
│ └─ Step 5: Commit (exact git commands)
├─ Task 2: [Component Name]
│ └─ (same structure)
└─ ...

Save
└─ docs/plans/YYYY-MM-DD-<feature-name>.md

Handoff
├─ Offer execution choice:
│ ├─ Option 1: Subagent-Driven (this session)
│ │ └─ Use superpowers:subagent-driven-development
│ └─ Option 2: Parallel Session (separate)
│ └─ Use superpowers:executing-plans
```

### Required Plan Header Format

Every plan MUST start with this exact header:

```markdown
# [Feature Name] Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

### Task Structure Template

````markdown
### Task N: [Component Name]

**Files:**

- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```
````

**Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```

```

---

## How the Two Skills Integrate

### Skill Handoff Flow

```

User: "I want to build X"
↓
[Brainstorming Skill]
├─ Understand idea (Socratic questions)
├─ Explore approaches (2-3 alternatives)
├─ Present design (200-300 word sections)
└─ Save design doc (docs/plans/YYYY-MM-DD-X-design.md)
↓
"Ready to set up for implementation?"
↓
[Using Git Worktrees Skill]
└─ Create isolated workspace
↓
[Writing Plans Skill]
├─ Break design into bite-sized tasks
├─ Exact paths, complete code, exact commands
└─ Save plan (docs/plans/YYYY-MM-DD-X.md)
↓
"Two execution options: Subagent-Driven or Parallel Session?"
↓
┌─────────────────────┬─────────────────────┐
│ Subagent-Driven │ Parallel Session │
│ (same session) │ (separate session) │
├─────────────────────┼─────────────────────┤
│ [Subagent-Driven- │ [Executing-Plans │
│ Development] │ Skill] │
│ ├─ Fresh subagent │ ├─ Load plan │
│ │ per task │ ├─ Review critically│
│ ├─ Code review │ ├─ Execute in │
│ │ after each │ │ batches (3 tasks)│
│ └─ Fast iteration │ ├─ Report for review│
│ │ └─ Continue batches │
└─────────────────────┴─────────────────────┘
↓
[Finishing-a-Development-Branch Skill]
└─ Verify tests, present merge options

```

### Context Preservation Strategy

The two-phase split serves a critical purpose:

1. **Brainstorming keeps context lean** - 200-300 word validation checkpoints prevent bloat
2. **Plans are context-free** - Engineer doesn't need the brainstorming conversation
3. **Plans are reusable** - Can be executed by different agents in different sessions
4. **Incremental validation prevents rework** - Catch design issues before implementation

### When NOT to Use This Pattern

From the brainstorming skill description:

> "Don't use during clear 'mechanical' processes"

Skip brainstorming when:
- Task is purely mechanical (updating dependencies, formatting code)
- Requirements are completely clear and unambiguous
- No design decisions needed (just execution)

---

## Key Quotes Worth Preserving

### On Task Granularity

> "Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well."

> "Each step is one action (2-5 minutes): 'Write the failing test' - step. 'Run it to make sure it fails' - step."

### On Context Assumptions

> "Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste."

> "Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it."

### On Incremental Validation

> "Break it into sections of 200-300 words. Ask after each section whether it looks right so far."

> "Be ready to go back and clarify if something doesn't make sense."

### On Question Design

> "Ask questions one at a time to refine the idea. Prefer multiple choice questions when possible, but open-ended is fine too."

> "Only one question per message - if a topic needs more exploration, break it into multiple questions."

### On Alternative Exploration

> "Propose 2-3 different approaches with trade-offs. Present options conversationally with your recommendation and reasoning. Lead with your recommended option and explain why."

### On Specificity in Plans

> "Exact file paths always. Complete code in plan (not 'add validation'). Exact commands with expected output."

---

## Execution Handoff Options

After plan creation, the pattern offers two execution modes:

### Option 1: Subagent-Driven Development (Same Session)

**Characteristics:**
- Stay in current session
- Fresh subagent per task (no context pollution)
- Code review after each task (catch issues early)
- Faster iteration (no human-in-loop between tasks)

**When to use:**
- Tasks are mostly independent
- Want continuous progress with quality gates
- Need fast iteration

**Process:**
1. Load plan, create TodoWrite
2. For each task:
   - Dispatch implementation subagent
   - Dispatch code-reviewer subagent
   - Fix issues from review
   - Mark complete
3. Final review of entire implementation
4. Use finishing-a-development-branch skill

### Option 2: Executing Plans (Parallel Session)

**Characteristics:**
- Open new session in worktree
- Batch execution (default: 3 tasks per batch)
- Human review between batches
- Architect oversight at checkpoints

**When to use:**
- Need to review plan first
- Tasks are tightly coupled
- Want explicit approval between batches

**Process:**
1. Load plan, review critically
2. Execute batch (3 tasks)
3. Report for feedback
4. Apply changes if needed
5. Continue next batch
6. Use finishing-a-development-branch skill

---

## Integration with Other Skills

### Required Skills (Hard Dependencies)

**Brainstorming uses:**
- `elements-of-style:writing-clearly-and-concisely` (if available) - for design docs
- `superpowers:using-git-worktrees` (REQUIRED) - create isolated workspace
- `superpowers:writing-plans` (REQUIRED) - create implementation plan

**Writing Plans uses:**
- Referenced skills with `@syntax` - embedded in plan steps

**Execution skills use:**
- `superpowers:finishing-a-development-branch` (REQUIRED) - both execution paths

**Subagent-Driven Development uses:**
- `superpowers:requesting-code-review` (REQUIRED) - review template
- `superpowers:test-driven-development` - subagents follow TDD

### Optional Skills

Plans can reference any skill using `@skill-name` syntax. The engineer executing the plan will load and use those skills as needed.

---

## Pattern Maturity Assessment

**Evidence for "Proven" status:**

1. **Clear success criteria** - Bite-sized tasks (2-5 min) are measurable
2. **Incremental validation** - 200-300 word sections prevent big-bang failures
3. **Context-free execution** - Plans work across agents/sessions
4. **Quality gates** - Code review after each task (subagent-driven) or batch (parallel)
5. **TDD enforcement** - Every task follows red-green-refactor

**Potential weaknesses:**

1. **Context switch cost** - Two-phase approach requires handoff overhead
2. **Over-specification** - "Zero context" assumption may create verbose plans
3. **Execution rigidity** - 2-5 minute granularity may not fit all domains

**Overall:** This is a **proven pattern** for transforming ideas into implementation. The incremental validation and extreme task granularity prevent the most common failure modes (premature commitment, vague requirements, context loss).

---

## Comparison with OpenCode Swarm

### Similarities

- Both break work into small, parallelizable tasks
- Both use file reservations to prevent conflicts
- Both emphasize quality gates (UBS scan, code review)
- Both support parallel execution

### Differences

| Aspect | Socratic Planner | OpenCode Swarm |
|--------|------------------|----------------|
| **Decomposition** | Manual (Socratic questions) | Automated (LLM + CASS) |
| **Task size** | 2-5 minutes (extreme granularity) | Varies (file/feature/risk-based) |
| **Context assumption** | Zero context | Shared context via Agent Mail |
| **Execution** | Sequential with reviews | Parallel with coordination |
| **Learning** | Implicit (through review) | Explicit (outcome tracking) |
| **Best for** | Novel features, design-heavy | Known patterns, scale work |

### Integration Opportunities

1. **Use Socratic for decomposition** - Replace swarm_decompose with brainstorming skill for complex features
2. **Use swarm for execution** - Execute writing-plans output via swarm workers instead of subagent-driven
3. **Hybrid approach** - Brainstorm → writing-plans → swarm_spawn_subtask (combine best of both)

---

## Recommendations

### For OpenCode Swarm Plugin

1. **Add brainstorming mode to swarm_decompose** - Offer interactive Socratic questioning for complex tasks
2. **Enforce 2-5 minute task granularity** - Add validation in swarm_validate_decomposition
3. **Steal "zero context" principle** - Worker prompts should assume no codebase knowledge
4. **Add incremental validation** - Option to validate decomposition in chunks (not all-at-once)

### For Skills Library

1. **Port brainstorming skill** - Generalize for OpenCode (remove superpowers-specific refs)
2. **Port writing-plans skill** - Adapt for OpenCode execution model
3. **Create hybrid skill** - Combine Socratic decomposition with swarm execution

### For Learning System

Track these metrics from Socratic-style decompositions:
- **Question count to understanding** - How many questions before design phase?
- **Section validation failures** - Which sections needed rework?
- **Task size drift** - Are tasks staying in 2-5 min range?
- **Context assumptions** - Did engineer have to guess? (signals under-specification)

---

## Appendix: File Locations

**Analyzed files:**
- `skills/brainstorming/SKILL.md`
- `skills/writing-plans/SKILL.md`
- `skills/executing-plans/SKILL.md`
- `skills/subagent-driven-development/SKILL.md`
- `skills/using-git-worktrees/SKILL.md`
- `commands/brainstorm.md`
- `commands/write-plan.md`

**Related skills not analyzed (referenced but not deep-dived):**
- `skills/elements-of-style/writing-clearly-and-concisely/SKILL.md`
- `skills/finishing-a-development-branch/SKILL.md`
- `skills/requesting-code-review/code-reviewer.md`
- `skills/test-driven-development/SKILL.md`

---

**End of Analysis**
```
