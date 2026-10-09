#!/bin/sh
# render.sh <source> <page> <cache dir>
# Turns an asset into a PNG the terminal can draw.
# Prints one line, tab separated:
#   png  width  height  pages  page  source  frames  note
# frames is the path of a list of "png<TAB>delay ms" lines for an animation, or "-".
# note says what a viewer should know about the conversion, or "-".
set -e
src=$1
page=${2:-1}
cache=$3
# A literal "~/" from the caller, expanded here.
# shellcheck disable=SC2088
case "$cache" in "~/"*) cache="$HOME/${cache#\~/}" ;; esac
mkdir -p "$cache"
# shellcheck disable=SC2088
case "$src" in "~/"*) src="$HOME/${src#\~/}" ;; esac
[ -f "$src" ] || { echo "no such file: $src" >&2; exit 2; }
src="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"

ext=$(printf '%s' "${src##*.}" | tr '[:upper:]' '[:lower:]')
mtime=$(stat -f %m "$src")
doc=$(md5 -q -s "$src:$mtime")
out="$cache/$doc-p$page.png"
pages=1
frames=-
note=-

# Prints the first of its arguments that exists, so a glob that matched nothing fails.
first() {
  for f in "$@"; do
    [ -e "$f" ] && { printf '%s' "$f"; return 0; }
  done
  return 1
}

chrome() {
  for app in "Google Chrome" "Chromium" "Microsoft Edge" "Brave Browser"; do
    bin="/Applications/$app.app/Contents/MacOS/$app"
    [ -x "$bin" ] && { printf '%s' "$bin"; return 0; }
  done
  return 1
}

soffice_bin() {
  command -v soffice 2>/dev/null && return 0
  [ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ] && {
    printf '%s' /Applications/LibreOffice.app/Contents/MacOS/soffice
    return 0
  }
  return 1
}

