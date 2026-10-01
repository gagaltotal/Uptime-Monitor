#!/usr/bin/env bash
#
# Uptime Monitor — Agent Monitoring collector
# -------------------------------------------
# Lightweight, distribution-agnostic bash agent that gathers system metrics and
# ships them to the Uptime Monitor API. Works on any Linux distro because it
# reads plain kernel interfaces (/proc, /etc/os-release) instead of relying on
# distro-specific tooling.
#
# Usage:
#   ./uptime-agent.sh                 # loop forever, report every INTERVAL seconds
#   ./uptime-agent.sh --once          # collect + send a single report then exit
#   ./uptime-agent.sh --print         # collect + print the JSON payload, do NOT send
#   ./uptime-agent.sh --selftest      # gather metrics without sending, show a summary
#
# Configuration (first match wins):
#   1. Environment variables: UPTIME_SERVER_URL, UPTIME_AGENT_TOKEN, UPTIME_INTERVAL
#   2. Config file:           /etc/uptime-agent/agent.conf  (or $UPTIME_AGENT_CONF)
#
# The API endpoints used:
#   POST {SERVER}/api/agents/report   -> metrics + osInfo  (header: x-agent-token)
#   POST {SERVER}/api/agents/logs     -> a log line         (header: x-agent-token)
#
set -u

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="uptime-agent"
readonly DEFAULT_CONF="/etc/uptime-agent/agent.conf"
readonly HTTP_TIMEOUT="${UPTIME_HTTP_TIMEOUT:-15}"
readonly LOG_MAX_BYTES=1900   # keep well under the API's 2000-char limit

# ---------------------------------------------------------------------------
# Load configuration
# ---------------------------------------------------------------------------
UPTIME_SERVER_URL="${UPTIME_SERVER_URL:-}"
UPTIME_AGENT_TOKEN="${UPTIME_AGENT_TOKEN:-}"
UPTIME_INTERVAL="${UPTIME_INTERVAL:-60}"
UPTIME_SEND_LOGS="${UPTIME_SEND_LOGS:-false}"

CONF_FILE="${UPTIME_AGENT_CONF:-$DEFAULT_CONF}"
if [ -r "$CONF_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONF_FILE"
fi

# ---------------------------------------------------------------------------
# Logging helpers (to stderr so stdout stays clean for --print)
# ---------------------------------------------------------------------------
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

log()   { printf '%s [%s] %s\n' "$(ts)" "INFO"  "$*" >&2; }
warn()  { printf '%s [%s] %s\n' "$(ts)" "WARN"  "$*" >&2; }
error() { printf '%s [%s] %s\n' "$(ts)" "ERROR" "$*" >&2; }

# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------
# have <command> — portable "command exists" check
have() { command -v "$1" >/dev/null 2>&1; }

# trim <string> — strip leading/trailing whitespace
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# json_escape <string> — escape a value for safe inclusion inside a JSON string
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"     # backslash
  s="${s//\"/\\\"}"     # double quote
  s="${s//$'\n'/ }"     # newline -> space
  s="${s//$'\r'/ }"     # carriage return
  s="${s//$'\t'/ }"     # tab
  printf '%s' "$s"
}

# num_or_zero <value> — emit the value only if it is numeric, else 0
num_or_zero() {
  case "$1" in
    ''|*[!0-9.]*) printf '0' ;;
    *) printf '%s' "$1" ;;
  esac
}

# bytes_to_mb <bytes>  (integer)
bytes_to_mb() { printf '%s' "$(( ${1:-0} / 1048576 ))"; }

# kb_to_gb <kilobytes> (one decimal place)
kb_to_gb() {
  awk -v kb="${1:-0}" 'BEGIN { printf "%.1f", kb / 1048576 }'
}

