# @swarmtools/evals

## 0.2.12

### Patch Changes

- Updated dependencies [[`923a5c5`](https://github.com/joelhooks/swarm-tools/commit/923a5c5f992a00fa52e97e18fcb0cb5a35cbc539)]:
  - opencode-swarm-plugin@0.48.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`ef274d7`](https://github.com/joelhooks/swarm-tools/commit/ef274d783d56c291f19e55a7616d0b72e7ac4c70)]:
  - opencode-swarm-plugin@0.47.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a), [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a), [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a)]:
  - opencode-swarm-plugin@0.46.0
  - swarm-mail@1.7.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`f6c63ac`](https://github.com/joelhooks/swarm-tools/commit/f6c63ac1e4a3cf36e66ee03d6b48b12e187a24a3)]:
  - opencode-swarm-plugin@0.45.7

## 0.2.8

### Patch Changes

- Updated dependencies [[`8b04270`](https://github.com/joelhooks/swarm-tools/commit/8b0427013f145a3b68535f3e0da134f32e04d239)]:
  - opencode-swarm-plugin@0.45.6

## 0.2.7

### Patch Changes

- Updated dependencies [[`be7b129`](https://github.com/joelhooks/swarm-tools/commit/be7b12949becd7cf32f433dca1316761c4a8bbc5)]:
  - opencode-swarm-plugin@0.45.5

## 0.2.6

### Patch Changes

- Updated dependencies [[`7c70297`](https://github.com/joelhooks/swarm-tools/commit/7c702977cde5a382e8a602846b4f2adad66f72d4)]:
  - opencode-swarm-plugin@0.45.4

## 0.2.5

### Patch Changes

- Updated dependencies [[`59ccb55`](https://github.com/joelhooks/swarm-tools/commit/59ccb55fc6a9c9537705ac2a7c25586d294ba459)]:
  - opencode-swarm-plugin@0.45.3

## 0.2.4

### Patch Changes

- Updated dependencies [[`70e62c9`](https://github.com/joelhooks/swarm-tools/commit/70e62c9c6c9c29ecf7778aad90813adf5ad8a20e)]:
  - swarm-mail@1.6.2
  - opencode-swarm-plugin@0.45.2

## 0.2.3

### Patch Changes

- Updated dependencies [[`df219d8`](https://github.com/joelhooks/swarm-tools/commit/df219d8f2838eb9f640f61b9b07e326225f404d0), [`ff29b26`](https://github.com/joelhooks/swarm-tools/commit/ff29b26344274907b6a0614f9b3b914771edf6e4), [`24a986e`](https://github.com/joelhooks/swarm-tools/commit/24a986eb0405895b4b7f5f201f0e1755cf078fc2)]:
  - opencode-swarm-plugin@0.45.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`156386a`](https://github.com/joelhooks/swarm-tools/commit/156386a9353a7d92afdc355fbbcf951b9c749048), [`fb4b2d5`](https://github.com/joelhooks/swarm-tools/commit/fb4b2d545943fa6e5a5f5294f2bcd129191b8667), [`ca12bd6`](https://github.com/joelhooks/swarm-tools/commit/ca12bd6dd68ee41bdb9deb78409c73a08460806e), [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac), [`f9fd732`](https://github.com/joelhooks/swarm-tools/commit/f9fd73295b0f5c4b4f5230853a165af81a04f806)]:
  - opencode-swarm-plugin@0.45.0
  - swarm-mail@1.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [[`012d21a`](https://github.com/joelhooks/swarm-tools/commit/012d21aefdea0ac275a02d3865c8a134ab507360)]:
  - opencode-swarm-plugin@0.44.2

## 0.2.0

### Minor Changes

- [`1d079da`](https://github.com/joelhooks/swarm-tools/commit/1d079da134c048df66db7d28890d1a8bb9908942) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Evals Break Free: The Great Extraction

  > _"Modularity does not necessarily bring uniformity to the design... but it does bring clarity to dependencies."_
  > — Eric Evans, Domain-Driven Design

  **The Problem:** PR #81 reported `Cannot find module 'evalite/runner'` on global install. The eval framework (evalite + vitest) was incorrectly bundled as devDependencies in the main plugin, causing runtime failures.

  **The Fix:** Rather than bloating the plugin with 20MB+ of test framework, we extracted evals to their own package.

  ### What Changed

  **New Package: `@swarmtools/evals`**

  - All eval files migrated from `opencode-swarm-plugin/evals/`
  - Owns evalite, vitest, and AI SDK dependencies
  - Peer-depends on plugin and swarm-mail for scoring utilities

  **opencode-swarm-plugin**

  - Removed evalite/vitest from devDependencies
  - Added `files` field to limit npm publish scope
  - Added subpath exports for eval-capture and compaction-prompt-scoring
  - Build script now generates all entry points

  ### Package Structure

  ```
  packages/
  ├── opencode-swarm-plugin/     # Main plugin (lean, no eval deps)
  ├── swarm-evals/               # @swarmtools/evals (internal)
  │   └── src/
  │       ├── *.eval.ts
  │       ├── scorers/
  │       ├── fixtures/
  │       └── lib/
  └── ...
  ```

  ### Verified

  - ✅ `example.eval.ts` - 100% pass
  - ✅ `compaction-resumption.eval.ts` - 100% pass (8 evals)
  - ✅ Plugin builds without eval deps
  - ✅ Global install no longer fails

  Thanks to @AlexMikhalev for the detailed bug report that led to this architectural improvement.

### Patch Changes

- Updated dependencies [[`1d079da`](https://github.com/joelhooks/swarm-tools/commit/1d079da134c048df66db7d28890d1a8bb9908942)]:
  - opencode-swarm-plugin@0.44.1
