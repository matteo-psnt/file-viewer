#!/bin/sh
# jpeg.sh <png> <max width>: a JPEG copy of a rendered page small enough to
# embed in an SVG (the remote surfaces take at most 128 KiB of markup), for the
# desktop app and the editor. Prints the JPEG's path.
set -e
png=$1
width=$2
out="${png%.png}-w$width.jpg"
part="${png%.png}-w$width.part$$.jpg"
if [ ! -f "$out" ]; then
  # Lower the quality first, then the width, until it fits.
  for w in "$width" $((width * 3 / 4)) $((width / 2)); do
    for quality in 80 60 40; do
      if command -v magick >/dev/null 2>&1; then
        magick "$png" -resize "${w}x>" -quality "$quality" "$part"
      elif command -v sips >/dev/null 2>&1; then
        sips -s format jpeg -s formatOptions "$quality" --resampleWidth "$w" "$png" --out "$part" >/dev/null
      else
        convert "$png" -resize "${w}x>" -quality "$quality" "$part"
      fi
      [ "$(wc -c < "$part")" -lt 92000 ] && break 2
    done
  done
  mv "$part" "$out"
fi
printf '%s\n' "$out"
