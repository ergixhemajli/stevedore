# Stevedore — Session Memory

## User Preferences (from conversation)
- Replaces Colima with Apple container via stevedore to avoid reserved hardware — runs local LLM inference, needs every resource
- Prefers Docker completion script reuse over custom stevedore completions: "least maintenance and least fiddling"
- Wants API versioning in /version and /info to be in-sync with Docker Engine semantics
- Wants tab autocomplete for docker commands AND dynamic name completion
- Autonomous troubleshooting — "if it doesnt run, fix the issue", never push to remote without explicit permission

## Project Architecture (stevedore)
- Node.js CLI: dispatcher.js → commands/*.js → utils/exec.js (spawn)
- Docker API socket server: src/api/server.js, router.js, routes/*.js
- Centralized versioning: src/api/versioning.js (DOCKER_ENGINE_VERSION='25.0.0', API 1.24-1.44)
- Shell completions: completions/docker.bash, completions/docker.zsh
- Socket logs: ~/.stevedore/server.log | PID: ~/.stevedore/server.pid
- Dual identity: 'stevedore' (full commands including doctor, socket) vs 'docker' (passthrough only, doctor/socket hidden)
- Compose support: proxies to official docker-compose v2 binary
- Testcontainers integration: Docker API shim over Unix socket translating Engine API → apple/container CLI

## Failure Lessons
1. Testcontainers polling loop on GET /containers/{id}/json
   Cause: inspect response had empty id/image, status='created' not Running=true
   Fix: properly parse 'container inspect' output, map to Docker-style json with State.Running=true

2. Testcontainers pull loop / hang
   Cause: router did not decode URL-encoded path params → 'container image inspect testcontainers%2Fryuk' failed
   Fix: decodeURIComponent on path params in router

3. docker-java rejects non-semver Version
   Cause: /version.Version returned 'stevedore-0.1.0', docker-java expects semver like '25.0.0'
   Fix: return Docker-like Version/ServerVersion, keep stevedore identity in Platform.Name

4. compose fails with network label warning
   Cause: pre-existing network 'atlas-services_default' lacked com.docker.compose.* labels
   Fix: wire labels into network create; stale networks must be rm'd

5. Apple container inspect doesn't support --format flag
   Cause: 'container inspect' takes bare container IDs, no --format option
   Fix: removed --format from inspect args in containers.js

6. Doctor command breaks test suite
   Cause: dispatch(['doctor'], false) sets process.exitCode=1 → Node test runner marks whole file failed
   Fix: restore process.exitCode after dispatch in tests

7. container exec requires mandatory arguments
   Cause: apple/container exec needs <arguments> — no bare interactive mode like docker
   Fix: documented in help/README

## Key Insights
- Testcontainers speaks Docker Engine API (HTTP socket), not CLI — need Unix socket daemon
- Apple container CLI inspect output ≠ Docker JSON — need full parse+transform pipeline
- compose refuses pre-existing networks without com.docker.compose.* labels
- URL-encoded image names in API paths must be decoded before CLI passthrough
- Inspired by swift-test-containers (Apple inspect→Docker mapping) and socktainer (Unix socket + versioned routing)
