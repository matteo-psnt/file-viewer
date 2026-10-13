#!/bin/sh
# record.sh <scenario> [name]: plays a scenario in a fresh kitty window running
# Claude Code and records that window to demo/out/<name>.gif and .mp4.
#
# Everything goes through kitty's remote control, so the window needn't be in
# front and nothing is typed into whatever you're doing. A scenario is one step
# per line:
#
#   tools Write              also allow these tools without asking
#   mode acceptEdits         start in this permission mode (default: default)
#   say <text>               type a prompt and press enter
#   done                     wait until Claude's turn ends
#   view <path>              run /view <path>
#   key <name>               press a key (down, up, escape, n, p...)
#   pause <seconds>          hold the current screen
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
scenario=$1
name=${2:-$(basename "$scenario" .txt)}
kitty=$(command -v kitty || echo /Applications/kitty.app/Contents/MacOS/kitty)
sock=unix:/tmp/file-viewer-demo-$$
out=$here/out
frames=$out/$name-frames
mkdir -p "$out"
rm -rf "$frames"
mkdir -p "$frames"

tools=mcp__file-viewer__preview
extra=$(sed -n 's/^tools //p' "$scenario" | head -1)
[ -n "$extra" ] && tools="$tools,$extra"
mode=$(sed -n 's/^mode //p' "$scenario" | head -1)

k() { "$kitty" @ --to "$sock" "$@"; }
screen() { k get-text --extent all 2>/dev/null || true; }
turns() { screen | grep -c '· done' || true; }

# A session started from inside Claude Code would inherit its markers.
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH \
  -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED \
  -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_SESSION_KIND -u CLAUDE_EFFORT -u CLAUDE_JOB_DIR -u CLAUDE_PID \
  DISABLE_AUTOUPDATER=1 \
  "$kitty" -o allow_remote_control=socket-only --listen-on "$sock" \
  -o hide_window_decorations=titlebar-only -o remember_window_size=no \
  -o initial_window_width=118c -o initial_window_height=40c -o font_size=15 \
  -o window_padding_width=10 -o confirm_os_window_close=0 \
  --title file-viewer-demo --directory "$repo" \
  claude --permission-mode "${mode:-default}" --allowedTools "$tools" >/dev/null 2>&1 &
kpid=$!
trap 'kill $kpid ${cpid:-} 2>/dev/null || true' EXIT

# Wait for Claude Code's status line, so the first keys aren't swallowed.
i=0
until screen | grep -qE 'mode on|edits on'; do
  i=$((i + 1)); [ $i -gt 120 ] && { echo "Claude Code didn't start" >&2; exit 1; }
  sleep 0.5
done
sleep 2
window=$(k ls | python3 -I -c 'import json,sys; print(json.load(sys.stdin)[0]["platform_window_id"])')
python3 -I "$here/frames.py" capture "$window" "$frames" &
cpid=$!
sleep 1.5

before=0
while IFS= read -r line || [ -n "$line" ]; do
  verb=${line%% *}
  arg=${line#* }
  case "$verb" in
    say)
      before=$(turns)
      # Clear the line first: a late terminal reply can land in the prompt.
      k send-key ctrl+u; sleep 0.3
      k send-text "$arg"; sleep 0.6; k send-key enter ;;
    done)
      i=0
      until [ "$(turns)" -gt "$before" ]; do
        i=$((i + 1)); [ $i -gt 360 ] && { echo "turn didn't end" >&2; break; }
        sleep 0.5
      done
      sleep 2 ;;
    view)
      k send-key ctrl+u; sleep 0.3; k send-text "/view"; sleep 1; k send-text " $arg"; sleep 1; k send-key enter; sleep 5 ;;
    key)
      k send-key "$arg"; sleep 2 ;;
    pause)
      sleep "$arg" ;;
  esac
done <"$scenario"

sleep 1
touch "$frames/stop"
wait $cpid
python3 -I "$here/frames.py" build "$frames" "$out/$name"
