#!/bin/zsh
# VDT Studio local web launcher for macOS. Double-click in Finder or use
# ./run.command [start|stop|restart|status|open] in Terminal.

emulate -L zsh
setopt NO_UNSET
unsetopt NOMATCH

ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
cd -- "$ROOT" || exit 1
APP_NAME="VDT Studio"
PORT=3000
URL="http://localhost:${PORT}"
LAUNCHER="$ROOT/scripts/mac-web-launcher.mjs"

printf '\033]0;%s\007' "$APP_NAME"

bootstrap_path() {
  path=(
    /opt/homebrew/opt/node@24/bin
    /opt/homebrew/bin
    /usr/local/opt/node@24/bin
    /usr/local/bin
    "$HOME/.local/bin"
    $path
  )
  typeset -gU path
  command -v node >/dev/null 2>&1 && return 0

  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
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
  print "Error: $*" >&2
  pause_if_needed
  exit 1
}

launcher() {
  command -v node >/dev/null 2>&1 || fail "Node 24 is required. Install node@24 with Homebrew or nvm."
  node "$LAUNCHER" "$1" "$PORT"
}

read_state() {
  STATE="$(launcher status)" || exit 1
}

print_status() {
  case "$STATE" in
    ready) print "Status: running  ${URL}" ;;
    starting) print "Status: starting  ${URL}" ;;
    stopping) print "Status: stopping" ;;
    occupied) print "Status: port ${PORT} is occupied by a process outside this launcher." ;;
    stopped) print "Status: stopped" ;;
  esac
}

open_app() {
  read_state
  case "$STATE" in
    ready) open "$URL" ;;
    starting|stopping) print_status ;;
    occupied) fail "Port ${PORT} is occupied by a process outside this launcher." ;;
    stopped) fail "The app is not running. Choose Start first." ;;
  esac
}

ensure_install() {
  [[ -d node_modules && -f apps/web/node_modules/next/dist/bin/next ]] && return 0
  print "Dependencies are missing. Running pnpm install..."
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  else
    fail "pnpm was not found. Enable it with: corepack enable"
  fi
}

start_app() {
  read_state
  case "$STATE" in
    ready|starting|stopping) open_app; return ;;
    occupied) fail "Port ${PORT} is occupied by a process outside this launcher." ;;
  esac

  local major lock_file
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$major" == 24 ]] || fail "Found Node $(node -v). Switch to Node 24 to start VDT Studio."
  lock_file="$(launcher prepare)" || exit 1
  zmodload zsh/system || fail "Could not load zsh file locking."
  # The lock stays with this process across exec and is released by the OS.
  if ! zsystem flock -e -t 4 -i 0.1 "$lock_file"; then
    read_state
    [[ "$STATE" == ready || "$STATE" == starting ]] && { open_app; return; }
    fail "Another launcher is starting or shutting down. Check its Terminal window."
  fi
  read_state
  [[ "$STATE" == stopped ]] || { open_app; return; }
  ensure_install || fail "Could not install dependencies."
  node packages/data-harness/scripts/build-parser-worker.mjs || fail "Could not prepare the file parser."

  print "Starting ${APP_NAME} at ${URL}"
  print "Stop with Ctrl+C in this window, or open run.command again."
  export VDT_CURSOR_SESSION_MODEL="${VDT_CURSOR_SESSION_MODEL:-cursor-grok-4.6-medium}"
  exec node "$LAUNCHER" serve "$PORT"
}

stop_app() {
  launcher stop || { pause_if_needed; exit 1; }
}

restart_app() {
  stop_app
  start_app
}

interactive() {
  read_state
  print ""
  print "========================================"
  print " ${APP_NAME}"
  print "========================================"
  print_status
  print ""
  case "$STATE" in
    ready|starting|stopping)
      print "  1) Stop"
      print "  2) Restart"
      print "  3) Open in browser"
      print "  q) Close this window (the app keeps running)"
      ;;
    stopped) print "  1) Start"; print "  q) Quit" ;;
    occupied) print "  q) Quit" ;;
  esac
  printf "\nChoose an action: "
  local choice
  read -r choice || choice="q"
  case "$choice" in
    1)
      case "$STATE" in
        ready|starting|stopping) stop_app ;;
        *) start_app ;;
      esac
      ;;
    2) restart_app ;;
    3) open_app ;;
    q|Q|"") return ;;
    *) fail "Unknown choice." ;;
  esac
  pause_if_needed
}

LAUNCHED_WITH_ARGS=0
if (( $# > 0 )); then
  LAUNCHED_WITH_ARGS=1
  case "$1" in
    start) start_app ;;
    stop) stop_app ;;
    restart) restart_app ;;
    status) read_state; print_status ;;
    open) open_app ;;
    -h|--help|help) print "Usage: ${0:t} [start|stop|restart|status|open]" ;;
    *) fail "Unknown command: $1 (start|stop|restart|status|open)" ;;
  esac
else
  interactive
fi