# ---------------------------------------------------------------------------
# OS / identity discovery  (distro-agnostic)
# ---------------------------------------------------------------------------
detect_os() {
  OS_HOSTNAME="$(trim "$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)")"
  OS_DISTRO=""
  OS_DISTRO_VERSION=""

  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release 2>/dev/null || true
    OS_DISTRO="${NAME:-${ID:-}}"
    OS_DISTRO_VERSION="${VERSION_ID:-${VERSION:-}}"
  fi
  # Fallbacks for exotic / minimal systems
  if [ -z "$OS_DISTRO" ] && [ -r /etc/lsb-release ]; then
    OS_DISTRO="$(trim "$(awk -F= '/DISTRIB_ID/{print $2; exit}' /etc/lsb-release 2>/dev/null)")"
    OS_DISTRO_VERSION="$(trim "$(awk -F= '/DISTRIB_RELEASE/{print $2; exit}' /etc/lsb-release 2>/dev/null)")"
  fi
  if [ -z "$OS_DISTRO" ] && [ -r /etc/redhat-release ]; then
    OS_DISTRO="$(trim "$(cat /etc/redhat-release 2>/dev/null)")"
  fi
  [ -z "$OS_DISTRO" ] && OS_DISTRO="Linux"

  OS_KERNEL="$(trim "$(uname -r 2>/dev/null || echo unknown)")"
  OS_ARCH="$(trim "$(uname -m 2>/dev/null || echo unknown)")"

  # Primary IP: hostname -I when available, else parse `ip`, else ifconfig.
  OS_IP=""
  if have hostname; then
    OS_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$OS_IP" ] && have ip; then
    OS_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  if [ -z "$OS_IP" ] && have ifconfig; then
    OS_IP="$(ifconfig 2>/dev/null | awk '/inet /{print $2; exit}' | tr -d 'addr:')"
  fi
  [ -z "$OS_IP" ] && OS_IP="127.0.0.1"
}

# ---------------------------------------------------------------------------
# CPU — sample /proc/stat twice and compute busy percentage
# ---------------------------------------------------------------------------
read_cpu() {
  local idle total
  idle="$(awk '/^cpu /{idle=$5; total=0; for(i=2;i<=NF;i++) total+=$i; print idle, total; exit}' /proc/stat 2>/dev/null)"
  printf '%s\n' "$idle"
}

collect_cpu_percent() {
  if [ ! -r /proc/stat ]; then printf '0'; return; fi

  local s1 s2 idle1 total1 idle2 total2 d_idle d_total pct
  s1="$(read_cpu)"; idle1="${s1%% *}"; total1="${s1##* }"
  sleep 1
  s2="$(read_cpu)"; idle2="${s2%% *}"; total2="${s2##* }"

  idle1="$(num_or_zero "$idle1")"; total1="$(num_or_zero "$total1")"
  idle2="$(num_or_zero "$idle2")"; total2="$(num_or_zero "$total2")"

  d_idle=$(( idle2 - idle1 ))
  d_total=$(( total2 - total1 ))
  if [ "$d_total" -le 0 ]; then printf '0'; return; fi

  pct="$(awk -v i="$d_idle" -v t="$d_total" 'BEGIN { printf "%.1f", (1 - i / t) * 100 }')"
  printf '%s' "$pct"
}

