#!/usr/bin/env bash
set -euo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PYTHON_BIN="${HERMES_PYTHON:-}"

if [[ -z "$PYTHON_BIN" && -x "$HERMES_HOME/hermes-agent/venv/bin/python3" ]]; then
  PYTHON_BIN="$HERMES_HOME/hermes-agent/venv/bin/python3"
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
"$PYTHON_BIN" quote_query.py "$@"
