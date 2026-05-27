#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${TRAFFIC_AGENT_CONFIG:-/etc/traffic-usage-agent/config}"
AGENT_VERSION="0.1.0"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" >&2
}

load_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    log "Missing config file: $CONFIG_FILE"
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  SERVER_URL="${SERVER_URL%/}"
}

save_config_value() {
  local key="$1"
  local value="$2"
  python3 - "$CONFIG_FILE" "$key" "$value" <<'PY'
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text().splitlines() if path.exists() else []
rendered = f"{key}={shlex.quote(value)}"
for index, line in enumerate(lines):
    if line.startswith(key + "="):
        lines[index] = rendered
        break
else:
    lines.append(rendered)
path.write_text("\n".join(lines) + "\n")
PY
}

valid_ip() {
  python3 - "$1" <<'PY'
import ipaddress
import sys

try:
    ipaddress.ip_address(sys.argv[1].strip())
except ValueError:
    sys.exit(1)
PY
}

detect_public_ip() {
  local endpoint value
  for endpoint in \
    "https://ifconfig.info" \
    "https://api.ipify.org" \
    "https://ifconfig.me/ip" \
    "https://icanhazip.com"; do
    value="$(curl -fsS --max-time 5 "$endpoint" 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -n "$value" ] && valid_ip "$value"; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}

build_join_payload() {
  HOST_ALIAS="${HOST_ALIAS:-}" AGENT_VERSION="$AGENT_VERSION" PUBLIC_IP="${PUBLIC_IP:-}" python3 - <<'PY'
import json
import os
import platform
import socket

interfaces = []
try:
    with open('/proc/net/dev', 'r', encoding='utf-8') as handle:
        for line in handle.readlines()[2:]:
            if ':' not in line:
                continue
            name = line.split(':', 1)[0].strip()
            if not name or name == 'lo':
                continue
            interfaces.append(name)
except FileNotFoundError:
    pass

machine_id = socket.gethostname()
for candidate in ('/etc/machine-id', '/var/lib/dbus/machine-id'):
    if os.path.exists(candidate):
        with open(candidate, encoding='utf-8') as handle:
            machine_id = handle.read().strip()
        break

boot_id = None
if os.path.exists('/proc/sys/kernel/random/boot_id'):
    with open('/proc/sys/kernel/random/boot_id', encoding='utf-8') as handle:
        boot_id = handle.read().strip()

payload = {
    "hostname": socket.gethostname(),
    "name": os.environ.get("HOST_ALIAS") or None,
    "machineId": machine_id,
    "bootId": boot_id,
    "publicIp": os.environ.get("PUBLIC_IP") or None,
    "kernel": platform.release(),
    "agentVersion": os.environ.get("AGENT_VERSION"),
    "interfaces": interfaces,
}
print(json.dumps(payload, separators=(",", ":")))
PY
}

parse_json_field() {
  local field="$1"
  python3 -c 'import json,sys; data=json.load(sys.stdin); value=data.get(sys.argv[1], ""); print("" if value is None else value)' "$field"
}

join_agent() {
  load_config
  if [ -z "${SERVER_URL:-}" ] || [ -z "${JOIN_TOKEN:-}" ]; then
    log "SERVER_URL and JOIN_TOKEN are required in $CONFIG_FILE"
    exit 1
  fi

  local payload response agent_id agent_key poll_interval public_ip
  public_ip="$(detect_public_ip || true)"
  payload="$(PUBLIC_IP="$public_ip" build_join_payload)"
  response="$(curl -fsS -X POST "$SERVER_URL/api/agent/join" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $JOIN_TOKEN" \
    --data-binary "$payload")"

  agent_id="$(printf '%s' "$response" | parse_json_field agentId)"
  agent_key="$(printf '%s' "$response" | parse_json_field agentKey)"
  poll_interval="$(printf '%s' "$response" | parse_json_field pollIntervalSeconds)"

  if [ -z "$agent_id" ] || [ -z "$agent_key" ]; then
    log "Join response did not contain agent credentials: $response"
    exit 1
  fi

  save_config_value AGENT_ID "$agent_id"
  save_config_value AGENT_KEY "$agent_key"
  if [ -n "$poll_interval" ]; then
    save_config_value POLL_INTERVAL_SECONDS "$poll_interval"
  fi
  chmod 600 "$CONFIG_FILE"
  log "Joined central server as agent $agent_id"
}

build_report_payload() {
  AGENT_VERSION="$AGENT_VERSION" PUBLIC_IP="${PUBLIC_IP:-}" python3 - <<'PY'
import json
import os
import platform
import socket
from datetime import datetime, timezone

interfaces = []
with open('/proc/net/dev', 'r', encoding='utf-8') as handle:
    for line in handle.readlines()[2:]:
        if ':' not in line:
            continue
        name, raw = line.split(':', 1)
        name = name.strip()
        if not name or name == 'lo':
            continue
        fields = raw.split()
        if len(fields) < 16:
            continue
        interfaces.append({
            "name": name,
            "rxBytes": fields[0],
            "txBytes": fields[8],
        })

machine_id = socket.gethostname()
for candidate in ('/etc/machine-id', '/var/lib/dbus/machine-id'):
    if os.path.exists(candidate):
        with open(candidate, encoding='utf-8') as handle:
            machine_id = handle.read().strip()
        break

boot_id = None
if os.path.exists('/proc/sys/kernel/random/boot_id'):
    with open('/proc/sys/kernel/random/boot_id', encoding='utf-8') as handle:
        boot_id = handle.read().strip()

payload = {
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "host": {
        "hostname": socket.gethostname(),
        "machineId": machine_id,
        "bootId": boot_id,
        "publicIp": os.environ.get("PUBLIC_IP") or None,
        "kernel": platform.release(),
        "agentVersion": os.environ.get("AGENT_VERSION"),
    },
    "interfaces": interfaces,
}
print(json.dumps(payload, separators=(",", ":")))
PY
}

report_once() {
  load_config
  if [ -z "${AGENT_ID:-}" ] || [ -z "${AGENT_KEY:-}" ]; then
    join_agent
    load_config
  fi

  local payload response poll_interval public_ip
  public_ip="$(detect_public_ip || true)"
  payload="$(PUBLIC_IP="$public_ip" build_report_payload)"
  response="$(curl -fsS -X POST "$SERVER_URL/api/agent/report" \
    -H 'Content-Type: application/json' \
    -H "X-Agent-Id: $AGENT_ID" \
    -H "Authorization: Bearer $AGENT_KEY" \
    --data-binary "$payload")"

  poll_interval="$(printf '%s' "$response" | parse_json_field pollIntervalSeconds || true)"
  if [ -n "$poll_interval" ]; then
    save_config_value POLL_INTERVAL_SECONDS "$poll_interval"
  fi
}

run_forever() {
  load_config
  while true; do
    if ! "$0" report; then
      log "report failed; retrying after delay"
    fi
    load_config
    sleep "${POLL_INTERVAL_SECONDS:-60}"
  done
}

case "${1:-run}" in
  join)
    join_agent
    ;;
  report)
    report_once
    ;;
  run)
    run_forever
    ;;
  *)
    echo "Usage: $0 {join|report|run}" >&2
    exit 1
    ;;
esac
