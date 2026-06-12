/**
 * help.js — top-level help output that mirrors docker's style
 */

export function printHelp() {
  console.log(`
Usage:  stevedore [OPTIONS] COMMAND

A docker-compatible CLI powered by apple/container (stevedore)

Options:
      --help     Print usage
  -v, --version  Print version information

Container Commands:
  attach      Attach local standard input, output, and error streams to a running container
  commit      Create a new image from a container's changes
  cp          Copy files/folders between a container and the local filesystem
  create      Create a new container
  diff        Inspect changes to files or directories on a container's filesystem
  doctor      Check if stevedore and apple/container are working properly
  exec        Run a command in a running container
  export      Export a container's filesystem as a tar archive
  inspect     Display detailed information on one or more containers
  kill        Kill one or more running containers
  logs        Fetch the logs of a container
  ls          List containers
  pause       Pause all processes within one or more containers
  port        List port mappings or a specific mapping for the container
  rename      Rename a container
  restart     Restart one or more containers
  rm          Remove one or more containers
  run         Run a command in a new container
  start       Start one or more stopped containers
  stats       Display a live stream of container(s) resource usage statistics
  stop        Stop one or more running containers
  top         Display the running processes of a container
  unpause     Unpause all processes within one or more containers
  update      Update configuration of one or more containers
  wait        Block until one or more containers stop, then print their exit codes

Image Commands:
  build       Build an image from a Dockerfile
  history     Show the history of an image
  images      List images
  import      Import the contents from a tarball to create a filesystem image
  load        Load an image from a tar archive or STDIN
  pull        Download an image from a registry
  push        Upload an image to a registry
  rmi         Remove one or more images
  save        Save one or more images to a tar archive
  search      Search Docker Hub for images
  tag         Create a tag TARGET_IMAGE that refers to SOURCE_IMAGE

Network Commands:
  network     Manage networks

Volume Commands:
  volume      Manage volumes

System Commands:
  events      Get real time events from the server
  info        Display system-wide information
  login       Log in to a registry
  logout      Log out from a registry
  system      Manage containers (mapped to container system)
  version     Show the Docker version information

Compose Commands:
  compose     Run multi-container apps (proxied to docker-compose)

Utility Commands:
  completion  Output shell completion script (bash|zsh)

Socket Commands:
  socket      Manage the Docker API server (start/stop/status) — see docs for Testcontainers setup

Run 'stevedore COMMAND --help' for more information on a command.

Note: stevedore is a compatibility layer. Some Docker flags are not supported
by apple/container and will be ignored with a warning.

For Testcontainers support, start the API server with:
  stevedore socket start

See https://github.com/stevedore for setup instructions.
`);
}
