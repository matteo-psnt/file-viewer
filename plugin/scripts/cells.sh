#!/bin/sh
# cells.sh <png> <width> <height>: an uncompressed BMP of a rendered page at
# exactly width by height pixels, on white, for the block preview that
# terminals without pictures show. Prints the BMP's path.
set -e
png=$1
width=$2
height=$3
out="${png%.png}-c${width}x$height.bmp"
part="${png%.png}-c${width}x$height.part$$.bmp"
if [ ! -f "$out" ]; then
  if command -v magick >/dev/null 2>&1; then
    magick "$png" -background white -flatten -resize "${width}x$height!" -type TrueColor "BMP3:$part"
  elif command -v convert >/dev/null 2>&1; then
    convert "$png" -background white -flatten -resize "${width}x$height!" -type TrueColor "BMP3:$part"
  elif command -v sips >/dev/null 2>&1; then
    sips -s format bmp --resampleHeightWidth "$height" "$width" "$png" --out "$part" >/dev/null
  else
    echo "a block preview needs ImageMagick" >&2
    exit 4
  fi
  mv "$part" "$out"
fi
printf '%s\n' "$out"
