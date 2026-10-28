#!/usr/bin/env sh
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -x "$PROJECT_ROOT/.tools/node/bin/node" ]; then
  export PATH="$PROJECT_ROOT/.tools/node/bin:$PATH"
fi
if [ -x "$PROJECT_ROOT/.tools/package-manager/node_modules/.bin/pnpm" ]; then
  export PATH="$PROJECT_ROOT/.tools/package-manager/node_modules/.bin:$PATH"
  exec "$PROJECT_ROOT/.tools/package-manager/node_modules/.bin/pnpm" "$@"
fi
exec pnpm "$@"
