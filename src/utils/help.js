export function printHelp() {
  console.log(`
Usage:  docker [OPTIONS] COMMAND

A Docker Engine CLI compatibility layer powered by apple/container.

Options:
      --help     Print usage
  -v, --version  Print version information

Commands:
  help          Print command-specific help

Container Commands:
  commit      Create a new image from a container's changes
  container   Manage containers
  cp          Copy files/folders between a container and the local filesystem
  create      Create a new container
  exec        Run a command in a running container
  export      Export a container's filesystem as a tar archive
  inspect     Display detailed information about a container
  kill        Kill one or more running containers
  logs        Fetch the logs of a container
  ls, ps      List containers
  port        List published port mappings
  restart     Restart one or more containers
  rm          Remove one or more containers
  run         Run a command in a new container
  start       Start one or more stopped containers
  stats       Display container resource usage
  stop        Stop one or more running containers

Image Commands:
  build       Build an image from a Dockerfile
  image       Manage images
  images      List images
  load        Load images from an archive
  login       Log in to a registry
  logout      Log out from a registry
  pull        Download an image from a registry
  push        Upload an image to a registry
  rmi         Remove one or more images
  save        Save one or more images to an archive
  tag         Create a tag that refers to a source image

Network Commands:
  network     Manage networks

Volume Commands:
  volume      Manage volumes

System Commands:
  info        Display system-wide information
  prune       Remove unused data (shorthand for "system prune")
  system      Manage the container system (df, info, prune)
  version     Show version information

Compose Commands:
  compose     Run multi-container apps (proxied to docker-compose)

Stevedore Commands:
  completion  Print shell completion scripts
  doctor      Check if stevedore and apple/container are working properly
  env         Print shell exports (stevedore only)
  socket      Manage the Docker API server for Testcontainers

Not implemented by Stevedore (many have no direct apple/container equivalent):
  attach, diff, events, history, import, pause, rename, search, top, unpause,
  update, wait, network connect/disconnect

Docker CLI extensions and orchestration commands such as buildx, contexts,
Swarm, services, stacks, secrets, configs, and plugins are not implemented.
The Docker socket API is a v1.44 compatibility subset; events, detailed system
disk usage, container wait/top/attach/rename/pause/unpause/update, network
connect/disconnect, and interactive exec stdin are unavailable.

Some Docker flags are not supported by apple/container and may be dropped with
an explicit warning. Commit metadata options are not supported. See the README
for command-specific limitations.
`);
}
