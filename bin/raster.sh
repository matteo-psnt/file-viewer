#!/bin/sh
# raster.sh <png> <width> <height>: scales a picture to exactly width x height
# pixels as an uncompressed BMP, for drawing as coloured text cells where the
# terminal can't show real pictures. Prints the BMP's path.
set -e
png=$1
w=$2
h=$3
out="${png%.png}-${w}x${h}.bmp"
if [ ! -f "$out" ]; then
  if command -v magick >/dev/null 2>&1; then
    magick "$png" -background white -flatten -resize "${w}x${h}!" -type truecolor "BMP3:$out"
  elif command -v convert >/dev/null 2>&1; then
    convert "$png" -background white -flatten -resize "${w}x${h}!" -type truecolor "BMP3:$out"
  else
    sips -s format bmp -z "$h" "$w" "$png" --out "$out" >/dev/null
  fi
fi
printf '%s\n' "$out"
