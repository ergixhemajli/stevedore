# Stevedore Troubleshooting Notes & Known Issues

## Testcontainers/Ryuk Architecture

### How Ryuk Works Through Stevedore
1. Ryuk exposes its **custom TCP protocol** on port 8080 (published via `--publish-socket`)
2. Testcontainers connects to ryuk's published port and sends `register` command
3. Ryuk responds with `ACK\n` and begins monitoring
4. **Ryuk's Docker socket mount is NOT needed** for the register flow — it only uses the TCP port
5. The socket mount (`/var/run/docker.sock`) via apple/container virtiofs fails with "No such device or address" but ryuk continues to work

### Apple/container Virtiofs Socket Limitation
- Mounting Unix domain sockets via virtiofs does **not work** from inside the container
- Error: `cannot create /var/run/docker.sock: No such device or address`
- The socket file appears (shows as socket type) but cannot be connected to
- **Workaround**: Ryuk works fine without the socket mount since it communicates via its published TCP port

## Known Failures & Fixes

### Wrong Image Variant Pulled (FIXED)
- **Problem**: `testcontainers/ryuk:0.12.0` pulled as `amd64/windows` (first variant in multi-platform manifest)
- **Symptom**: Broken pipe, port binding failures
- **Root cause**: Stevedore's socket API ignored the `platform` parameter from Docker API requests
- **Fix**: Added platform passthrough in `src/api/routes/images.js` (pull/create) and `src/api/routes/containers.js` (create)
- **Verification**: Re-pull with `container image pull --platform linux/arm64` to get correct variant

### Port Binding in Stevedore
- Testcontainers assigns random host ports when `HostPort` is empty
- apple/container requires explicit host port
- Stevedore handles this: empty `HostPort` → assign random port on host
- Verified working via smoke test (register → ACK response)

### Ryuk containers pile up as `stopped` (FIXED)
- **Symptom**: `docker ps -a` fills with `testcontainers-ryuk-<session>` containers in state `stopped`
- **Root cause**: Testcontainers creates Ryuk with `HostConfig.AutoRemove=true`, and Ryuk's own labels lack `org.testcontainers.sessionId`, so Ryuk never reaps itself — it relies on the engine removing it once it exits. `buildRunArgs` ignored `AutoRemove`.
- **Fix**: `src/api/routes/containers.js` maps `HostConfig.AutoRemove` → `container create --rm` (apple/container removes the container itself when it stops, even after a detached `start`)
- **Needs**: restart the API server (`docker socket stop && docker socket start`) to load the fix; clear older leftovers with `docker container prune -f`
- **Observed on container 1.5.0**: Ryuk *does* reach the stevedore socket through the virtiofs mount — its `DELETE ...?force=1&v=1` calls show up in `~/.stevedore/server.log` and its own log ends with `removed containers=N ... done`

## Testcontainers Smoke Test (Manual Verification)
```python
# Create container with port binding
POST /containers/create
Body: {"Image": "testcontainers/ryuk:0.12.0", "HostConfig": {"PortBindings": {"8080/tcp": [{"HostIp": "0.0.0.0", "HostPort": ""}]}}}

# Start container
POST /containers/<id>/start

# Connect and register
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', <published_port>))
s.send(b'register\n')
resp = s.recv(1024)  # b'ACK\n'
```

## Configuration
- Docker socket: `~/.stevedore/docker.sock`
- Env vars: `DOCKER_HOST=unix://$HOME/.stevedore/docker.sock`
- Testcontainers socket override: `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=$HOME/.stevedore/docker.sock`
