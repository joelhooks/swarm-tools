# Supply-chain hardening policy

This repo treats dependency, workflow, plugin, package, script, eval, and publish changes as security-sensitive.

## Required defaults

- Use the committed lockfile with `bun install --frozen-lockfile` in CI.
- For first inspection of unfamiliar dependencies, install with `--ignore-scripts`.
- Keep lifecycle scripts rare and explicit.
- GitHub Actions permissions default to read-only; grant write permissions only per job.
- Release/publish jobs must not run on `pull_request`, `pull_request_target`, `discussion`, or other user-content events.
- Require review for workflows, package manifests, lockfiles, `.npmrc`, packages, scripts, eval gates, changesets, and publish config.
- Prefer npm Trusted Publishing/OIDC and provenance over long-lived npm tokens when package setup supports it.

## Shai-Hulud-style IOC checks

Block and investigate unexpected `setup_bun.js`, `bun_environment.js`, `discussion.yaml`, `shai-hulud-workflow.yml`, self-hosted runners named `SHA1HULUD`, and public repo descriptions referencing `Sha1-Hulud`, `Shai-hulud Migration`, or `-migration`.

If a compromised package install ran: assume secrets are burned, revoke/rotate tokens, compare artifacts against source, and rebuild the machine instead of surgical cleanup theater.
