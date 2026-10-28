#!/bin/sh
# Revive the Camera & Pose Planner V2 preview. Idempotent.
if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
  exit 0
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1
if [ ! -d node_modules/vite ]; then
  npm ci --ignore-scripts --no-audit --no-fund
fi
npm run dev >/tmp/camera-v2-dev.log 2>&1 &
i=0
while [ "$i" -lt 40 ]; do
  if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done
echo "Camera planner did not start" >&2
exit 1