# Office files become a PDF once: LibreOffice when installed (exact pages),
# else Quick Look's HTML printed by a headless Chromium (approximate layout).
office_to_pdf() {
  pdf="$cache/$doc.pdf"
  [ -f "$pdf" ] && return 0
  work="$cache/$doc-work"
  rm -rf "$work"
  mkdir -p "$work"
  if so=$(soffice_bin); then
    "$so" --headless --convert-to pdf --outdir "$work" "$src" >/dev/null 2>&1 || true
    made=$(first "$work"/*.pdf || true)
    [ -n "$made" ] && { mv "$made" "$pdf"; rm -rf "$work"; return 0; }
  fi
  browser=$(chrome) || { rm -rf "$work"; return 1; }
  qlmanage -p -o "$work" "$src" >/dev/null 2>&1 || true
  ql=$(first "$work"/*.qlpreview || true)
  [ -n "$ql" ] && [ -f "$ql/Preview.html" ] || { rm -rf "$work"; return 1; }
  # Chromium cannot draw a PDF inside <img>: rasterize embedded ones.
  for f in "$ql"/*.pdf; do
    [ -f "$f" ] && pdftoppm -png -r 200 -singlefile "$f" "${f%.pdf}-pdf" 2>/dev/null || true
  done
  size=$(grep -o 'div.slide, div.loading-slide { width: [0-9]*; height: [0-9]*;}' "$ql/Preview.html" | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
  if [ -n "$size" ]; then
    # shellcheck disable=SC2086 # split "720 540" into width and height
    set -- $size
    css="@page{size:$(echo "scale=3; $1/96" | bc)in $(echo "scale=3; $2/96" | bc)in;margin:0} html,body{margin:0!important;background:#fff!important} div.slide{margin:0!important;box-shadow:none!important;-webkit-box-shadow:none!important;break-after:page} div.loading-slide{display:none!important}"
  else
    css="@page{size:letter;margin:0.6in} html,body{background:#fff!important}"
  fi
  sed -e 's|\(Attachment[0-9]*\)\.pdf|\1-pdf.png|g' -e "s|</head>|<style>$css</style></head>|" "$ql/Preview.html" > "$ql/print.html"
  "$browser" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$work/profile" \
    --print-to-pdf="$pdf" "file://$ql/print.html" >/dev/null 2>&1 || true
  rm -rf "$work"
  [ -f "$pdf" ] && touch "$cache/$doc.approx"
  [ -f "$pdf" ]
}

render_pdf() {
  pages=$(pdfinfo "$1" 2>/dev/null | awk '/^Pages:/ {print $2}')
  pages=${pages:-1}
  [ "$page" -gt "$pages" ] && page=$pages
  out="$cache/$doc-p$page.png"
  [ -f "$out" ] || pdftoppm -f "$page" -l "$page" -png -r 120 -singlefile "$1" "${out%.png}"
}

# Animated images: one PNG per frame, composited, with each frame's delay.
animate() {
  count=$(magick identify "$src" 2>/dev/null | wc -l | tr -d ' ')
  [ "${count:-1}" -gt 1 ] || return 1
  dir="$cache/$doc-frames"
  list="$dir/frames.tsv"
  if [ ! -f "$list" ]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    magick "$src" -coalesce -resize '960x960>' "$dir/f-%04d.png"
    n=0
    for f in "$dir"/f-*.png; do n=$((n + 1)); done
    magick identify -format '%T\n' "$src" | head -n "$n" > "$dir/delays"
    for f in "$dir"/f-*.png; do printf '%s\n' "$f"; done | paste - "$dir/delays" |
      awk -F'\t' '{ d = $2 * 10; if (d < 20) d = 100; print $1 "\t" d }' > "$list"
  fi
  frames=$list
  out=$(head -1 "$list" | cut -f1)
}

case "$ext" in
  pdf)
    render_pdf "$src"
    ;;
  docx|doc|pptx|ppt|xlsx|xls|rtf|odt|odp|ods)
    if office_to_pdf; then
      render_pdf "$cache/$doc.pdf"
      [ -f "$cache/$doc.approx" ] &&
        note="approximate layout (Quick Look); install LibreOffice for exact pages"
    else
      out="$cache/$doc-p1.png"
      tmp="$cache/ql-$doc"
      mkdir -p "$tmp"
      qlmanage -t -s 1400 -o "$tmp" "$src" >/dev/null 2>&1
      thumb=$(first "$tmp"/*.png || true)
      [ -n "$thumb" ] || { rm -rf "$tmp"; echo "no preview for .$ext" >&2; exit 3; }
      mv "$thumb" "$out"
      rm -rf "$tmp"
      note="first page only; install LibreOffice or Chrome for every page"
    fi
    ;;
  gif|webp|apng)
    if ! animate; then
      out="$cache/$doc-p1.png"
      [ -f "$out" ] || sips -s format png --resampleHeightWidthMax 1600 "$src" --out "$out" >/dev/null
    fi
    ;;
  png|jpg|jpeg|heic|heif|avif|tif|tiff|bmp|psd|tga|ico|icns|jp2|dng|cr2|cr3|nef|arw|raf|orf|rw2)
    [ -f "$out" ] || sips -s format png --resampleHeightWidthMax 1600 "$src" --out "$out" >/dev/null
    ;;
  svg|svgz)
    [ -f "$out" ] || rsvg-convert -w 1400 --keep-aspect-ratio -b white "$src" -o "$out"
    ;;
  key|pages|numbers)
    if [ ! -f "$out" ]; then
      tmp="$cache/ql-$doc"
      mkdir -p "$tmp"
      qlmanage -t -s 1400 -o "$tmp" "$src" >/dev/null 2>&1
      thumb=$(first "$tmp"/*.png || true)
      [ -n "$thumb" ] || { rm -rf "$tmp"; echo "no preview for .$ext" >&2; exit 3; }
      mv "$thumb" "$out"
      rm -rf "$tmp"
    fi
    note="first page only (iWork previews hold one page)"
    ;;
  *)
    echo ".$ext is not a supported type" >&2
    exit 3
    ;;
esac

[ "$pages" -eq 1 ] && page=1
w=$(sips -g pixelWidth "$out" | awk '/pixelWidth/ {print $2}')
h=$(sips -g pixelHeight "$out" | awk '/pixelHeight/ {print $2}')
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$out" "$w" "$h" "$pages" "$page" "$src" "$frames" "$note"
