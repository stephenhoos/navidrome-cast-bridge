#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT/plugin"
OUT_DIR="$ROOT/dist"
WASM_FILE="$PLUGIN_DIR/plugin.wasm"
NDP_FILE="$OUT_DIR/navidrome-cast-bridge.ndp"

mkdir -p "$OUT_DIR"

if command -v tinygo >/dev/null 2>&1; then
  (cd "$PLUGIN_DIR" && tinygo build -opt=2 -scheduler=none -no-debug -o "$WASM_FILE" -target wasip1 -buildmode=c-shared .)
elif command -v go >/dev/null 2>&1; then
  (cd "$PLUGIN_DIR" && GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o "$WASM_FILE" .)
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$ROOT:/work" -w /work/plugin golang:1.25-bookworm sh -lc 'GOOS=wasip1 GOARCH=wasm /usr/local/go/bin/go build -buildmode=c-shared -o plugin.wasm .'
else
  echo "Need tinygo, go, or docker to build the plugin." >&2
  exit 1
fi

(cd "$PLUGIN_DIR" && zip -q -j "$NDP_FILE" plugin.wasm manifest.json)
echo "$NDP_FILE"
