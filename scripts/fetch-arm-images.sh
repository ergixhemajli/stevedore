#!/usr/bin/env bash

# fetch-arm-images.sh
# Inspect, remove local amd64 variants, pull linux/arm64 variants for a curated list.
# Usage: ./scripts/fetch-arm-images.sh
# Optional: set IMAGES env var with space-separated image refs to override the list.

set -u

# Detect which CLI to use: prefer docker, fallback to container (apple/container)
if command -v docker >/dev/null 2>&1; then
  CLI="docker"
elif command -v container >/dev/null 2>&1; then
  CLI="container"
else
  echo "ERROR: neither 'docker' nor 'container' CLI found in PATH." >&2
  exit 1
fi

# If docker is stevedore shim, use container CLI directly when available.
# stevedore doesn't support full `docker image ...` subcommands.
if [ "$CLI" = "docker" ] && docker --help 2>&1 | grep -qi "stevedore"; then
  if command -v container >/dev/null 2>&1; then
    CLI="container"
  fi
fi

PLATFORM=${PLATFORM:-linux/arm64}

# Default curated list; override by setting IMAGES environment variable
if [ -n "${IMAGES-}" ]; then
  read -r -a IMGS <<< "$IMAGES"
else
  IMGS=(
    "testcontainers/ryuk:0.12.0"
    "pgvector/pgvector:0.8.0-pg16"
    "postgres:16"
  )
fi

echo "Using CLI: $CLI"
echo "Target platform: $PLATFORM"
echo

# Helper: attempt to inspect and return architecture for docker
docker_arch_of() {
  local img="$1"
  docker image inspect --format '{{.Architecture}}' "$img" 2>/dev/null || echo "missing"
}

# Helper: attempt to inspect and return architecture for container CLI JSON
container_arch_of() {
  local img="$1"
  local out line
  out=$(container image inspect "$img" 2>/dev/null || true)
  if [ -z "$out" ]; then
    echo "missing"
    return 0
  fi

  line=$(echo "$out" | grep -m1 -E '"architecture"[[:space:]]*:[[:space:]]*"' || true)
  if [ -z "$line" ]; then
    echo "unknown"
    return 0
  fi

  # BSD sed on macOS doesn't support \s, so use POSIX [[:space:]].
  echo "$line" | sed -E 's/.*"architecture"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

# Main loop
for img in "${IMGS[@]}"; do
  echo "================================================================"
  echo "Image: $img"

  if [ "$CLI" = "docker" ]; then
    # Check local
    local_arch=$(docker_arch_of "$img")
    echo " Local: $local_arch"

    if [ "$local_arch" = "amd64" ]; then
      echo " Removing local amd64 image $img (best-effort)"
      if ! docker image rm -f "$img" >/dev/null 2>&1; then
        echo "  Warning: failed to remove $img; it may be in use or not present as a tag."
      fi
    fi

    # Optional remote manifest probe (many shims don't implement this)
    if docker manifest inspect "$img" >/dev/null 2>&1; then
      if docker manifest inspect "$img" 2>/dev/null | grep -q '"architecture": *"arm64"'; then
        echo " Remote manifest: supports arm64"
      else
        echo " Remote manifest: no arm64 entry detected (pull will still be attempted)"
      fi
    else
      echo " Remote manifest: unavailable via current docker CLI; proceeding to pull"
    fi

    echo " Pulling $img for $PLATFORM"
    # Prefer `docker image pull` because some docker shims map `docker pull`
    # to `container pull` (which may not exist), while `image pull` works.
    if ! DOCKER_DEFAULT_PLATFORM=$PLATFORM docker image pull "$img"; then
      echo "  Warning: docker image pull failed; trying docker pull"
      if ! DOCKER_DEFAULT_PLATFORM=$PLATFORM docker pull "$img"; then
        if command -v container >/dev/null 2>&1; then
          echo "  Warning: docker pull failed; trying container image pull"
          if ! container image pull --platform "$PLATFORM" "$img"; then
            echo "  Error: pull failed for $img"
            continue
          fi
        else
          echo "  Error: pull failed for $img"
          continue
        fi
      fi
    fi

    # Report final architecture
    final_arch=$(docker image inspect --format '{{.Architecture}} / {{.Os}}' "$img" 2>/dev/null || echo "inspect-failed")
    echo " Final: $final_arch"

  else
    # apple/container best-effort path
    echo " apple/container: best-effort operations (inspect/delete/pull)"

    local_arch=$(container_arch_of "$img")
    echo " Local: $local_arch"

    if [ "$local_arch" = "amd64" ]; then
      echo " Removing local amd64 image $img (best-effort)"
      if ! container image delete "$img" >/dev/null 2>&1; then
        echo "  Warning: failed to delete $img"
      fi
    fi

    echo " Pulling $img --platform $PLATFORM"
    if ! container image pull --platform "$PLATFORM" "$img"; then
      echo "  Error: pull failed for $img"
      continue
    fi

    final_arch=$(container_arch_of "$img")
    echo " Final: $final_arch"
  fi

  echo
done

# Summary
echo "================================================================"
echo "Summary"
if [ "$CLI" = "docker" ]; then
  for img in "${IMGS[@]}"; do
    arch=$(docker image inspect --format '{{.Architecture}} / {{.Os}}' "$img" 2>/dev/null || echo "missing")
    echo " $img -> $arch"
  done
else
  for img in "${IMGS[@]}"; do
    arch=$(container_arch_of "$img")
    echo " $img -> $arch"
  done
fi

echo
echo "Done. If you still see amd64 variants after this, the remote image may not provide an arm64 build." 