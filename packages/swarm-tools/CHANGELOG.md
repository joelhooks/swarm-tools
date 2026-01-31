# swarm-tools

## 0.59.6

### Patch Changes

- [`109f335`](https://github.com/joelhooks/swarm-tools/commit/109f335b663be6420bfd8a471118dc283c5248c2) Thanks [@joelhooks](https://github.com/joelhooks)! - Add SKOS taxonomy extraction to hivemind memory system

  - SKOS entity taxonomy with broader/narrower/related relationships
  - LLM-powered taxonomy extraction wired into adapter.store()
  - Entity extraction now includes prefLabel and altLabels
  - New CLI commands: `swarm memory entities`, `swarm memory entity`, `swarm memory taxonomy`
  - Moltbot plugin: decay tier filtering, entity-aware auto-capture
  - HATEOAS-style hints in hivemind tool responses
