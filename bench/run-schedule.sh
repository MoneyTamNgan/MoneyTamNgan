#!/usr/bin/env bash
# Run Set A at three times of day, then compare. Usage: bench/run-schedule.sh [wait-pid]
set -u
cd "$(dirname "$0")/.."
export BENCH_PYTHON="${BENCH_PYTHON:-bench/.venv/bin/python}"
log() { echo "$(date '+%F %T') $*" | tee -a bench/logs/schedule.log; }

next_at() {  # epoch of the next HH:MM after epoch $2
    local t
    t=$(date -j -f '%s' "$2" +%Y-%m-%d)
    t=$(date -j -f '%Y-%m-%d %H:%M' "$t $1" +%s)
    [ "$t" -le "$2" ] && t=$((t + 86400))
    echo "$t"
}

wait_epoch() {  # returns immediately if the previous run overran the slot
    local now
    now=$(date +%s)
    if [ "$1" -gt "$now" ]; then
        log "sleeping until $(date -r "$1" '+%F %T')"
        sleep $(($1 - now))
    fi
}

run() {
    log "start $1"
    node scripts/bench-pipelines.js --set=bench/set-a.json --pipeline=all \
        --run-label="$1" --delay=4000 > "bench/logs/$1.log" 2>&1
    log "done $1 (exit $?)"
}

if [ -n "${1:-}" ]; then
    log "waiting for pid $1"
    while kill -0 "$1" 2>/dev/null; do sleep 30; done
fi

NIGHT=$(next_at 02:00 "$(date +%s)")
MORNING=$(next_at 10:00 "$NIGHT")
log "slots: night $(date -r "$NIGHT" '+%F %T'), morning $(date -r "$MORNING" '+%F %T')"

run seta-evening
wait_epoch "$NIGHT"
run seta-night
wait_epoch "$MORNING"
run seta-morning
node scripts/bench-pipelines.js --compare=seta-evening,seta-night,seta-morning \
    > bench/logs/compare.log 2>&1
log "ALL DONE"
