#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.easy_exam_runtime"
LOG_DIR="$RUNTIME_DIR/logs"

mkdir -p "$LOG_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  . "$ROOT_DIR/.env"
  set +a
fi

DEFAULT_CODEX_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"

: "${PORT:=8765}"
: "${CODEX_PYTHON:=$DEFAULT_CODEX_RUNTIME/python/bin/python3}"

export PORT
export CODEX_PYTHON
export NODE_ENV=production

DEFAULT_CODEX_NODE="$DEFAULT_CODEX_RUNTIME/node/bin/node"
if [ -z "${CODEX_NODE:-}" ] || [ ! -x "$CODEX_NODE" ]; then
  CODEX_NODE="$DEFAULT_CODEX_NODE"
fi

export CODEX_NODE

exec "$CODEX_NODE" "$ROOT_DIR/server/easy_exam_server.mjs"
