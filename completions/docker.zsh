#compdef docker stevedore

_stevedore_list_containers_by_state() {
  local scope="$1"
  local all_flag=""
  if [[ "$scope" != "running" ]]; then
    all_flag="-a"
  fi

  # Prefer structured JSON so completion is independent of table column order.
  if command -v python3 >/dev/null 2>&1; then
    docker ps $all_flag --format json 2>/dev/null | python3 - "$scope" <<'PY'
import json, sys
scope = sys.argv[1]
raw = sys.stdin.read().strip()
if not raw:
    raise SystemExit(0)
try:
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
if isinstance(data, dict):
    data = [data]
vals = set()
for c in data:
    state = str((c.get("status") or {}).get("state") or "")
    if scope == "running" and state != "running":
        continue
    if scope == "stopped" and state == "running":
        continue

    cid = str(c.get("id") or "").strip()
    if cid:
        vals.add(cid)

    cfg = c.get("configuration") or {}
    cfg_id = str(cfg.get("id") or "").strip()
    if cfg_id:
        vals.add(cfg_id)

    host = ""
    nets = (c.get("status") or {}).get("networks") or []
    if nets and isinstance(nets, list):
        host = str((nets[0] or {}).get("hostname") or "").strip()
    if host:
        vals.add(host)

for v in sorted(vals):
    print(v)
PY
    return
  fi

  # Fallback for environments without python3.
  docker ps $all_flag 2>/dev/null | awk 'NR>1 {print $1}' | sort -u
}

_stevedore_list_containers() {
  _stevedore_list_containers_by_state all
}

_stevedore_list_running_containers() {
  _stevedore_list_containers_by_state running
}

_stevedore_list_stopped_containers() {
  _stevedore_list_containers_by_state stopped
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
    attach|exec|inspect|logs|port|rename|rm|top|wait)
      local -a containers
      containers=(${(f)"$(_stevedore_list_containers)"})
      compadd -a containers
      return
      ;;
    kill|restart|stats|stop|pause|unpause)
      local -a containers
      containers=(${(f)"$(_stevedore_list_running_containers)"})
      compadd -a containers
      return
      ;;
    start)
      local -a containers
      containers=(${(f)"$(_stevedore_list_stopped_containers)"})
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
