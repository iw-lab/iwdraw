#!/usr/bin/env bash
# 아트온 전용 wrangler — Cloudflare 로그인(simssijjang@naver.com, 계정 4644562c…)을 프로젝트 안(.cf-home)에 격리한다.
# 전역 로그인은 다른 프로젝트들이 바꿔 쓴다(2026-10-07 전역 = daum → 그대로 배포하면 daum 계정에 새 Worker 가 조용히 생긴다).
#   tools/cf.sh login | tools/cf.sh whoami | pnpm cf:deploy
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HOME="$ROOT/.cf-home" npm_config_cache="${npm_config_cache:-/Users/sim-insu/.npm}"
mkdir -p "$HOME"
exec "$ROOT/node_modules/.bin/wrangler" "$@"
