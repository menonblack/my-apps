#!/usr/bin/env bash
# Rebuilds web/vendor/anthropic-sdk.js: the official Anthropic TypeScript SDK
# (@anthropic-ai/sdk) bundled as one browser ES module, so the app needs no
# build step and works offline. Run from anywhere: bash fitness-tracker/tools/build-sdk.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm i --silent @anthropic-ai/sdk esbuild
echo "export { default, default as Anthropic } from '@anthropic-ai/sdk';" > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --minify --legal-comments=eof \
  --outfile="$HERE/../web/vendor/anthropic-sdk.js"
grep '"version"' node_modules/@anthropic-ai/sdk/package.json
