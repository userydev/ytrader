#!/usr/bin/env bash
# Foreground, single-port candidate. Run: bash scripts/run-phase1.sh
# Ctrl-C stops this instance; no other process is stopped or reconfigured.
set -euo pipefail
if [[ $# -ne 0 ]]; then
  printf '%s\n' 'Usage: bash scripts/run-phase1.sh (fixed isolated paths and port; no arguments)' >&2
  exit 2
fi
REPO="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPO
readonly PORT=58730
readonly ROOT="$REPO/.local/phase1-20261020"
readonly DATA="$ROOT/data"
readonly WEB="$ROOT/web-dist"
readonly PY="$REPO/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  printf 'Missing repository Python environment. Install first:\n  python3 -m venv "%s/.venv"\n  "%s" -m pip install -e "%s"\n' "$REPO" "$PY" "$REPO" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Missing Node.js/npm. Install Node.js (Vite 6 requires Node 18+), then run npm ci in frontend.' >&2
  exit 1
fi
if [[ ! -f "$REPO/frontend/node_modules/vite/package.json" || ! -f "$REPO/frontend/node_modules/typescript/package.json" ]]; then
  printf 'Missing frontend dependencies. Install first:\n  cd "%s/frontend" && npm ci\n' "$REPO" >&2
  exit 1
fi
# No inherited ycore, model, NEWS_ONLY, VITE or YTRADER environment switches.
# npm uses an isolated cache and no user/global configuration; never auto-install.
clean_env() {
  env -i HOME="${HOME:?HOME is required}" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" \
    PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
    YTRADER_CHAIN_REFERENCE_DIR="${YTRADER_CHAIN_REFERENCE_DIR:-}" \
    npm_config_cache="$ROOT/npm-cache" npm_config_userconfig=/dev/null \
    npm_config_globalconfig="$ROOT/npm-globalrc" npm_config_offline=true npm_config_yes=false \
    "$@"
}
check_paths_and_port() {
  clean_env "$PY" - "$REPO" "$PORT" <<'PY'
import importlib
import os
from pathlib import Path
import socket
import sys

repo = Path(sys.argv[1])
port = int(sys.argv[2])
root = repo / '.local' / 'phase1-20261020'
protected = tuple(path.resolve() for path in (repo / '.local' / 'runtime-v1', Path.home() / '.local' / 'share' / 'ytrader'))

def fail(message):
    raise SystemExit('Phase 1 refused: ' + message)

def protected_path(path):
    if any(path == item or item in path.parents for item in protected):
        return True
    parts = path.parts
    return (any(name in parts for name in ('ytrader-editorial-radar', 'ytrader-news-radar'))
            or any(parts[i:i + 2] == ('.local', 'runtime-v1') for i in range(len(parts) - 1)))

# Check before mkdir and again after the build, before starting the application.
# Vite alone empties web-dist; there is no rm command or caller-supplied path.
paths = (repo / '.local', root, root / 'data', root / 'web-dist', root / 'npm-cache')
for path in paths:
    if path.is_symlink() or path.resolve() != path:
        fail('isolation paths must not contain symlinks: ' + str(path))
    if protected_path(path.resolve()):
        fail('protected directory: ' + str(path))
    if path.exists() and not path.is_dir():
        fail('expected a directory: ' + str(path))
if root.exists():
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            if (Path(directory) / name).is_symlink():
                fail('symlink inside the dedicated isolation directory')
if port != 58730 or port in (8000, 58700, 58720, 58721):
    fail('only port 58730 is permitted')
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
    # Match uvicorn's bind behavior after a clean shutdown (TCP TIME_WAIT).
    # A live listener still prevents binding; no SO_REUSEPORT is enabled.
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(('127.0.0.1', port))
    except OSError:
        fail('port 58730 is occupied or unavailable; no process was stopped')
for module in ('fastapi', 'uvicorn', 'httpx', 'pydantic', 'defusedxml', 'openpyxl'):
    try:
        importlib.import_module(module)
    except ImportError:
        fail('missing Python dependencies (' + module + '). Install with: "' + str(repo / '.venv/bin/python') + '" -m pip install -e "' + str(repo) + '"')
for path in paths:
    path.mkdir(exist_ok=True)
PY
}
check_paths_and_port
(
  cd "$REPO/frontend"
  clean_env npm exec -- tsc --noEmit -p "$REPO/frontend/tsconfig.json"
  clean_env npm exec -- vite build --outDir "$WEB" --emptyOutDir
)
check_paths_and_port
printf 'Phase 1: http://127.0.0.1:%s\nData: %s\nWeb: %s\nForeground instance; Ctrl-C to stop.\n' "$PORT" "$DATA" "$WEB"
cd "$REPO"
# Explicit absolute paths; no shared config, remote overrides, or NEWS_ONLY mode.
exec env -i HOME="$HOME" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" \
  PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
  YTRADER_DATA_DIR="$DATA" YTRADER_WEB_DIST="$WEB" YTRADER_EDITORIAL=1 \
  YTRADER_CHAIN_REFERENCE_DIR="${YTRADER_CHAIN_REFERENCE_DIR:-}" \
  YTRADER_WEB_ORIGINS="http://127.0.0.1:$PORT" \
  "$PY" -m uvicorn backend.app:app --host 127.0.0.1 --port "$PORT"
