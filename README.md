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

### 3. Use it as `docker`

After installing globally, stevedore is installed as `docker` in your PATH. Just start using it:

```bash
docker ps
docker version
docker info
```

Run `docker doctor` to verify everything is working:

```bash
docker doctor
```

## Requirements

- macOS on Apple Silicon
- apple/container 1.0.0+
- Node.js 20+

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

## Not yet supported

- `docker network connect` / `disconnect`
- `docker commit`, `docker diff`
- `docker top`, `docker port`

## License

MIT
