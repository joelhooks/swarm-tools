# opencode-swarm-plugin

## 0.23.5

### Patch Changes

- [`3826c6d`](https://github.com/joelhooks/opencode-swarm-plugin/commit/3826c6d887f937ccb201b7c4322cbc7b46823658) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* resolution by running bun install before pack

  The lockfile was stale, causing bun pack to resolve workspace:\* to old versions.
  Now runs bun install first to ensure lockfile matches current package.json versions.

## 0.23.4

### Patch Changes

- Updated dependencies [[`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994)]:
  - swarm-mail@0.1.2

## 0.23.3

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors

- Updated dependencies [[`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7)]:
  - swarm-mail@0.1.1

## 0.23.2

### Patch Changes

- [`7f9ead6`](https://github.com/joelhooks/opencode-swarm-plugin/commit/7f9ead65dab1dd5dc9aff57df0871cc390556fe1) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution using bun pack + npm publish

  Uses bun pack to create tarball (which resolves workspace:\* to actual versions) then npm publish for OIDC trusted publisher support.

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
