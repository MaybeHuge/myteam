#!/usr/bin/env sh
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"
NODE_VERSION=24.22.1
PNPM_VERSION=12.15.0
if [ ! -x .tools/node/bin/node ]; then
  if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
    echo '请在当前平台安装 .nvmrc 指定的 Node，然后安装 packageManager 指定的 pnpm。'
    exit 1
  fi
  mkdir -p .tools
  ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE}" -o ".tools/${ARCHIVE}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o .tools/SHASUMS256.txt
  (cd .tools && grep " ${ARCHIVE}$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf ".tools/${ARCHIVE}" -C .tools
  mv ".tools/node-v${NODE_VERSION}-linux-x64" .tools/node
fi
export PATH="$PROJECT_ROOT/.tools/node/bin:$PATH"
if [ ! -x .tools/package-manager/node_modules/.bin/pnpm ]; then
  npm install --prefix .tools/package-manager "pnpm@${PNPM_VERSION}" --no-audit --no-fund
fi
echo '项目工具已就绪。运行 ./scripts/pnpm.sh install'
