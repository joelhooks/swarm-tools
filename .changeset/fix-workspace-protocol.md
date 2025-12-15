---
"opencode-swarm-plugin": patch
---

Fix workspace:* protocol resolution in npm publish

Use bun publish instead of npm publish to properly resolve workspace:* protocols to actual versions.
