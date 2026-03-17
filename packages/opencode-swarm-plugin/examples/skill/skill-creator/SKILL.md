---
name: skill-creator
description: "Guide for creating effective agent skills. Use when writing YAML frontmatter, defining trigger terms, structuring workflow instructions, or adding bundled scripts and references. Use when you want to create a new skill, improve an existing skill, or codify learned patterns into reusable, discoverable skills."
tags:
  - meta
  - skills
  - learning
  - documentation
tools:
  - skills_init
  - skills_create
  - skills_update
  - skills_read
---

# Skill Creator

This skill provides guidance for creating effective skills that extend agent capabilities with specialized knowledge, workflows, and tools.

## What Are Skills?

Skills are modular, self-contained packages that extend agent capabilities by providing:

1. **Specialized workflows** - Multi-step procedures for specific domains
2. **Tool integrations** - Instructions for working with specific file formats or APIs
3. **Domain expertise** - Project-specific knowledge, schemas, business logic
4. **Bundled resources** - Scripts, references, and assets for complex tasks

Think of skills as "onboarding guides" that transform a general-purpose agent into a specialized one equipped with procedural knowledge.

## Skill Anatomy

Every skill consists of a required SKILL.md file and optional bundled resources:

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description, tags, tools)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/      - Executable code (run with skills_execute)
    └── references/   - Documentation (load with skills_read)
```

### Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - On-demand as needed

Keep SKILL.md lean. Move detailed content to references/.

## Creating a Skill

### Step 1: Understand the Use Cases

Before creating, understand concrete examples:
- What triggers should activate this skill?
- What user requests would benefit from it?
- What workflows does it enable?

**Ask clarifying questions** if scope is unclear.

### Step 2: Initialize the Skill

Use `skills_init` to create the full template structure:

```
skills_init(
  name: "my-skill",
  description: "Initial description",
  directory: ".opencode/skills"
)
```

This creates:
- SKILL.md with TODO placeholders
- scripts/ with example script
- references/ with example doc

### Step 3: Complete the SKILL.md

Fill in the TODO placeholders. Key sections:

**Frontmatter** - Critical for discoverability:
```yaml
---
name: my-skill
description: What it does and WHEN to use it. Be specific about triggering scenarios.
tags:
  - category
  - domain
tools:
  - tool_names_used
---
```

**When to Use** - Specific triggering scenarios:
```markdown
## When to Use This Skill

- When working on X type of task
- When files matching Y pattern are involved
- When the user asks about Z topic
```

**Instructions** - Actionable, imperative form:
```markdown
## Instructions

1. Read the configuration file first
2. Check for existing patterns before creating
3. Always validate output before completing
```

**Examples** - Realistic user requests:
```markdown
## Examples

### Example: Realistic Scenario

**User**: "Help me do X"

**Process**:
1. First step
2. Second step
3. Final step
```

### Step 4: Add Bundled Resources (Optional)

**scripts/** - Executable helpers:
- Use for repeated automation
- Token-efficient (run without reading)
- Run via `skills_execute`

**references/** - On-demand documentation:
- Detailed guides too long for SKILL.md
- API documentation
- Complex workflows
- Load via `skills_read`

### Step 5: Test and Iterate

1. Use `skills_use` to load the skill
2. Try it on real tasks
3. Notice struggles or inefficiencies
4. Update SKILL.md based on experience
5. Test again

## Best Practices

### Metadata Quality

The `name` and `description` determine when the skill triggers:

**Good descriptions**:
- "Guide for creating MCP servers. Use when building tools that connect LLMs to external APIs."
- "File organization helper. Use when Downloads folder is messy or files need restructuring."

**Bad descriptions**:
- "A useful skill" (too vague)
- "Does stuff with files" (not actionable)

### Writing Style

Use **imperative/infinitive form** throughout:
- "Read the file first" (not "You should read the file")
- "Check for patterns" (not "Consider checking patterns")

### Keep SKILL.md Lean

- Core instructions only (<5k words)
- Move details to references/
- Use examples sparingly
- Delete placeholder sections

### Design for Discoverability

- Tags help agents find skills by category
- "When to Use" sections enable proper triggering
- Tools list shows what capabilities the skill uses

## Quick Reference

### Creating Skills

| Tool | Use When |
|------|----------|
| `skills_init` | Want full template structure with TODOs |
| `skills_create` | Have complete content ready to write |
| `swarm_learn` | Converting learned patterns to skills |

### Managing Skills

| Tool | Use For |
|------|---------|
| `skills_list` | Discover available skills |
| `skills_use` | Activate a skill by loading its content |
| `skills_read` | Load a reference file from a skill |
| `skills_update` | Modify an existing skill |
| `skills_delete` | Remove an obsolete skill |

### Execution

| Tool | Use For |
|------|---------|
| `skills_execute` | Run a script from a skill |
| `skills_add_script` | Add a new script to a skill |

## From Learned Patterns to Skills

When you discover something reusable during work:

1. **Identify the pattern** - What worked well?
2. **Consider scope** - Is it project-specific or universal?
3. **Use `swarm_learn`** - Document the learning
4. **Create the skill** - Use `create_skill=true` or `skills_init`
5. **Test and refine** - Iterate based on usage

Skills make swarms smarter over time by preserving learned knowledge for future agents.
