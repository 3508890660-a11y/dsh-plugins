#!/bin/bash
# shortnovel-workflow build: compile src/ -> lib/ with the dsh checkout's tsc.
# 兼容两种 DSH checkout 布局：
#   源码布局：CHECKOUT/packages/...（官方 monorepo）
#   安装布局：CHECKOUT/node_modules/@deepseek-ai/...（desktop checkout）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# DSH_CHECKOUT 探测：环境变量 -> 常见路径
CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/packages" ] || [ -d "$candidate/node_modules/@deepseek-ai" ]; then CHECKOUT="$candidate"; break; fi
  done
fi
if [ -z "$CHECKOUT" ] || { [ ! -d "$CHECKOUT/packages" ] && [ ! -d "$CHECKOUT/node_modules/@deepseek-ai" ]; }; then
  echo "build: cannot locate the dsh checkout (set DSH_CHECKOUT)" >&2
  exit 1
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  TSC="$ROOT/node_modules/.bin/tsc"
fi
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then
  echo "build: tsc not found (checkout or local node_modules)" >&2
  exit 1
fi

if [ -d "$CHECKOUT/packages" ]; then
  SRC_LAYOUT=1
else
  SRC_LAYOUT=0
fi

pkg_path() {
  if [ "$SRC_LAYOUT" = "1" ] && [ -n "$2" ] && [ -d "$CHECKOUT/$2" ]; then
    echo "$2"
  else
    echo "node_modules/$1"
  fi
}

link_pkg() {
  local target="$CHECKOUT/$(pkg_path "$1" "$2")"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "node_modules/$1" "$target"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT, layout: $([ "$SRC_LAYOUT" = "1" ] && echo src || echo installed)) ==="
mkdir -p node_modules/@deepseek-ai
link_pkg @deepseek-ai/cordis packages/core/cordis
link_pkg @deepseek-ai/cosmokit packages/core/cosmokit
link_pkg @deepseek-ai/schemastery packages/core/schemastery
link_pkg @deepseek-ai/dsh-tools packages/core/tools
link_pkg @deepseek-ai/dsh-llm packages/llm/llm
link_pkg @deepseek-ai/dsh-system-prompt packages/core/system-prompt
link_pkg @types/node node_modules/@types/node

STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1 || true)
if [ -n "$STD_SCHEMA" ]; then
  node -e "
    const fs = require('fs');
    const path = require('path');
    fs.rmSync('node_modules/@standard-schema', { recursive: true, force: true });
    fs.symlinkSync(path.resolve(process.argv[1]), path.resolve('node_modules/@standard-schema/spec'), process.platform === 'win32' ? 'junction' : 'dir');
  " "$STD_SCHEMA/node_modules/@standard-schema/spec"
fi

echo "=== Compiling src -> lib ==="
"$TSC" -p tsconfig.json
echo "=== Build complete ==="
