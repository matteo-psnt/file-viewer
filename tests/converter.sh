#!/bin/sh
# Runs bin/render.sh on every fixture and checks what it prints.
# Usage: sh tests/converter.sh   (needs the tools bin/doctor.sh lists)
set -u
here=$(cd "$(dirname "$0")" && pwd)
render="$here/../bin/render.sh"
fixtures="$here/fixtures"
cache=$(mktemp -d)
trap 'rm -rf "$cache"' EXIT
failures=0

# expect <file> <page> <field number> <expected value> <what>
expect() {
  line=$(sh "$render" "$fixtures/$1" "$2" "$cache" 2>&1) || {
    printf 'FAIL %s: exited: %s\n' "$1" "$line"
    failures=$((failures + 1))
    return
  }
  got=$(printf '%s' "$line" | cut -f"$3")
  if [ "$got" = "$4" ]; then
    printf 'ok   %s: %s\n' "$1" "$5"
  else
    printf 'FAIL %s: %s, expected %s, got %s\n' "$1" "$5" "$4" "$got"
    failures=$((failures + 1))
  fi
}

# refuses <file> <message pattern>
refuses() {
  if line=$(sh "$render" "$fixtures/$1" 1 "$cache" 2>&1); then
    printf 'FAIL %s: should be refused, printed %s\n' "$1" "$line"
    failures=$((failures + 1))
  elif printf '%s' "$line" | grep -q "$2"; then
    printf 'ok   %s: refused (%s)\n' "$1" "$line"
  else
    printf 'FAIL %s: refused with %s\n' "$1" "$line"
    failures=$((failures + 1))
  fi
}

expect two-pages.pdf 2 4 2 "two pages"
expect two-pages.pdf 2 5 2 "renders page 2"
expect two-pages.pdf 9 5 2 "clamps a page past the end"
expect still.png 1 2 120 "keeps a small image at its own width"
expect still.png 1 3 80 "keeps a small image at its own height"
expect photo.heic 1 2 120 "converts HEIC"
expect shape.svg 1 2 1400 "renders SVG at 1400 px"
expect shape.svg 1 3 700 "keeps the SVG's aspect ratio"
expect doc.docx 1 4 1 "converts a one-page Word file"

line=$(sh "$render" "$fixtures/spinner.gif" 1 "$cache")
list=$(printf '%s' "$line" | cut -f7)
if [ -f "$list" ] && [ "$(wc -l < "$list" | tr -d ' ')" = 3 ] && [ "$(cut -f2 "$list" | sort -u)" = 100 ]; then
  printf 'ok   spinner.gif: three frames of 100 ms\n'
else
  printf 'FAIL spinner.gif: frames list %s\n' "$list"
  failures=$((failures + 1))
fi

refuses notes.md "not a supported type"

if [ "$failures" -gt 0 ]; then
  printf '\n%s failed\n' "$failures"
  exit 1
fi
printf '\nall passed\n'
