#!/bin/zsh
# VDT Studio local web launcher for macOS.
# Double-click in Finder, or run from Terminal:
#   ./run.command            interactive menu
#   ./run.command start
#   ./run.command stop
#   ./run.command restart
#   ./run.command status
#   ./run.command open

emulate -L zsh
setopt NO_UNSET
unsetopt NOMATCH

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="VDT Studio"
PORT=3000
URL="http://localhost:${PORT}"
HEALTH_URL="http://127.0.0.1:${PORT}"
PID_FILE="${ROOT}/.vdt/dev-web.pid"

cd "$ROOT"

printf '\033]0;%s\007' "$APP_NAME"

bootstrap_path() {
  path=(
    /opt/homebrew/opt/node@24/bin
    /opt/homebrew/bin
    /usr/local/opt/node@24/bin
    /usr/local/bin
    "$HOME/.local/bin"
    /usr/sbin
    $path
  )
  typeset -gU path

  command -v node >/dev/null 2>&1 && return 0

  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # nvm is not nounset-safe
    setopt LOCAL_OPTIONS
    unsetopt NO_UNSET
    source "$HOME/.nvm/nvm.sh"
    nvm use --silent >/dev/null 2>&1 || true
  fi

  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd --shell zsh 2>/dev/null)" || true
  fi
}

bootstrap_path

pause_if_needed() {
  if [[ -t 0 && "${LAUNCHED_WITH_ARGS:-0}" -eq 0 ]]; then
    print ""
    print "Press Enter to close this window."
    read -r || true
  fi
}

fail() {
  print ""
  print "Error: $*" >&2
  pause_if_needed
  exit 1
}

listen_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

running_pids() {
  local raw
  raw="$(listen_pids)"
  reply=()
  if [[ -n "$raw" ]]; then
    reply=(${(f)raw})
  fi
}

is_running() {
  [[ -n "$(listen_pids)" ]]
}

is_ready() {
  curl -sf -o /dev/null --max-time 2 "$HEALTH_URL" >/dev/null 2>&1
}

print_status() {
  if is_ready; then
    print "Status: running and ready  ${URL}"
  elif is_running; then
    print "Status: starting on port ${PORT}  ${URL}"
  else
    print "Status: stopped"
  fi
}

ensure_runtime() {
  command -v node >/dev/null 2>&1 || fail "Node.js was not found. Node 24 is required. Install node@24 with Homebrew or nvm."
  command -v lsof >/dev/null 2>&1 || fail "lsof was not found."

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" != "24" ]]; then
    print "Warning: found Node $(node -v); Node 24.x is expected."
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    PNPM_CMD=(corepack pnpm)
  elif command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
  else
    fail "pnpm was not found. Enable it with: corepack enable"
  fi
}

ensure_install() {
  if [[ -d "${ROOT}/node_modules" && -d "${ROOT}/apps/web/node_modules" ]]; then
    return 0
  fi
  print "Dependencies are missing. Running pnpm install..."
  "${PNPM_CMD[@]}" install --frozen-lockfile
}

write_pid() {
  mkdir -p "${ROOT}/.vdt"
  print -r -- "$1" >| "$PID_FILE"
}

stop_app() {
  local -a pids
  running_pids
  pids=("${reply[@]}")

  if (( ${#pids} == 0 )); then
    print "${APP_NAME} is already stopped."
    rm -f "$PID_FILE"
    return 0
  fi

  print "Stopping ${APP_NAME} (port ${PORT})..."
  kill "${pids[@]}" 2>/dev/null || true

  local i
  for i in {1..30}; do
    running_pids
    pids=("${reply[@]}")
    (( ${#pids} == 0 )) && break
    sleep 0.2
  done

  running_pids
  pids=("${reply[@]}")
  if (( ${#pids} > 0 )); then
    kill -9 "${pids[@]}" 2>/dev/null || true
    sleep 0.2
  fi

  rm -f "$PID_FILE"

  if is_running; then
    fail "Could not free port ${PORT}."
  fi

  print "Stopped."
}

open_browser_when_ready() {
  local i
  for i in {1..90}; do
    if is_ready; then
      open "$URL" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 0.4
  done
}

start_app() {
  if is_running; then
    print "${APP_NAME} is already running: ${URL}"
    if is_ready; then
      open "$URL" >/dev/null 2>&1 || true
    fi
    return 0
  fi

  ensure_runtime
  ensure_install

  print "Starting ${APP_NAME}..."
  print "Logs appear below. Stop with Ctrl+C in this window, or open run.command again."
  print "URL: ${URL}"
  print ""

  open_browser_when_ready &
  local opener_pid=$!

  trap 'kill '"$opener_pid"' 2>/dev/null; rm -f '"$PID_FILE"'; exit 0' INT TERM
  write_pid "$$"
  "${PNPM_CMD[@]}" dev
  local exit_code=$?
  rm -f "$PID_FILE"
  kill "$opener_pid" 2>/dev/null || true
  wait "$opener_pid" 2>/dev/null || true
  exit "$exit_code"
}

restart_app() {
  stop_app
  start_app
}

open_app() {
  if is_ready; then
    open "$URL"
    print "Opened ${URL}"
    return 0
  fi
  if is_running; then
    print "The server is still starting. Wait a moment, then open ${URL}"
    return 0
  fi
  fail "The app is not running. Choose Start first."
}

show_menu() {
  print ""
  print "========================================"
  print " ${APP_NAME}"
  print "========================================"
  print_status
  print ""

  if is_running; then
    print "  1) Stop"
    print "  2) Restart"
    print "  3) Open in browser"
    print "  q) Close this window (the app keeps running)"
  else
    print "  1) Start"
    print "  q) Quit"
  fi
  print ""
  printf "Choose an action: "
}

interactive() {
  show_menu
  local choice
  read -r choice || choice="q"
  print ""

  case "$choice" in
    1)
      if is_running; then
        stop_app
        pause_if_needed
      else
        start_app
      fi
      ;;
    2)
      if is_running; then
        restart_app
      else
        print "The app is not running — starting it."
        start_app
      fi
      ;;
    3)
      if is_running; then
        open_app
        pause_if_needed
      else
        print "Unknown option. Starting the app."
        start_app
      fi
      ;;
    q|Q|"")
      exit 0
      ;;
    *)
      print "Unknown choice."
      pause_if_needed
      exit 1
      ;;
  esac
}

LAUNCHED_WITH_ARGS=0
if (( $# > 0 )); then
  LAUNCHED_WITH_ARGS=1
  case "$1" in
    start) start_app ;;
    stop) stop_app ;;
    restart) restart_app ;;
    status) print_status ;;
    open) open_app ;;
    -h|--help|help)
      print "Usage: $(basename "$0") [start|stop|restart|status|open]"
      ;;
    *)
      fail "Unknown command: $1 (start|stop|restart|status|open)"
      ;;
  esac
  exit 0
fi

interactive
