#!/usr/bin/env bash
#
# Run a command over a flaky link, retrying transient failures.
#
# Long-lived connections through a tunnel or a lossy route drop often enough
# that a single attempt is a coin flip. This wraps an attempt in a bounded
# retry so a transient reset does not cost a whole round trip of debugging.
#
#   ./scripts/retry.sh ssh myhost 'systemctl is-active fact-mcp'
#   ./scripts/retry.sh --attempts 6 --delay 2 curl -fsS https://example.com
#
# Only failures that look transient are retried: connection resets, TLS
# handshake errors, timeouts, and HTTP 429/502/503/504. A command that fails
# for a real reason (non-zero exit with no transient marker) is reported on the
# first attempt, because retrying a broken command wastes time and hides the
# cause.
#
set -uo pipefail

ATTEMPTS=5
DELAY=3
VERBOSE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --attempts) ATTEMPTS="$2"; shift 2 ;;
    --delay)    DELAY="$2"; shift 2 ;;
    --verbose)  VERBOSE=1; shift ;;
    -h|--help)
      sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) break ;;
  esac
done

[ $# -gt 0 ] || { echo "error: no command given" >&2; exit 2; }

# Markers of a transient failure, in the order they usually appear.
TRANSIENT='Connection reset|kex_exchange_identification|Connection timed out|banner exchange|SSL_ERROR_SYSCALL|SSL_connect|TLS handshake|Operation timed out|Network is unreachable|Temporary failure in name resolution|HTTP (429|502|503|504)|Failed to connect to|timeout: no recent network activity'

attempt=1
while :; do
  out="$("$@" 2>&1)"
  status=$?

  if [ "$status" -eq 0 ] && ! printf '%s' "$out" | grep -qE "$TRANSIENT"; then
    printf '%s\n' "$out"
    exit 0
  fi

  if [ "$VERBOSE" -eq 1 ] || [ "$attempt" -ge "$ATTEMPTS" ]; then
    printf '%s\n' "$out" >&2
  fi

  if ! printf '%s' "$out" | grep -qE "$TRANSIENT"; then
    # A real failure, not a transient one: report it and stop.
    printf '%s\n' "$out"
    exit "$status"
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "retry: still failing after $ATTEMPTS attempts" >&2
    printf '%s\n' "$out" >&2
    exit "$status"
  fi

  echo "retry: attempt $attempt/$ATTEMPTS hit a transient failure, retrying in ${DELAY}s" >&2
  sleep "$DELAY"
  attempt=$((attempt + 1))
done
