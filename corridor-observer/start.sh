#!/bin/sh
set -eu

calibration_file="${CALIBRATION_FILE:-/var/data/n3-south-xindian-yangmei-lane-calibration.json}"
bootstrap_calibration="/app/bootstrap/n3-south-xindian-yangmei-lane-calibration.json"
if [ ! -f "$calibration_file" ] && [ -f "$bootstrap_calibration" ]; then
  mkdir -p "$(dirname "$calibration_file")"
  cp "$bootstrap_calibration" "$calibration_file"
fi

python3 analysis-worker.py --port "${ANALYSIS_PORT:-10001}" &
worker_pid=$!

node server.mjs &
server_pid=$!

cleanup() {
  kill "$worker_pid" 2>/dev/null || true
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$server_pid"