# ---------------------------------------------------------------------------
# Memory — /proc/meminfo, with a fallback when MemAvailable is missing
# ---------------------------------------------------------------------------
collect_memory() {
  local total_kb avail_kb free_kb buffers_kb cached_kb used_kb pct
  if [ -r /proc/meminfo ]; then
    total_kb="$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo)"
    avail_kb="$(awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo)"
    if [ -z "$avail_kb" ]; then
      # Older kernels: approximate available = free + buffers + cached
      free_kb="$(awk '/^MemFree:/{print $2; exit}' /proc/meminfo)"
      buffers_kb="$(awk '/^Buffers:/{print $2; exit}' /proc/meminfo)"
      cached_kb="$(awk '/^Cached:/{print $2; exit}' /proc/meminfo)"
      avail_kb=$(( $(num_or_zero "$free_kb") + $(num_or_zero "$buffers_kb") + $(num_or_zero "$cached_kb") ))
    fi
  elif have free; then
    total_kb="$(free -k 2>/dev/null | awk '/^Mem:/{print $2; exit}')"
    avail_kb="$(free -k 2>/dev/null | awk '/^Mem:/{print $7; exit}')"
  fi

  total_kb="$(num_or_zero "${total_kb:-0}")"
  avail_kb="$(num_or_zero "${avail_kb:-0}")"
  [ "$total_kb" -le 0 ] && { MEM_PERCENT="0"; MEM_USED_MB="0"; MEM_TOTAL_MB="0"; return; }

  used_kb=$(( total_kb - avail_kb ))
  [ "$used_kb" -lt 0 ] && used_kb=0

  MEM_TOTAL_MB="$(( total_kb / 1024 ))"
  MEM_USED_MB="$(( used_kb / 1024 ))"
  MEM_PERCENT="$(awk -v t="$total_kb" -v u="$used_kb" 'BEGIN { printf "%.1f", (u / t) * 100 }')"
}

# ---------------------------------------------------------------------------
# Disk — usage of the root filesystem (portable POSIX df output)
# ---------------------------------------------------------------------------
collect_disk() {
  local line total_kb used_kb
  # -P ensures POSIX single-line output; -k forces 1024-byte blocks.
  line="$(df -Pk / 2>/dev/null | awk 'NR==2{print $2" "$3}')"
  total_kb="${line%% *}"
  used_kb="${line##* }"

  total_kb="$(num_or_zero "$total_kb")"
  used_kb="$(num_or_zero "$used_kb")"
  [ "$total_kb" -le 0 ] && { DISK_PERCENT="0"; DISK_USED_GB="0"; DISK_TOTAL_GB="0"; return; }

  DISK_TOTAL_GB="$(kb_to_gb "$total_kb")"
  DISK_USED_GB="$(kb_to_gb "$used_kb")"
  DISK_PERCENT="$(awk -v t="$total_kb" -v u="$used_kb" 'BEGIN { printf "%.1f", (u / t) * 100 }')"
}

# ---------------------------------------------------------------------------
# Load average / uptime / processes
# ---------------------------------------------------------------------------
collect_load() {
  LOAD_1="0"; LOAD_5="0"; LOAD_15="0"
  if [ -r /proc/loadavg ]; then
    read -r LOAD_1 LOAD_5 LOAD_15 _ < /proc/loadavg || true
  elif have uptime; then
    local raw
    raw="$(uptime 2>/dev/null | sed 's/.*load average[s]*: *//')"
    LOAD_1="$(trim "$(printf '%s' "$raw" | cut -d, -f1)")"
    LOAD_5="$(trim "$(printf '%s' "$raw" | cut -d, -f2)")"
    LOAD_15="$(trim "$(printf '%s' "$raw" | cut -d, -f3)")"
  fi
  LOAD_1="$(num_or_zero "$LOAD_1")"
  LOAD_5="$(num_or_zero "$LOAD_5")"
  LOAD_15="$(num_or_zero "$LOAD_15")"
}

collect_uptime() {
  UPTIME_SECONDS="0"
  if [ -r /proc/uptime ]; then
    UPTIME_SECONDS="$(awk '{printf "%d", $1; exit}' /proc/uptime 2>/dev/null)"
  elif have uptime; then
    # Fall back to `uptime -s` (start time) when available
    if uptime -s >/dev/null 2>&1; then
      local start
      start="$(date -d "$(uptime -s)" +%s 2>/dev/null)"
      [ -n "$start" ] && UPTIME_SECONDS=$(( $(date +%s) - start ))
    fi
  fi
  UPTIME_SECONDS="$(num_or_zero "$UPTIME_SECONDS")"
}

