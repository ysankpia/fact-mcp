#!/usr/bin/env bash
#
# Provision the orchestrator on a fresh Linux host.
#
# Run this ON THE SERVER, as root, from a checkout of this repository:
#
#   sudo ./scripts/setup-server.sh
#
# It installs the code under /opt/fact-mcp, creates a dedicated service user,
# generates a bearer token, and installs a hardened systemd unit. Idempotent:
# re-running keeps the existing token and only updates what changed.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/server/proxy.ts"
ORCH="$ROOT/src/orchestrator.ts"

REMOTE_DIR="${REMOTE_DIR:-/opt/fact-mcp}"
SERVICE="${SERVICE:-fact-mcp}"
SERVICE_USER="${SERVICE_USER:-factproxy}"
ENV_FILE="${ENV_FILE:-/etc/fact-mcp.env}"
PORT="${PORT:-8787}"

[ "$(id -u)" -eq 0 ] || {
	echo "error: run as root" >&2
	exit 1
}
[ -f "$SRC" ] || {
	echo "error: $SRC not found; run from a checkout" >&2
	exit 1
}
[ -f "$ORCH" ] || {
	echo "error: $ORCH not found; run from a checkout" >&2
	exit 1
}
command -v bun >/dev/null || {
	echo "error: bun is required; install it first" >&2
	exit 1
}

echo "==> service user"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
	useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
	echo "    created $SERVICE_USER"
else
	echo "    $SERVICE_USER exists"
fi

echo "==> code"
# The remote layout mirrors the repository so the relative import from
# server/proxy.ts to src/orchestrator.ts resolves the same on both sides.
install -d -m 750 -o root -g "$SERVICE_USER" "$REMOTE_DIR/server" "$REMOTE_DIR/src"
install -m 640 -o root -g "$SERVICE_USER" "$SRC" "$REMOTE_DIR/server/proxy.ts"
install -m 640 -o root -g "$SERVICE_USER" "$ORCH" "$REMOTE_DIR/src/orchestrator.ts"

echo "==> token"
if [ ! -s "$REMOTE_DIR/token" ]; then
	umask 077
	openssl rand -hex 24 >"$REMOTE_DIR/token"
	chown root:"$SERVICE_USER" "$REMOTE_DIR/token"
	chmod 640 "$REMOTE_DIR/token"
	echo "    generated a new token"
else
	echo "    keeping the existing token"
fi

echo "==> environment file"
umask 077
{
	echo "FACT_PROXY_TOKEN=$(cat "$REMOTE_DIR/token")"
	echo "PORT=$PORT"
	# Optional: raises GitHub's search rate limit from 10 to 30 requests/min.
	[ -n "${GITHUB_TOKEN:-}" ] && echo "GITHUB_TOKEN=$GITHUB_TOKEN"
} >"$ENV_FILE"
chown root:"$SERVICE_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

echo "==> bun for the service user"
# A bun installed under /root is unreachable once ProtectHome is on, so the
# service gets its own copy outside the home directories.
BUN_REAL="$(readlink -f "$(command -v bun)")"
install -d -m 755 /usr/local/lib/fact-mcp
install -m 755 -o root -g root "$BUN_REAL" /usr/local/lib/fact-mcp/bun
echo "    $(/usr/local/lib/fact-mcp/bun --version) at /usr/local/lib/fact-mcp/bun"

echo "==> state directory"
install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "/var/lib/$SERVICE"

echo "==> systemd unit"
cat >"/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=$SERVICE — stateless Go documentation orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/lib/fact-mcp/bun $REMOTE_DIR/proxy.ts
Restart=always
RestartSec=3
MemoryMax=384M
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 3

echo "==> verify"
systemctl is-active "$SERVICE"
curl -fsS --max-time 8 "http://127.0.0.1:$PORT/health"
echo

echo
echo "Orchestrator is running on 127.0.0.1:$PORT"
echo
echo "Token (put this in your client's FACT_PROXY_TOKEN):"
cat "$REMOTE_DIR/token"
echo
echo "Next: expose it over HTTPS. Either a Cloudflare Tunnel ingress"
echo "  - hostname: fact.example.com"
echo "    service: http://127.0.0.1:$PORT"
echo "or a reverse proxy of your choice."
