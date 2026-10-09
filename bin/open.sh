#!/bin/sh
# open.sh <path>: opens a file in its default app on macOS, Linux or WSL.
set -e
if command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then
  exec open "$1"
elif command -v wslview >/dev/null 2>&1; then
  exec wslview "$1"
elif command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$1"
fi
echo "no way to open files here (install xdg-utils)" >&2
exit 1
