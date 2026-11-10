#!/usr/bin/env bash
#
# Deploy fact-proxy to a remote host and restart its service.
#
# The remote layout mirrors this repository, so the relative import from
# server/proxy.ts to src/orchestrator.ts resolves the same on both sides:
#
#   /opt/fact-mcp/server/proxy.ts
#   /opt/fact-mcp/src/orchestrator.ts
#
# Safe to run repeatedly: it checks syntax before uploading, verifies the
# checksum after, and rolls back if the service does not come up.
#
#   ./scripts/deploy-server.sh                # uses the host in FACT_HOST
#   ./scripts/deploy-server.sh myhost         # another ssh host
#   FACT_HOST=myhost ./scripts/deploy-server.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST="${1:-${FACT_HOST:?set FACT_HOST to your ssh host}}"
REMOTE_DIR="${REMOTE_DIR:-/opt/fact-mcp}"
SERVICE="${SERVICE:-fact-mcp}"
OWNER="${OWNER:-root:factproxy}"
BUN_BIN="${BUN_BIN:-/usr/local/lib/fact-mcp/bun}"

FILES=(server/proxy.ts src/orchestrator.ts)

for f in "${FILES[@]}"; do
	[ -f "$f" ] || {
		echo "error: $f not found" >&2
		exit 1
	}
done

echo "==> syntax check"
# A checksum only proves the bytes arrived; it says nothing about whether the
# file parses. Refuse to ship something that cannot start.
if ! bun build server/proxy.ts --target bun --outdir /tmp/fact-syntax-check >/dev/null 2>&1; then
	echo "error: server/proxy.ts does not parse" >&2
	bun build server/proxy.ts --target bun --outdir /tmp/fact-syntax-check 2>&1 | tail -20 >&2
	rm -rf /tmp/fact-syntax-check
	exit 1
fi
rm -rf /tmp/fact-syntax-check
echo "    parses"

SUMS=""
for f in "${FILES[@]}"; do
	SUMS+="$(shasum -a 256 "$f" | awk '{print $1}')  $f"$'\n'
done
echo "==> checksums"
echo "$SUMS" | sed 's/^/    /'

echo "==> upload to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p $REMOTE_DIR/server $REMOTE_DIR/src"
for f in "${FILES[@]}"; do
	# Write to a temp path first so a dropped connection never leaves a broken file.
	ssh "$HOST" "cat > $REMOTE_DIR/$f.new" <"$f"
done

echo "==> verify and activate"
ssh "$HOST" "bash -s" <<REMOTE
set -euo pipefail

while read -r sum path; do
  [ -n "\$sum" ] || continue
  actual=\$(sha256sum "$REMOTE_DIR/\$path.new" | cut -d' ' -f1)
  if [ "\$actual" != "\$sum" ]; then
    echo "    checksum mismatch for \$path: \$actual" >&2
    rm -f "$REMOTE_DIR"/*.new "$REMOTE_DIR"/*/*.new
    exit 1
  fi
done <<'SUMS'
$SUMS
SUMS

# Keep the previous files so a bad deploy can be undone.
for path in ${FILES[*]}; do
  [ -f "$REMOTE_DIR/\$path" ] && cp -a "$REMOTE_DIR/\$path" "$REMOTE_DIR/\$path.prev"
  mv "$REMOTE_DIR/\$path.new" "$REMOTE_DIR/\$path"
done
chown -R $OWNER "$REMOTE_DIR"
chmod 640 $REMOTE_DIR/server/proxy.ts $REMOTE_DIR/src/orchestrator.ts

systemctl restart $SERVICE
sleep 4

rollback() {
  echo "    rolling back" >&2
  for path in ${FILES[*]}; do
    [ -f "$REMOTE_DIR/\$path.prev" ] && mv "$REMOTE_DIR/\$path.prev" "$REMOTE_DIR/\$path"
  done
  chown -R $OWNER "$REMOTE_DIR"
  systemctl restart $SERVICE
  sleep 3
}

if ! systemctl is-active --quiet $SERVICE; then
  echo "    service failed to start" >&2
  journalctl -u $SERVICE -n 15 --no-pager | tail -15 >&2
  rollback
  exit 1
fi

if ! curl -fsS --max-time 8 http://127.0.0.1:8787/health >/dev/null; then
  echo "    health check failed" >&2
  rollback
  exit 1
fi

echo "    active"
curl -fsS --max-time 8 http://127.0.0.1:8787/health
echo
REMOTE

echo
echo "Deployed ${FILES[*]} to $HOST ($SERVICE restarted)"
