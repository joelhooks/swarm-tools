---
"opencode-swarm-plugin": minor
---

Add compact list rendering for semantic-memory_find and cass_search tools

- New result-formatter utility with formatMemoryResults and formatCassResults
- semantic-memory_find now shows compact results with score, decay %, and age
- cass_search now shows compact results with agent, path:line, and preview
- Improved readability for AI agent outputs
