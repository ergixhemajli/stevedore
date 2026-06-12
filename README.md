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

### 4. Add optional Testcontainers env vars

Add this to your `~/.zshrc` (or `~/.bashrc`) if you use Testcontainers:

```bash
export DOCKER_HOST=unix://$HOME/.stevedore/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$HOME/.stevedore/docker.sock
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

Stevedore maps the full `docker` CLI to `apple/container`. Most commands work directly:

| You type | stevedore runs |
|---|---|
| `docker run` | `container run` |
| `docker ps` | `container list` |
| `docker images` | `container image list` |
| `docker pull` | `container image pull` |
| `docker build` | `container build` |
| `docker exec` | `container exec` |
| `docker logs` | `container logs` |
| `docker network create` | `container network create` |
| `docker volume ls` | `container volume list` |
| `docker system prune` | `container prune` + `container image prune` |

Some docker flags are automatically translated (`--net` → `--network`) and unsupported ones are silently dropped with a warning, so your existing scripts keep working.

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

- `docker network connect` / `disconnect`
- `docker commit`, `docker diff`
- `docker top`, `docker port`

## License

MIT
