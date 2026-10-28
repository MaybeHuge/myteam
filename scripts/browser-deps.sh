#!/usr/bin/env sh
# 当前 Ubuntu/WSL 的可选无 sudo 浏览器依赖；其他系统按 Playwright 文档配置。
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$PROJECT_ROOT/.tools/browser-debs" "$PROJECT_ROOT/.tools/browser-libs" "$PROJECT_ROOT/.tools/font-cache"
cd "$PROJECT_ROOT/.tools/browser-debs"
apt-get download libnspr4 libnss3 libasound2t64 fonts-noto-cjk
for file in ./*.deb; do dpkg-deb -x "$file" ../browser-libs; done
cat > "$PROJECT_ROOT/.tools/browser-fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>$PROJECT_ROOT/.tools/browser-libs/usr/share/fonts</dir>
  <cachedir>$PROJECT_ROOT/.tools/font-cache</cachedir>
</fontconfig>
EOF
echo '可选浏览器依赖已解压到 .tools，未安装系统软件包。'
