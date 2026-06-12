# Stevedore — Project Memory

## Project Info
- **Path**: `/Users/ergix/stevedore`
- **Purpose**: Docker-compatible CLI bridge for [apple/container](https://github.com/apple/container)
- **Runtime**: `container` (apple/container CLI, not Docker)
- **Socket**: `unix://$HOME/.stevedore/docker.sock`

## Key Failures & Corrections

### [failure] Ryuk pulled as wrong architecture variant
- **What was tried**: Running Testcontainers with stevedore socket — ryuk container would start but fail with broken pipe
- **Why it failed**: `apple/container image pull` defaults to the **first variant** in the multi-platform manifest. For `testcontainers/ryuk:0.12.0`, the first variant is `amd64/windows` — not `linux/arm64`. On Apple Silicon, this meant pulling a Windows/amd64 image that couldn't bind ports properly under emulation.
- **Error**: "The architecture 'amd64' for image..." warning, then broken pipe when Testcontainers connected
- **What worked**: Delete the wrong image (`container image rm testcontainers/ryuk:0.12.0`), then pull with explicit `--platform linux/arm64` (`container image pull --platform linux/arm64 testcontainers/ryuk:0.12.0`)
- **Permanent fix in code**: Added `--platform` passthrough in:
  - `src/api/routes/images.js`: `query.platform → "--platform"` on `image pull`
  - `src/api/routes/containers.js`: `body.Platform → "--platform"` on `container create`

### [insight] apple/container manifest ordering
- apple/container does NOT automatically prefer the host architecture when pulling multi-platform images. It uses the first entry in the manifest list, which may be any platform (often amd64/windows for cross-platform images).
- Always verify pulled image variant with `container image inspect <image>` and check `variants[].platform`.

## User Shell Config (revealed in conversation)
```bash
export DOCKER_HOST=unix://$HOME/.stevedore/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$HOME/.stevedore/docker.sock
```

## Conventions Discovered
- Tests use `node:test` — run with `node --test test/**/*.test.js`
- Codebase is ESM (`.js` files with `import`)
- API routes are files in `src/api/routes/` — one per Docker API resource
- `src/api/run.js` exports `run()` and `runJSON()` helpers for executing `container` CLI calls
- `CONTAINER_BIN` from `src/utils/exec.js` is the `container` binary path
- `body.Platform` comes from Docker API request body during container create
- `query.platform` comes from Docker API query string during image pull
- `container create` is used (not `run`) so Testcontainers can configure Ryuk before start
