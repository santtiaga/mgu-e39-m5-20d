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
# Prefer the root key created by idrive7-8-ssh-root. Override with SSH_KEY=/path/to/key.
SSH_KEY="${SSH_KEY:-$HOME/.ssh/mgu_root_key}"
SSH_ARGS=()
if [ -n "$SSH_KEY" ] && [ -r "$SSH_KEY" ]; then
    SSH_ARGS=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
    echo "Using SSH key: $SSH_KEY"
else
    echo "SSH key not found/readable at $SSH_KEY; falling back to ssh-agent/default SSH config." >&2
fi
case "$DURATION" in ''|*[!0-9]*) usage ;; esac
[ "$DURATION" -ge 30 ] || { echo "Capture window must be at least 30 seconds." >&2; exit 1; }
mkdir -p "$OUT_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
LOCAL_ARCHIVE="$OUT_DIR/mgu-renderer-diagnostics-$STAMP.tar.gz"
REMOTE_ARCHIVE="/tmp/mgu-renderer-diagnostics-$STAMP.tar.gz"

echo "Connecting to $CAR_HOST"
echo "Capture window: $DURATION seconds. Reproduce the issue while the window is running."

ssh "${SSH_ARGS[@]}" "$CAR_HOST" "DURATION='$DURATION' REMOTE_ARCHIVE='$REMOTE_ARCHIVE' sh -s" <<'REMOTE'
set -u
START_EPOCH="$(date +%s)"
START_ISO="$(date -Iseconds 2>/dev/null || date)"
WORK="$(mktemp -d /tmp/mgu-renderer-diag.XXXXXX)"
mkdir -p "$WORK/system" "$WORK/logs" "$WORK/process" "$WORK/files"
printf 'start_epoch=%s\nstart_time=%s\nduration_seconds=%s\n' "$START_EPOCH" "$START_ISO" "$DURATION" > "$WORK/metadata.txt"

{
    echo "=== uname ==="; uname -a
    echo "=== os-release ==="; cat /etc/os-release 2>/dev/null || true
    echo "=== uptime ==="; uptime 2>/dev/null || true
    echo "=== date ==="; date -Iseconds 2>/dev/null || date
    echo "=== disk ==="; df -h 2>/dev/null || true
    echo "=== memory ==="; cat /proc/meminfo 2>/dev/null || true
} > "$WORK/system/host.txt" 2>&1

ps w 2>&1 > "$WORK/process/ps-before.txt" || true
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

# Sample display-provider processes, matching systemd units and the renderer socket
# throughout the capture. A before/after snapshot alone can miss a short service restart.
DISPLAY_MONITOR_PID=""
(
    while :; do
        {
            printf '\n===== %s =====\n' "$(date -Iseconds 2>/dev/null || date)"
            echo "--- display-related processes ---"
            ps w 2>/dev/null | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor' | grep -v grep || true
            if command -v systemctl >/dev/null 2>&1; then
                echo "--- matching systemd service state ---"
                systemctl list-units --all --type=service --no-legend --no-pager 2>/dev/null |
                    awk '{print $1}' | grep -iE 'ramses|dcsm|cluster.?render|renderer|display|compositor|kombi' |
                    while IFS= read -r UNIT; do
                        [ -n "$UNIT" ] || continue
                        echo "UNIT $UNIT"
                        systemctl show "$UNIT" --no-pager \
                            -p ActiveState -p SubState -p MainPID -p NRestarts -p Result \
                            -p ExecMainStartTimestamp -p ActiveEnterTimestamp -p InactiveEnterTimestamp \
                            -p ExecMainCode -p ExecMainStatus 2>/dev/null || true
                    done
            fi
            echo "--- renderer socket ---"
            ls -ln /dev/shm/cluster-render /dev/shm/cluster-render/render.sock 2>&1 || true
            ss -xlpn 2>/dev/null | grep -iE 'cluster-render|ramses|dcsm|display' || true
        } >> "$WORK/process/display-service-timeline.log" 2>&1
        sleep 1
    done
) &
DISPLAY_MONITOR_PID=$!

echo "Collecting for $DURATION seconds..."
sleep "$DURATION"
if [ -n "$DISPLAY_MONITOR_PID" ]; then
    kill "$DISPLAY_MONITOR_PID" 2>/dev/null || true
    wait "$DISPLAY_MONITOR_PID" 2>/dev/null || true
fi

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
for DIR in /var/opt/cluster-render/log /var/log/cluster-render /var/log /var/opt; do
    if [ -d "$DIR" ]; then
        DEPTH=3
        [ "$DIR" = /var/opt ] && DEPTH=5
        FIND_LIST="$WORK/find-results.txt"
        find "$DIR" -maxdepth "$DEPTH" -type f \( -iname '*ramses*' -o -iname '*dcsm*' -o -iname '*cluster*render*' -o -iname '*renderer*' -o -iname '*display*' \) 2>/dev/null > "$FIND_LIST"
        while IFS= read -r FILE; do
            [ -f "$FILE" ] || continue
            SAFE="$(printf '%s' "$FILE" | sed 's#^/##; s#/#_#g')"
            cp -p "$FILE" "$WORK/files/$SAFE" 2>/dev/null || true
        done < "$FIND_LIST"
        rm -f "$FIND_LIST"
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

scp "${SSH_ARGS[@]}" "$CAR_HOST:$REMOTE_ARCHIVE" "$LOCAL_ARCHIVE"
ssh "${SSH_ARGS[@]}" "$CAR_HOST" "rm -f '$REMOTE_ARCHIVE'" >/dev/null 2>&1 || true
echo "Saved: $LOCAL_ARCHIVE"