collect_process_count() {
  PROCESS_COUNT="0"
  # Count numeric entries under /proc — works on every Linux distro.
  PROCESS_COUNT="$(ls -d /proc/[0-9]* 2>/dev/null | wc -l | tr -d ' ')"
  PROCESS_COUNT="$(num_or_zero "$PROCESS_COUNT")"
}

# ---------------------------------------------------------------------------
# Aggregate everything into the payload
# ---------------------------------------------------------------------------
collect_all() {
  detect_os
  CPU_PERCENT="$(collect_cpu_percent)"
  collect_memory
  collect_disk
  collect_load
  collect_uptime
  collect_process_count
}

build_os_json() {
  printf '{"hostname":"%s","distro":"%s","distroVersion":"%s","kernel":"%s","arch":"%s","ipAddress":"%s"}' \
    "$(json_escape "$OS_HOSTNAME")" \
    "$(json_escape "$OS_DISTRO")" \
    "$(json_escape "$OS_DISTRO_VERSION")" \
    "$(json_escape "$OS_KERNEL")" \
    "$(json_escape "$OS_ARCH")" \
    "$(json_escape "$OS_IP")"
}

build_report_json() {
  printf '{"metrics":{"cpuPercent":%s,"memoryPercent":%s,"memoryUsedMb":%s,"memoryTotalMb":%s,"diskPercent":%s,"diskUsedGb":%s,"diskTotalGb":%s,"loadAverage":[%s,%s,%s],"uptimeSeconds":%s,"processCount":%s},"osInfo":%s,"message":"%s"}' \
    "$(num_or_zero "$CPU_PERCENT")" \
    "$(num_or_zero "$MEM_PERCENT")" \
    "$(num_or_zero "$MEM_USED_MB")" \
    "$(num_or_zero "$MEM_TOTAL_MB")" \
    "$(num_or_zero "$DISK_PERCENT")" \
    "$(num_or_zero "$DISK_USED_GB")" \
    "$(num_or_zero "$DISK_TOTAL_GB")" \
    "$(num_or_zero "$LOAD_1")" \
    "$(num_or_zero "$LOAD_5")" \
    "$(num_or_zero "$LOAD_15")" \
    "$(num_or_zero "$UPTIME_SECONDS")" \
    "$(num_or_zero "$PROCESS_COUNT")" \
    "$(build_os_json)" \
    "$(json_escape "${UPTIME_MESSAGE:-}")"
}

# ---------------------------------------------------------------------------
# HTTP transport
# ---------------------------------------------------------------------------
api_base() {
  local url="${UPTIME_SERVER_URL%/}"
  # If the URL already ends with /api, don't duplicate it.
  case "$url" in
    */api) printf '%s' "$url" ;;
    *)     printf '%s/api' "$url" ;;
  esac
}

send_report() {
  local payload="$1"
  if ! have curl; then error "curl tidak ditemukan — tidak dapat mengirim data."; return 1; fi
  if [ -z "$UPTIME_SERVER_URL" ] || [ -z "$UPTIME_AGENT_TOKEN" ]; then
    error "UPTIME_SERVER_URL / UPTIME_AGENT_TOKEN belum diisi."; return 1
  fi

  local resp code
  resp="$(curl -sS -m "$HTTP_TIMEOUT" -w '\n%{http_code}' \
    -X POST "$(api_base)/agents/report" \
    -H "Content-Type: application/json" \
    -H "x-agent-token: ${UPTIME_AGENT_TOKEN}" \
    --data-binary "$payload" 2>&1)" || { error "Gagal menghubungi server: $resp"; return 1; }

  code="$(printf '%s' "$resp" | tail -n1)"
  case "$code" in
    2*) log "Report terkirim (HTTP $code)." ; return 0 ;;
    401|403) error "Token agent ditolak (HTTP $code). Periksa UPTIME_AGENT_TOKEN." ; return 1 ;;
    *) error "Server membalas HTTP $code: $(printf '%s' "$resp" | sed '$d' | tr -d '\n')" ; return 1 ;;
  esac
}

