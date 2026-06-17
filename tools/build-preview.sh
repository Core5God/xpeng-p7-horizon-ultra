#!/usr/bin/env bash
# 一键重建单文件预览。无需联网、无需安装（vite 与插件已在 node_modules，随项目持久化）。
# /tmp 被清也没关系：assetmap 每次从项目内资源现生成。
set -e
cd "$(dirname "$0")/.."
node tools/gen-assetmap.mjs
npx vite build --config vite.singlefile.mjs --outDir /tmp/hc-single --emptyOutDir 2>&1 | tail -1
cp /tmp/hc-single/index.html "./地平线海岸_预览.html"
echo "预览已更新：地平线海岸_预览.html ($(du -m '地平线海岸_预览.html' | cut -f1) MB)"
