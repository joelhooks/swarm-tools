# opencode-swarm-plugin

## 0.23.1

### Patch Changes

- [`64ad0e4`](https://github.com/joelhooks/opencode-swarm-plugin/commit/64ad0e4fc033597027e3b0614865cfbf955b5983) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution in npm publish

  Use bun publish instead of npm publish to properly resolve workspace:\* protocols to actual versions.

## 0.23.0

### Minor Changes

- [`b66d77e`](https://github.com/joelhooks/opencode-swarm-plugin/commit/b66d77e484e9b7021b3264d1a7e8f54a16ea5204) Thanks [@joelhooks](https://github.com/joelhooks)! - Add changesets workflow and semantic memory test isolation

  - OIDC publish workflow with GitHub Actions
  - Changesets for independent package versioning
  - TEST_SEMANTIC_MEMORY_COLLECTION env var for test isolation
  - Prevents test pollution of production semantic-memory
