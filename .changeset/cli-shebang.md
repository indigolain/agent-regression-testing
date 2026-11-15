---
"agent-regression-testing": patch
---

Fix the `agent-regression-testing` command failing when run through npm's installed bin (e.g. `npx agent-regression-testing init`). The compiled CLI had no `#!/usr/bin/env node` line, so the shell tried to run the JavaScript itself. CLI errors now print a message and exit with code 1.
