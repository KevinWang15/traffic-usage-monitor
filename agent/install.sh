#!/usr/bin/env bash
set -euo pipefail

SERVER_URL=""
JOIN_TOKEN=""
HOST_ALIAS=""
INSTALL_DIR="/etc/traffic-usage-agent"
CONFIG_FILE="$INSTALL_DIR/config"
BIN_PATH="/usr/local/bin/traffic-usage-agent"
SERVICE_FILE="/etc/systemd/system/traffic-usage-agent.service"

usage() {
  cat <<'USAGE'
Usage: install.sh --server <central-server-url> --token <account-join-token> [--name <host-alias>]

Installs the Linux traffic usage agent as a systemd service. The agent reads
/proc/net/dev and reports raw counters to the central server; all allowance,
reset-cycle, metering, and alert decisions happen centrally.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --token|--key)
      JOIN_TOKEN="${2:-}"
      shift 2
      ;;
    --name)
      HOST_ALIAS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$SERVER_URL" ] || [ -z "$JOIN_TOKEN" ]; then
  usage >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run through sudo or as root." >&2
  exit 1
fi

for cmd in curl python3 awk sed grep; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

SERVER_URL="${SERVER_URL%/}"
mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"

curl -fsSL "$SERVER_URL/api/agent/traffic-agent.sh" -o "$BIN_PATH"
chmod 755 "$BIN_PATH"

python3 - "$CONFIG_FILE" "$SERVER_URL" "$JOIN_TOKEN" "$HOST_ALIAS" <<'PY'
import pathlib
import shlex
import sys

path = pathlib.Path(sys.argv[1])
server_url, join_token, host_alias = sys.argv[2], sys.argv[3], sys.argv[4]
content = "\n".join(
    [
        f"SERVER_URL={shlex.quote(server_url)}",
        f"JOIN_TOKEN={shlex.quote(join_token)}",
        f"HOST_ALIAS={shlex.quote(host_alias)}",
        "POLL_INTERVAL_SECONDS='60'",
        "",
    ]
)
path.write_text(content)
PY
chmod 600 "$CONFIG_FILE"

"$BIN_PATH" join

cat > "$SERVICE_FILE" <<'SERVICE'
[Unit]
Description=Traffic Usage Monitor Agent
Documentation=https://github.com/KevinWang15/bootstrap-new-app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/traffic-usage-agent/config
ExecStart=/usr/local/bin/traffic-usage-agent run
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now traffic-usage-agent.service

echo "Traffic usage agent installed and started."
echo "Config: $CONFIG_FILE"
echo "Service: systemctl status traffic-usage-agent.service"
