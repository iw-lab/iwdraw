#!/bin/zsh
# Firefly 재질 원본 생성 — 사람 속도, 한 장씩, 실패 시 최대 3회
cd "$(dirname $0)"
for name in linen smooth hanji; do for v in 1 2; do
  out=firefly/$name-$v.png; [[ -s $out ]] && { echo "SKIP $out"; continue; }
  for try in 1 2 3; do
    node ~/.claude/skills/yt-video-builder/engines/firefly_image.mjs --prompt-file prompts/$name.txt --out $out --model "Firefly Image 5" --aspect any --timeout 400 > firefly/$name-$v.log 2>&1; rc=$?
    echo "$name-$v try$try rc=$rc $(tail -1 firefly/$name-$v.log)"
    [[ $rc == 0 ]] && break; [[ $rc == 4 || $rc == 6 ]] && exit $rc; sleep 30
  done; sleep 20
done; done
