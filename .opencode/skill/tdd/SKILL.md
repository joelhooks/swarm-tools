---
name: tdd
description: "Use when writing code test-first using TDD and the RED-GREEN-REFACTOR cycle. Write a failing test that defines expected behavior, implement minimal code to pass, then refactor while keeping tests green. Applies test-driven development patterns including triangulation, fake-it-til-you-make-it, and assertion-first design. Draws on practices from Kent Beck, Michael Feathers, and balances with Ousterhout's design-first counterpoint."
tags:
  - testing
  - workflow
  - methodology
  - tdd
---

# Test-Driven Development (TDD)

## The Rhythm: RED-GREEN-REFACTOR

```
1. RED    - Write failing test first (define expected behavior)
2. GREEN  - Minimal implementation to pass (don't over-engineer)
3. REFACTOR - Clean up, remove duplication, run tests again
```

## Why TDD Works (The Lore)

### Kent Beck (Test-Driven Development by Example)

> "The act of writing a unit test is more an act of design than verification."

- Tests become executable documentation of intent
- "Fake it til you make it" - start with hardcoded values, generalize
- Small steps reduce debugging time
- Confidence to refactor comes from test coverage

### Michael Feathers (Working Effectively with Legacy Code)

> "The most powerful feature-addition technique I know of is test-driven development."

- TDD works in both OO and procedural code
- Writing tests first forces you to think about interfaces
- Tests are the safety net that enables aggressive refactoring
- Legacy code = code without tests

### Martin Fowler (Refactoring)

> "Kent Beck baked this habit of writing the test first into a technique called Test-Driven Development."

- TDD relies on short cycles
- Tests enable refactoring
- Refactoring becomes safe - tests catch regressions instantly

## The Counterpoint: Know When to Break the Rule

### John Ousterhout (A Philosophy of Software Design)

> "The problem with test-driven development is that it focuses attention on getting specific features working, rather than finding the best design."

**When TDD can hurt:**

- Can lead to tactical programming (feature-focused, not design-focused)
- May produce code that's easy to test but hard to understand
- Risk of over-testing implementation details

**The balance:**

- For exploratory/architectural work, design first, then add tests
- Don't let tests drive you into a corner
- Step back periodically to evaluate overall design

## When to Use TDD

✅ **Use TDD for:**

- New features with clear requirements
- Bug fixes (write test that reproduces bug first)
- Refactoring existing code (add characterization tests first)
- API design (tests reveal ergonomics)
- Any code that will be maintained long-term

❌ **Skip TDD for:**

- Exploratory spikes (but add tests after if keeping the code)
- Emergency hotfixes (but add tests immediately after)
- Pure UI/styling changes
- One-off scripts
- Throwaway prototypes

## The TDD Workflow

```bash
# 1. Write test, watch it fail
bun test src/thing.test.ts  # RED - test fails

# 2. Implement minimal code to pass
bun test src/thing.test.ts  # GREEN - test passes

# 3. Refactor, tests still pass
bun test src/thing.test.ts  # GREEN - still passing

# 4. Repeat for next behavior
```

## TDD Patterns

### Start with the Assertion

Write the assertion first, then work backwards:

```typescript
// Start here
expect(result).toBe(42);

// Then figure out what 'result' is
const result = calculate(input);

// Then figure out what 'input' is
const input = { value: 21 };
```

### Triangulation

Use multiple examples to drive generalization:

```typescript
it("doubles 2", () => expect(double(2)).toBe(4));
it("doubles 3", () => expect(double(3)).toBe(6));
// Now you MUST implement the general solution
```

### Obvious Implementation

When the solution is obvious, just write it:

```typescript
function add(a: number, b: number): number {
  return a + b; // Don't fake this
}
```

### Fake It Til You Make It

When unsure, start with hardcoded values:

```typescript
// First pass
function fibonacci(n: number): number {
  return 1; // Passes for n=1
}

// Add test for n=2, then generalize
```

## Testing Pyramid

```
        /\
       /  \     E2E (few)
      /----\
     /      \   Integration (some)
    /--------\
   /          \ Unit (many)
  --------------
```

- **Unit tests**: Fast, isolated, test one thing
- **Integration tests**: Test component interactions
- **E2E tests**: Test full user flows (expensive, use sparingly)

## Common TDD Mistakes

1. **Writing too many tests at once** - One failing test at a time
2. **Testing implementation, not behavior** - Test what, not how
3. **Skipping the refactor step** - Technical debt accumulates
4. **Over-mocking** - Don't mock what you don't own
5. **Testing private methods** - Test through public interface

## Integration with Beads

When working on a bead:

1. Start bead: `beads_start(id="bd-123")`
2. Write failing test for the requirement
3. Implement to pass
4. Refactor
5. Close bead: `beads_close(id="bd-123", reason="Done: tests passing")`
