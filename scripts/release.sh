#!/usr/bin/env bash
#
# Release a new version of @sankpia/fact-mcp.
#
# Bumps the version, builds the bundle, packs a tarball, installs it globally,
# and points Factory at the installed command. Safe to run repeatedly.
#
#   ./scripts/release.sh patch      # 0.1.0 -> 0.1.1
#   ./scripts/release.sh minor      # 0.1.0 -> 0.2.0
#   ./scripts/release.sh major      # 0.1.0 -> 1.0.0
#   ./scripts/release.sh 0.2.3      # explicit version
#   ./scripts/release.sh --no-install patch   # build and pack only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTALL=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
  --no-install) INSTALL=0 ;;
  -h | --help)
    sed -n '3,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) ARGS+=("$arg") ;;
  esac
done

BUMP="${ARGS[0]:-patch}"

command -v bun >/dev/null || {
  echo "error: bun is required to build" >&2
  exit 1
}
command -v npm >/dev/null || {
  echo "error: npm is required to install" >&2
  exit 1
}

echo "==> typecheck"
bunx tsc --noEmit

echo "==> bump version ($BUMP)"
npm version "$BUMP" --no-git-tag-version >/dev/null
VERSION="$(node -p "require('./package.json').version")"
echo "    version is now $VERSION"

echo "==> build"
rm -rf dist
npm run build >/dev/null
[ -f dist/index.js ] || {
  echo "error: build produced no dist/index.js" >&2
  exit 1
}
printf '    dist/index.js  %s  %s\n' \
  "$(du -h dist/index.js | cut -f1)" \
  "$(head -1 dist/index.js)"

echo "==> pack"
rm -f ./*.tgz
# npm prints build output to stdout here; the tarball name is deterministic.
npm pack >/dev/null 2>&1
TARBALL="$(ls -1 ./*.tgz | head -1)"
[ -f "$TARBALL" ] || {
  echo "error: npm pack produced no tarball" >&2
  exit 1
}
echo "    $TARBALL  $(du -h "$TARBALL" | cut -f1)"

if [ "$INSTALL" -eq 0 ]; then
  echo
  echo "Built $VERSION without installing. Install with:"
  echo "  npm install -g ./$TARBALL"
  exit 0
fi

echo "==> install globally"
npm uninstall -g @sankpia/fact-mcp >/dev/null 2>&1 || true
npm install -g "./$TARBALL" 2>&1 | tail -2

echo "==> verify"
BIN="$(command -v fact-mcp || true)"
[ -n "$BIN" ] || {
  echo "error: fact-mcp not on PATH after install" >&2
  exit 1
}
printf '    %s -> %s\n' "$BIN" "$(readlink "$BIN" 2>/dev/null || echo "$BIN")"

echo "==> point Factory at the installed command"
node - "$BIN" <<'NODE'
const fs = require('fs');
const path = require('path');
const bin = process.argv[2];
const file = path.join(process.env.HOME, '.factory', 'mcp.json');
if (!fs.existsSync(file)) {
  console.log('    no ~/.factory/mcp.json, skipped');
  process.exit(0);
}
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const entry = cfg.mcpServers?.fact;
if (!entry) {
  console.log('    no "fact" server configured, skipped');
  process.exit(0);
}
entry.command = bin;
entry.args = [];
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('    mcp.json fact.command -> ' + bin);
NODE

echo
echo "Released fact-mcp $VERSION"
echo "Restart the MCP server in Factory (or reopen the session) to pick it up."
