#!/bin/zsh
cd "$(dirname $0)"
for v in 1 2; do
  out=firefly/canvas3d-$v.png; [[ -s $out ]] && { echo "SKIP $out"; continue; }
  for try in 1 2 3; do
    node ~/.claude/skills/yt-video-builder/engines/firefly_image.mjs --prompt-file prompts/canvas3d.txt --out $out --model "Firefly Image 5" --aspect any --timeout 400 > firefly/canvas3d-$v.log 2>&1; rc=$?
    echo "canvas3d-$v try$try rc=$rc $(tail -1 firefly/canvas3d-$v.log)"
    [[ $rc == 0 ]] && break; [[ $rc == 4 || $rc == 6 ]] && exit $rc; sleep 20
  done; sleep 10
done
