# Stevedore

A `docker`-compatible CLI powered by [apple/container](https://github.com/apple/container). Run containers on Apple Silicon with zero overhead — no persistent VM, no Docker Desktop, no Colima.

## Why

`apple/container` uses Apple's native Virtualization framework to run containers in lightweight, on-demand VMs. No background process eating memory. The catch: it uses a `container` command, not `docker`. Stevedore bridges that gap — you keep typing `docker run`, `docker ps`, `docker build`, and stevedore translates them behind the scenes.

```bash
docker run -it ubuntu:latest /bin/bash
docker ps
docker build -t my-app .
docker network create mynet
```

## Installation

### 1. Install apple/container

```bash
brew install --cask apple-container
```

### 2. Install stevedore

```bash
# Global install (recommended)
npm install -g stevedore

# Or use without installing
npx stevedore run ubuntu:latest echo hello
```

### 3. Enable shell completion (recommended)

Stevedore can generate completion scripts so `docker <TAB>` works for commands and common names.

#### zsh

```bash
mkdir -p ~/.stevedore
docker completion zsh > ~/.stevedore/_docker
fpath=(~/.stevedore $fpath)
autoload -Uz compinit && compinit
```

#### bash

```bash
mkdir -p ~/.stevedore
docker completion bash > ~/.stevedore/completion.bash
source ~/.stevedore/completion.bash
```

### 4. Add optional env vars (Testcontainers + DB pool stability)

For one-shot shell setup:

```bash
eval "$(stevedore env)"
```

To persist in your shell profile (`~/.zshrc` / `~/.bashrc`):

```bash
eval "$(stevedore env)"
```

This exports:
- `DOCKER_HOST=unix://$HOME/.stevedore/docker.sock`
- `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$HOME/.stevedore/docker.sock`
- `DB_HIKARI_MAX_LIFETIME_MS=55000`
- `DB_HIKARI_KEEPALIVE_TIME_MS=30000`

You can override defaults:

```bash
stevedore env --db-hikari-max-lifetime-ms 45000 --db-hikari-keepalive-time-ms 25000
```

Then reload: `source ~/.zshrc`

### 5. Use it as `docker`

Just start using it:

```bash
docker ps
docker version
docker info
```

## Usage

Stevedore maps Docker Engine CLI commands to `apple/container` where an equivalent exists. It is not a full Docker CLI; unsupported commands are listed below.

| You type | stevedore runs |
|---|---|
| `docker run` | `container run` |
| `docker stop` | `container stop` (Docker's 10-second default timeout) |
| `docker restart` | `container stop` + `container start` |
| `docker port` | reads the container's published port mappings |
| `docker commit` | `container commit` |
| `docker ps` | `container list` |
| `docker images` | `container image list` |
| `docker image inspect` | `container image inspect` |
| `docker pull` | `container image pull` |
| `docker push` | `container image push` |
| `docker rmi` | `container image delete` |
| `docker tag` | `container image tag` |
| `docker save` | `container image save` |
| `docker load` | `container image load` |
| `docker login` / `logout` | `container registry login` / `logout` |
| `docker build` | `container build` |
| `docker exec` | `container exec` |
| `docker logs` | `container logs` |
| `docker network create` | `container network create` |
| `docker volume ls` | `container volume list` |
| `docker system prune [-a] [-f] [--volumes]` | `container prune` + `container network prune` + `container image prune [--all]` (+ `container volume prune` with `--volumes`) |
| `docker container\|image\|volume\|network prune [-a] [-f]` | the matching `container ... prune` |

`docker image <command>` and `docker container <command>` route to the matching top-level handlers when supported. `docker restart` is emulated with stop/start, and `docker port` reads Apple Container's published-port metadata. A bare `docker commit` gets a generated image reference because Apple Container requires one. Some Docker flags are translated (`--net` → `--network`); unsupported flags may be dropped with a warning.

`prune` commands ask for confirmation like Docker does; `-f` skips the prompt. `docker prune` is a stevedore-only shorthand for `docker system prune` (real Docker has no top-level `prune`). `--filter` is not supported by apple/container, so it is refused instead of ignored (ignoring it would prune more than you asked for). Volume pruning removes every volume not used by a container, named ones included.

## Compose Support

Stevedore proxies `docker compose` to the official docker-compose (v2) binary, automatically pointing it at the stevedore socket.

### 1. Install docker-compose

```bash
brew install docker-compose
```

### 2. Use it normally

```bash
cd my-project
docker compose up -d
docker compose ps
docker compose logs -f
docker compose down
```

The socket server starts automatically when you run any compose command.

> **Note**: Compose support quality depends on how complete the socket server's API translation is. Issues with `depends_on`, `healthcheck`, etc. can be fixed as individual endpoints.

## Testcontainers Support

Stevedore includes a Docker API shim that exposes a Docker Engine-compatible socket, enabling Java Testcontainers to work with apple/container.

### 1. Start the API server

```bash
docker socket start
```

This creates a Unix socket at `~/.stevedore/docker.sock`.

### 2. Configure Testcontainers

Set the Docker host environment variable:

```bash
export DOCKER_HOST=unix://$HOME/.stevedore/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$HOME/.stevedore/docker.sock
```

Or in your `testcontainers.properties` file:

```properties
docker.host=unix:///Users/<you>/.stevedore/docker.sock
```

Or as a Java system property:

```
-Dtestcontainers.dockersocket=/Users/<you>/.stevedore/docker.sock
```

### 3. Run your tests

```bash
mvn test
# or
gradle test
```

### Stop the server

```bash
docker socket stop
```

Check status:

```bash
docker socket status
```

## Commands

- `docker <command>` — pass through to apple/container (ps, run, build, pull, exec, etc.)
- `docker compose <command>` — run multi-container apps (proxied to docker-compose)
- `docker socket start/stop/status` — manage the Docker API server for Testcontainers
- `stevedore doctor` — environment diagnostics (only available via `stevedore` name)

### Not yet supported

These Docker Engine CLI commands are not implemented by Stevedore. Apple Container has no direct CLI equivalent for many of them; some would require a separate adapter:

- `docker attach`, `docker diff`, `docker events`
- `docker history`, `docker image history`, `docker import`, `docker image import`, `docker search`
- `docker pause`, `docker unpause`, `docker rename`, `docker top`, `docker update`, `docker wait`
- `docker network connect` / `disconnect`

Docker CLI extensions and orchestration commands such as Buildx, contexts, Swarm, services, stacks, secrets, configs, and plugins are also outside Stevedore's scope. `docker inspect` defaults to containers; use `--type=image|network|volume` for other resource types. Docker's automatic resource detection is not replicated. `docker commit` options (`--author`, `--change`, `--message`, `--pause`) are not supported.

### Docker socket API limitations

The socket implements common container, image, network, volume, build, and auth operations for Testcontainers and Compose, but it is not the full Docker Engine API. It advertises API v1.44 (minimum v1.24). Docker events and detailed `/system/df` are unavailable; wait, top, attach, rename, pause/unpause, update, changes, network connect/disconnect, and interactive exec stdin are also unavailable. Prune filters are only partly supported, and image loading requires an OCI-compatible archive. Unmapped endpoints return 404.

## License

MIT