send_log() {
  local level="$1" source="$2" message="$3"
  have curl || return 1
  [ -z "$UPTIME_SERVER_URL" ] || [ -z "$UPTIME_AGENT_TOKEN" ] && return 1

  message="$(printf '%s' "$message" | cut -c1-"$LOG_MAX_BYTES")"
  local payload
  payload="$(printf '{"level":"%s","source":"%s","message":"%s","loggedAt":"%s"}' \
    "$(json_escape "$level")" \
    "$(json_escape "$source")" \
    "$(json_escape "$message")" \
    "$(ts)")"

  curl -sS -m "$HTTP_TIMEOUT" -o /dev/null \
    -X POST "$(api_base)/agents/logs" \
    -H "Content-Type: application/json" \
    -H "x-agent-token: ${UPTIME_AGENT_TOKEN}" \
    --data-binary "$payload" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
run_once() {
  collect_all
  local payload; payload="$(build_report_json)"
  send_report "$payload"
}

run_print() {
  collect_all
  build_report_json
  printf '\n'
}

run_selftest() {
  collect_all
  cat >&2 <<EOF
${SCRIPT_NAME} self-test
  hostname ....... ${OS_HOSTNAME}
  distro ......... ${OS_DISTRO} ${OS_DISTRO_VERSION}
  kernel/arch .... ${OS_KERNEL} / ${OS_ARCH}
  ip address ..... ${OS_IP}
  cpu ............ ${CPU_PERCENT}%
  memory ......... ${MEM_PERCENT}%  (${MEM_USED_MB}/${MEM_TOTAL_MB} MB)
  disk ........... ${DISK_PERCENT}%  (${DISK_USED_GB}/${DISK_TOTAL_GB} GB)
  load (1/5/15) .. ${LOAD_1} ${LOAD_5} ${LOAD_15}
  uptime ......... ${UPTIME_SECONDS}s
  processes ...... ${PROCESS_COUNT}
  server url ..... ${UPTIME_SERVER_URL:-<unset>}
  token .......... ${UPTIME_AGENT_TOKEN:+set}${UPTIME_AGENT_TOKEN:-<unset>}
  interval ....... ${UPTIME_INTERVAL}s
EOF
}

run_loop() {
  log "Agent dimulai — interval ${UPTIME_INTERVAL}s, server ${UPTIME_SERVER_URL:-<unset>}."

  local failures=0
  while true; do
    if run_once; then
      failures=0
    else
      failures=$(( failures + 1 ))
      # Escalate long-running connectivity problems to the log stream so the
      # dashboard surfaces them (the API/engine already raise disconnect + threshold
      # incidents on the server side).
      if [ "$UPTIME_SEND_LOGS" = "true" ] && [ "$failures" -ge 3 ]; then
        send_log "error" "agent" "Agent gagal mengirim report sebanyak ${failures}x berturut-turut."
      fi
    fi
    sleep "$UPTIME_INTERVAL"
  done
}

usage() {
  cat >&2 <<EOF
${SCRIPT_NAME} — Uptime Monitor agent collector

Usage: $(basename "$0") [--once|--print|--selftest|--help]

  --once       collect and send a single report, then exit
  --print      collect and print the JSON payload without sending
  --selftest   gather metrics and print a human-readable summary
  --help       show this help

Environment / config ($CONF_FILE):
  UPTIME_SERVER_URL   e.g. https://uptime.example.com
  UPTIME_AGENT_TOKEN  the agt_... token shown when creating the agent
  UPTIME_INTERVAL     seconds between reports (default 60)
  UPTIME_SEND_LOGS    "true" to also push connection-failure logs
EOF
}

main() {
  case "${1:---loop}" in
    --once)     run_once ;;
    --print)    run_print ;;
    --selftest) run_selftest ;;
    --loop|"")  run_loop ;;
    --help|-h)  usage ;;
    *) error "Opsi tidak dikenal: $1"; usage; exit 2 ;;
  esac
}

main "$@"