# OpenCode Plugin

The project-local plugin is `.opencode/plugins/agentic-tcr.ts`. OpenCode loads
it automatically when started from the project:

```sh
cd /path/to/agentic-tcr-poc
opencode
```

The fixture project under `test/fixtures/opencode-project` demonstrates the
same layout with its own `agentic-tcr.config.json`:

```sh
cd test/fixtures/opencode-project
opencode
```

The deterministic test suite exercises plugin initialization, session
lifecycle, mutation capture, project verification, and same-session recovery
with fake runtime calls. Real OpenCode experiments are intentionally opt-in;
they require a configured model/provider and are tracked separately in issue
#11.
