# Contributing to stevedore

Thanks for your interest in contributing. The project is structured so that multiple people can work on different areas simultaneously with minimal merge conflicts.

## Architecture overview

```
stevedore <command> [args]
       │
       ▼
  dispatcher.js          ← routing table only; one line per command
       │
       ▼
  commands/<cmd>.js      ← one file per docker subcommand
       │
       ▼
  utils/flags.js         ← pure flag translation helpers
       │
       ▼
  utils/exec.js          ← spawns `container` binary
```

Each layer is independently testable.

## How to add a command

1. **Create the handler** — `src/commands/<name>.js`:
   ```js
   // Simple passthrough (stevedore X → container X, no flag changes needed):
   import { makePassthrough } from "../utils/passthrough.js";
   export default makePassthrough("container-subcommand-here");

   // Or a full handler for commands needing flag translation:
   import { exec } from "../utils/exec.js";
   import { translateFlags } from "../utils/flags.js";

   export default async function myCommand(args) {
     const translated = translateFlags(args);
     // ... any extra translation ...
     await exec(["container-subcommand", ...translated]);
   }
   ```

2. **Register it** in `src/dispatcher.js` in the `COMMAND_MAP` object.

3. **Add tests** in `test/commands/<name>.test.js`.

## How to add a flag translation

**Rename** (e.g. `--old-name` → `--new-name`): add to `FLAG_RENAMES` in `src/utils/flags.js`.

**Drop** (flag has no apple/container equivalent): add to `UNSUPPORTED_FLAGS` in `src/utils/flags.js`, specifying whether the flag consumes a following value.

**Complex transformation** (e.g. `--mac-address` absorbed into `--network`): write a helper function in the relevant command file (see `run.js` for an example).

## Running tests

```bash
node --test
# or a single file:
node --test test/utils/flags.test.js
```

Tests use Node's built-in test runner — no additional dependencies needed.

## Coding style

- ES modules (`import`/`export`), no CommonJS
- No build step — the source runs directly with Node 20+
- Functions over classes
- Each file has a header comment explaining its purpose and any important design decisions
- Warn (don't error) for unsupported flags so existing scripts keep working

## Pull request checklist

- [ ] New command registered in `dispatcher.js`
- [ ] Tests added for new behaviour
- [ ] `node --test` passes
- [ ] README compatibility table updated if needed
- [ ] Header comment in any new source file
