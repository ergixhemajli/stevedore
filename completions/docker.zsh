#compdef docker stevedore

_stevedore_list_containers() {
  docker ps -a 2>/dev/null | awk 'NR>1 {print $1}'
}

_stevedore_list_images() {
  docker images 2>/dev/null | awk 'NR>1 {print $1":"$2}'
}

_stevedore_list_networks() {
  docker network ls 2>/dev/null | awk 'NR>1 {print $1}'
}

_stevedore_list_volumes() {
  docker volume ls 2>/dev/null | awk 'NR>1 {print $1}'
}

_stevedore_docker_complete() {
  local -a top_commands
  top_commands=(
    attach build commit compose cp create diff doctor events exec export history images import info inspect
    kill load login logout logs network pause port ps pull push rename restart rm rmi run save search socket
    start stats stop system tag top unpause version volume wait completion
  )

  if (( CURRENT == 2 )); then
    compadd -a top_commands
    return
  fi

  case "$words[2]" in
    attach|exec|inspect|kill|logs|port|rename|restart|rm|start|stats|stop|top|wait|pause|unpause)
      local -a containers
      containers=(${(f)"$(_stevedore_list_containers)"})
      compadd -a containers
      return
      ;;
    run|create|rmi|history|push)
      local -a images
      images=(${(f)"$(_stevedore_list_images)"})
      compadd -a images
      return
      ;;
    network)
      if (( CURRENT == 3 )); then
        local -a network_sub
        network_sub=(create inspect ls list rm remove prune)
        compadd -a network_sub
      else
        case "$words[3]" in
          inspect|rm|remove)
            local -a networks
            networks=(${(f)"$(_stevedore_list_networks)"})
            compadd -a networks
            ;;
        esac
      fi
      return
      ;;
    volume)
      if (( CURRENT == 3 )); then
        local -a volume_sub
        volume_sub=(create inspect ls list rm remove prune)
        compadd -a volume_sub
      else
        case "$words[3]" in
          inspect|rm|remove)
            local -a volumes
            volumes=(${(f)"$(_stevedore_list_volumes)"})
            compadd -a volumes
            ;;
        esac
      fi
      return
      ;;
    system)
      if (( CURRENT == 3 )); then
        local -a system_sub
        system_sub=(df prune events)
        compadd -a system_sub
        return
      fi
      ;;
    socket)
      if (( CURRENT == 3 )); then
        local -a socket_sub
        socket_sub=(start stop status)
        compadd -a socket_sub
        return
      fi
      ;;
    compose)
      if (( CURRENT == 3 )); then
        local -a compose_sub
        compose_sub=(up down ps logs exec run build pull push restart stop start config version)
        compadd -a compose_sub
        return
      fi
      ;;
    completion)
      if (( CURRENT == 3 )); then
        compadd bash zsh
        return
      fi
      ;;
  esac
}

_stevedore_docker_complete "$@"
