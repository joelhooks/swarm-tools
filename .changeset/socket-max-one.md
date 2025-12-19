---
"swarm-mail": patch
---

Fix UNSAFE_TRANSACTION error by setting `max: 1` in socket adapter

postgres.js requires single-connection mode (`max: 1`) when not using explicit `sql.begin()` transactions. The default of 10 connections caused transaction safety errors and hanging connections during migrations.
