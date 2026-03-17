---
name: system-design
description: "Applies software design principles to evaluate and improve code architecture. Use when designing modules, APIs, CLIs, or interfaces meant to be used by others. Use when performing code review, evaluating interface design, refactoring for simplicity, reducing complexity, identifying design red flags, or deciding between deep and shallow module boundaries. Analyzes information hiding, error handling strategies, and abstraction depth. Based on 'A Philosophy of Software Design' by John Ousterhout."
tags:
  - design
  - architecture
  - modules
  - complexity
---

# System Design

Principles for building reusable, maintainable coding systems. From "A Philosophy of Software Design" by John Ousterhout.

## Core Principle: Fight Complexity

Complexity is the root cause of most software problems. It accumulates incrementally—each shortcut adds a little, until the system becomes unmaintainable.

**Complexity defined:** Anything that makes software hard to understand or modify.

**Symptoms:**

- Change amplification: simple change requires many modifications
- Cognitive load: how much you need to know to make a change
- Unknown unknowns: not obvious what needs to change

## Deep Modules

The most important design principle: **make modules deep**.

```
┌─────────────────────────────┐
│      Simple Interface       │  ← Small surface area
├─────────────────────────────┤
│                             │
│                             │
│    Deep Implementation      │  ← Lots of functionality
│                             │
│                             │
└─────────────────────────────┘
```

**Deep module:** Simple interface, lots of functionality hidden behind it.

**Shallow module:** Complex interface relative to functionality provided. Red flag.

### Examples

**Deep:** Unix file I/O - just 5 calls (open, read, write, lseek, close) hide enormous complexity (buffering, caching, device drivers, permissions, journaling).

**Shallow:** Java's file reading requires BufferedReader wrapping FileReader wrapping FileInputStream. Interface complexity matches implementation complexity.

### Apply This

- Prefer fewer methods that do more over many small methods
- Hide implementation details aggressively
- A module's interface should be much simpler than its implementation
- If interface is as complex as implementation, reconsider the abstraction

## Strategic vs Tactical Programming

**Tactical:** Get it working now. Each task adds small complexities. Debt accumulates.

**Strategic:** Invest time in good design. Slower initially, faster long-term.

```
Progress
   │
   │        Strategic ────────────────→
   │       /
   │      /
   │     / Tactical ─────────→
   │    /                    ↘ (slows down)
   │   /
   └──┴─────────────────────────────────→ Time
```

**Rule of thumb:** Spend 10-20% of development time on design improvements.

### Working Code Isn't Enough

"Working code" is not the goal. The goal is a great design that also works. If you're satisfied with "it works," you're programming tactically.

## Information Hiding

Each module should encapsulate knowledge that other modules don't need.

**Information leakage (red flag):** Same knowledge appears in multiple places. If one changes, all must change.

**Temporal decomposition (red flag):** Splitting code based on when things happen rather than what information they use. Often causes leakage.

### Apply This

- Ask: "What knowledge does this module encapsulate?"
- If the answer is "not much," the module is probably shallow
- Group code by what it knows, not when it runs
- Private by default; expose only what's necessary

## Define Errors Out of Existence

Exceptions add complexity. The best way to handle them: design so they can't happen.

**Instead of:**

```typescript
function deleteFile(path: string): void {
  if (!exists(path)) throw new FileNotFoundError();
  // delete...
}
```

**Do:**

```typescript
function deleteFile(path: string): void {
  // Just delete. If it doesn't exist, goal is achieved.
  // No error to handle.
}
```

### Apply This

- Redefine semantics so errors become non-issues
- Handle edge cases internally rather than exposing them
- Fewer exceptions = simpler interface = deeper module
- Ask: "Can I change the definition so this isn't an error?"

## General-Purpose Modules

Somewhat general-purpose modules are deeper than special-purpose ones.

**Not too general:** Don't build a framework when you need a function.

**Not too specific:** Don't hardcode assumptions that limit reuse.

**Sweet spot:** Solve today's problem in a way that naturally handles tomorrow's.

### Questions to Ask

1. What is the simplest interface that covers all current needs?
2. How many situations will this method be used in?
3. Is this API easy to use for my current needs?

## Pull Complexity Downward

When complexity is unavoidable, put it in the implementation, not the interface.

**Bad:** Expose complexity to all callers.
**Good:** Handle complexity once, internally.

It's more important for a module to have a simple interface than a simple implementation.

### Example

Configuration: Instead of requiring callers to configure everything, provide sensible defaults. Handle the complexity of choosing defaults internally.

## Design Twice

Before implementing, consider at least two different designs. Compare them.

**Benefits:**

- Reveals assumptions you didn't know you were making
- Often the second design is better
- Even if first design wins, you understand why

**Don't skip this:** "I can't think of another approach" usually means you haven't tried hard enough.

## Red Flags Summary

| Red Flag                | Symptom                                          |
| ----------------------- | ------------------------------------------------ |
| Shallow module          | Interface complexity ≈ implementation complexity |
| Information leakage     | Same knowledge in multiple modules               |
| Temporal decomposition  | Code split by time, not information              |
| Overexposure            | Too many methods/params in interface             |
| Pass-through methods    | Method does little except call another           |
| Repetition              | Same code pattern appears multiple times         |
| Special-general mixture | General-purpose code mixed with special-purpose  |
| Conjoined methods       | Can't understand one without reading another     |
| Comment repeats code    | Comment says what code obviously does            |
| Vague name              | Name doesn't convey much information             |

## Applying to CLI/Tool Design

When building CLIs, plugins, or tools:

1. **Deep commands:** Few commands that do a lot, not many shallow ones
2. **Sensible defaults:** Work without configuration for common cases
3. **Progressive disclosure:** Simple usage first, advanced options available
4. **Consistent interface:** Same patterns across all commands
5. **Error elimination:** Design so common mistakes are impossible

### Example: Good CLI Design

```bash
# Deep: one command handles the common case well
swarm setup

# Not shallow: doesn't require 10 flags for basic usage
# Sensible defaults: picks reasonable models
# Progressive: advanced users can customize later
```

## Key Takeaways

1. **Complexity is the enemy.** Every design decision should reduce it.
2. **Deep modules win.** Simple interface, rich functionality.
3. **Hide information.** Each module owns specific knowledge.
4. **Define errors away.** Change semantics to eliminate edge cases.
5. **Design twice.** Always consider alternatives.
6. **Strategic > tactical.** Invest in design, not just working code.
7. **Pull complexity down.** Implementation absorbs complexity, interface stays simple.
