---
name: skill-generator
description: "Generates new skill scaffolds by creating SKILL.md files, writing YAML frontmatter with name and description fields, and setting up directory structures with scripts/, references/, and assets/ folders. Use when generating a new skill, scaffolding skill directories, bootstrapping skill templates, or initializing skill files for the swarm system. Validates frontmatter format, checks naming conventions, and ensures skills follow established conventions."
---

# Skill Generator

Generate new skills with proper format, structure, and conventions. This meta-skill helps agents create skills without hallucinating the format.

## Quick Start

To generate a new skill:

```bash
bash scripts/generate-skill.sh <skill-name> [target-directory]
```

This creates a complete skill scaffold with:
- SKILL.md with proper frontmatter
- scripts/ directory for executable helpers
- references/ directory for documentation
- Placeholder content following conventions

## Skill Format Conventions

Every skill MUST include:

1. **SKILL.md** (required) - Main skill file with:
   - YAML frontmatter (name, description)
   - Markdown body with instructions

2. **Bundled Resources** (optional):
   - `scripts/` - Executable code (bash/python/etc)
   - `references/` - Documentation loaded on-demand
   - `assets/` - Files used in output (templates, etc)

### Frontmatter Requirements

```yaml
---
name: skill-name
description: What the skill does AND when to use it. Include triggering scenarios.
---
```

The description field is critical for skill discovery and triggering. Include:
- What the skill does
- When to use it (specific triggers)
- What contexts activate it

### Directory Structure

```
skill-name/
├── SKILL.md (required)
├── scripts/ (optional)
│   └── example-script.sh
├── references/ (optional)
│   └── conventions.md
└── assets/ (optional)
    └── template-file
```

## Writing Effective Skills

### Keep SKILL.md Lean

Target <500 lines in SKILL.md. Move detailed content to references/:

- Core workflow → SKILL.md
- Detailed examples → references/
- API docs → references/
- Long explanations → references/

### Use Imperative Form

Write instructions as commands:
- "Read the file first" ✓
- "You should read the file" ✗
- "Check for patterns" ✓
- "Consider checking patterns" ✗

### Progressive Disclosure

Skills use three-level loading:

1. **Metadata** (~100 words) - Always in context
2. **SKILL.md body** (<5k words) - When skill triggers
3. **Bundled resources** (unlimited) - Loaded as needed

## Bundled Resources

### scripts/

Executable code for deterministic tasks:
- When the same code is rewritten repeatedly
- When reliability is critical
- Run via bash/python without loading to context

Make scripts executable:
```bash
chmod +x scripts/my-script.sh
```

### references/

Documentation loaded on-demand:
- Database schemas
- API documentation
- Detailed workflow guides
- Domain knowledge

Keep reference files focused. For files >100 lines, include a table of contents.

Reference from SKILL.md with clear guidance on when to read:
```markdown
See references/api-docs.md for complete API reference.
```

### assets/

Files used in output (not loaded to context):
- Templates
- Images/icons
- Boilerplate code
- Fonts/typography

## What NOT to Include

Do NOT create these files:
- README.md
- INSTALLATION_GUIDE.md
- QUICK_REFERENCE.md
- CHANGELOG.md

Skills should contain only what an AI agent needs to execute the task. No auxiliary documentation.

## Validation

Before finalizing, validate the skill:

```bash
bun scripts/validate-skill.ts path/to/skill
```

Checks:
- YAML frontmatter format
- Required fields present
- No TODO placeholders
- No extraneous files
- Naming conventions

## Error Recovery After Validation

If validation fails, apply these fixes:

| Error | Fix |
|-------|-----|
| Missing `name` field | Add `name:` to YAML frontmatter matching the directory name |
| Missing `description` field | Write a description including what the skill does and when to use it |
| TODO placeholders found | Replace all TODO text with actual content or remove the placeholder |
| Extraneous files (README.md, etc.) | Delete non-essential files; keep only SKILL.md and bundled resources |
| Name mismatch | Rename the `name:` field to match the skill directory name exactly |

Re-run `bun scripts/validate-skill.ts path/to/skill` after each fix to confirm resolution.

## Reference

See references/conventions.md for complete skill format specification.
