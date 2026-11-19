#!/usr/bin/env bash
# Collect cluster-render, DCSM2, RAMSES and system diagnostics from an MGU.
#
# Run BEFORE reproducing the panel failure:
#   ./scripts/collect-renderer-diagnostics.sh root@169.254.159.162 600
#
# The script waits for the requested capture window, then downloads one archive.
# It does not restart services, change configuration, or write to the car's system.
set -euo pipefail

usage() {
    echo "Usage: $(basename "$0") <root@MGU-host> [capture-seconds] [output-directory]" >&2
    exit 1
}
[ $# -ge 1 ] || usage
CAR_HOST="$1"
DURATION="${2:-600}"
OUT_DIR="${3:-$HOME/Downloads}"
case "$DURATION" in ''|*[!0-9]*) usage ;; esac
[ "$DURATION" -ge 30 ] || { echo "Capture window must be at least 30 seconds." >&2; exit 1; }
mkdir -p "$OUT_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
LOCAL_ARCHIVE="$OUT_DIR/mgu-renderer-diagnostics-$STAMP.tar.gz"
REMOTE_ARCHIVE="/tmp/mgu-renderer-diagnostics-$STAMP.tar.gz"

echo "Connecting to $CAR_HOST"
echo "Capture window: $DURATION seconds. Reproduce the issue while the window is running."

ssh "$CAR_HOST" "DURATION='$DURATION' REMOTE_ARCHIVE='$REMOTE_ARCHIVE' bash -s" <<'REMOTE'
set -u
START_EPOCH="$(date +%s)"
START_ISO="$(date -Iseconds 2>/dev/null || date)"
WORK="$(mktemp -d /tmp/mgu-renderer-diag.XXXXXX)"
mkdir -p "$WORK"/{system,logs,process,files}
printf 'start_epoch=%s\nstart_time=%s\nduration_seconds=%s\n' "$START_EPOCH" "$START_ISO" "$DURATION" > "$WORK/metadata.txt"

{
    echo "=== uname ==="; uname -a
    echo "=== os-release ==="; cat /etc/os-release 2>/dev/null || true
    echo "=== uptime ==="; uptime 2>/dev/null || true
    echo "=== date ==="; date -Iseconds 2>/dev/null || date
    echo "=== disk ==="; df -h 2>/dev/null || true
    echo "=== memory ==="; cat /proc/meminfo 2>/dev/null || true
} > "$WORK/system/host.txt" 2>&1

ps waux 2>&1 > "$WORK/process/ps-before.txt" || ps 2>&1 > "$WORK/process/ps-before.txt" || true
{
    echo "=== matching processes ==="
    ps w 2>/dev/null | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor' | grep -v grep || true
    echo "=== matching services ==="
    systemctl list-units --all --type=service --no-pager 2>/dev/null | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor' || true
    echo "=== socket ==="
    ls -l /dev/shm/cluster-render /dev/shm/cluster-render/render.sock 2>&1 || true
    echo "=== socket owners ==="
    ss -xlpn 2>&1 | grep -iE 'cluster-render|ramses|dcsm' || true
} > "$WORK/process/renderer-before.txt" 2>&1

echo "Collecting for $DURATION seconds..."
sleep "$DURATION"

END_EPOCH="$(date +%s)"
printf 'end_epoch=%s\nend_time=%s\n' "$END_EPOCH" "$(date -Iseconds 2>/dev/null || date)" >> "$WORK/metadata.txt"

# Keep the raw journal output and a focused view. Unit names differ between firmware builds,
# so query the complete journal for the capture window rather than assuming service names.
if command -v journalctl >/dev/null 2>&1; then
    journalctl --since "@$START_EPOCH" --until "@$END_EPOCH" --no-pager -o short-precise \
        > "$WORK/system/journal-window.log" 2>&1 || true
    grep -iE 'ramses|dcsm2?|cluster.?render|renderer|display|compositor|some.?ip|kombi|watchdog|oom|segfault|fatal|error|warn|reset|unavailable' \
        "$WORK/system/journal-window.log" > "$WORK/system/journal-focused.log" || true
    journalctl -k --since "@$START_EPOCH" --until "@$END_EPOCH" --no-pager -o short-precise \
        > "$WORK/system/kernel-window.log" 2>&1 || true
else
    echo "journalctl not installed" > "$WORK/system/journal-window.log"
fi

dmesg -T > "$WORK/system/dmesg.txt" 2>&1 || dmesg > "$WORK/system/dmesg.txt" 2>&1 || true
{
    echo "=== processes after capture ==="
    ps w 2>/dev/null | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor' | grep -v grep || true
    echo "=== services after capture ==="
    systemctl list-units --all --type=service --no-pager 2>/dev/null | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor' || true
    echo "=== socket ==="
    ls -l /dev/shm/cluster-render /dev/shm/cluster-render/render.sock 2>&1 || true
    ss -xlpn 2>&1 | grep -iE 'cluster-render|ramses|dcsm' || true
} > "$WORK/process/renderer-after.txt" 2>&1

# Copy known cluster-render log directory, then discover other named log files without
# assuming a single RAMSES/DCSM2 path. Binary journal files are not copied.
for DIR in /var/opt/cluster-render/log /var/log/cluster-render /var/log; do
    if [ -d "$DIR" ]; then
        find "$DIR" -maxdepth 3 -type f \( -iname '*ramses*' -o -iname '*dcsm*' -o -iname '*cluster*render*' -o -iname '*renderer*' -o -iname '*display*' \) \
            -exec cp -p --parents '{}' "$WORK/files" \; 2>/dev/null || true
    fi
done
# Preserve the renderer's complete text logs even if their filenames do not match discovery.
if [ -d /var/opt/cluster-render/log ]; then
    cp -p /var/opt/cluster-render/log/* "$WORK/logs/" 2>/dev/null || true
fi

# Snapshot likely service state without assuming that systemd units exist.
if command -v systemctl >/dev/null 2>&1; then
    systemctl list-units --all --type=service --no-pager > "$WORK/system/services.txt" 2>&1 || true
    systemctl --failed --no-pager > "$WORK/system/failed-services.txt" 2>&1 || true
fi

tar -czf "$REMOTE_ARCHIVE" -C "$WORK" .
rm -rf "$WORK"
echo "Archive ready: $REMOTE_ARCHIVE"
REMOTE

scp "$CAR_HOST:$REMOTE_ARCHIVE" "$LOCAL_ARCHIVE"
ssh "$CAR_HOST" "rm -f '$REMOTE_ARCHIVE'" >/dev/null 2>&1 || true
echo "Saved: $LOCAL_ARCHIVE"
