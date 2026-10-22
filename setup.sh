#!/bin/sh
# PiMatrix interactive setup launcher
command -v node >/dev/null 2>&1 || {
  echo "Error: Node.js is required to run the setup script." >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/scripts/setup.mjs" "$@"
