# Bash completion for stevedore (docker compatibility layer)

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
  local cur prev words cword
  if declare -F _init_completion >/dev/null 2>&1; then
    _init_completion -n : || return
  else
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    words=("${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  fi

  local -a top_commands=(
    attach build commit compose cp create diff doctor events exec export history images import info inspect
    kill load login logout logs network pause port ps pull push rename restart rm rmi run save search socket
    start stats stop system tag top unpause version volume wait completion
  )

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${top_commands[*]}" -- "$cur") )
    return
  fi

  case "${words[1]}" in
    attach|exec|inspect|logs|port|rename|rm|top|wait)
      COMPREPLY=( $(compgen -W "$( _stevedore_list_containers )" -- "$cur") )
      return
      ;;
    kill|restart|stats|stop|pause|unpause)
      COMPREPLY=( $(compgen -W "$( _stevedore_list_running_containers )" -- "$cur") )
      return
      ;;
    start)
      COMPREPLY=( $(compgen -W "$( _stevedore_list_stopped_containers )" -- "$cur") )
      return
      ;;
    run|create)
      COMPREPLY=( $(compgen -W "$( _stevedore_list_images )" -- "$cur") )
      return
      ;;
    rmi|history|push)
      COMPREPLY=( $(compgen -W "$( _stevedore_list_images )" -- "$cur") )
      return
      ;;
    network)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "create inspect ls list rm remove prune" -- "$cur") )
      else
        case "${words[2]}" in
          inspect|rm|remove)
            COMPREPLY=( $(compgen -W "$( _stevedore_list_networks )" -- "$cur") )
            ;;
        esac
      fi
      return
      ;;
    volume)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "create inspect ls list rm remove prune" -- "$cur") )
      else
        case "${words[2]}" in
          inspect|rm|remove)
            COMPREPLY=( $(compgen -W "$( _stevedore_list_volumes )" -- "$cur") )
            ;;
        esac
      fi
      return
      ;;
    system)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "df prune events" -- "$cur") )
        return
      fi
      ;;
    socket)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "start stop status" -- "$cur") )
        return
      fi
      ;;
    compose)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "up down ps logs exec run build pull push restart stop start config version" -- "$cur") )
        return
      fi
      ;;
    completion)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") )
        return
      fi
      ;;
  esac
}

complete -F _stevedore_docker_complete docker
complete -F _stevedore_docker_complete stevedore
