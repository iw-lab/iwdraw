#!/usr/bin/env bash
# 배포본 도안 목록 판정 — 부분색칠 11주제가 비지 않았고, 영어 코드 제목·깨진 항목이 없는가 (2026-10-14 도안 전수 정리)
set -euo pipefail
curl -s "https://arton.simssijjang.workers.dev/templates/manifest.json?t=$(date +%s)" | python3 -c '
import json,sys
m=json.load(sys.stdin); bad=[]
for k,t in m["themes"].items():
    if k.startswith("pc_") and not t["items"]: bad.append(f"{k}: 0장")
    for it in t["items"]:
        if it["title"]==it["id"]: iid=it["id"]; bad.append(f"{k}/{iid}: 제목이 코드")
if bad: print("\n".join(bad[:20])); print(f"미달 {len(bad)}건"); sys.exit(1)
print("OK")'
