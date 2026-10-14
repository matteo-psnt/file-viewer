#!/bin/sh
# render.sh <source> <page> [cache dir]
# Turns an asset into a PNG the terminal can draw. Runs on macOS and Linux.
# Prints one line, tab separated:
#   png  width  height  pages  page  source  frames  note
# frames is the path of a list of "png<TAB>delay ms" lines for an animation, or "-".
# note says what a viewer should know about the conversion, or "-".
set -e
src=$1
page=${2:-1}
cache=${3:-}
os=$(uname -s)

if [ -z "$cache" ]; then
  if [ "$os" = Darwin ]; then
    cache="$HOME/Library/Caches/claude-file-viewer"
  else
    cache="${XDG_CACHE_HOME:-$HOME/.cache}/claude-file-viewer"
  fi
fi
# A literal "~/" from the caller, expanded here.
# shellcheck disable=SC2088
case "$cache" in "~/"*) cache="$HOME/${cache#\~/}" ;; esac
mkdir -p "$cache"
# Drop what nothing has used for a month; a preview that needs it renders again.
find "$cache" -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} + 2>/dev/null || true
# shellcheck disable=SC2088
case "$src" in "~/"*) src="$HOME/${src#\~/}" ;; esac
[ -f "$src" ] || { echo "no such file: $src" >&2; exit 2; }
src="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"

has() { command -v "$1" >/dev/null 2>&1; }

# ImageMagick 7 is `magick`; distributions that still ship 6 have `convert`.
im() {
  if has magick; then magick "$@"; else convert "$@"; fi
}
im_identify() {
  if has magick; then magick identify "$@"; else identify "$@"; fi
}

# GNU first: GNU `stat -f` means filesystem status and would print that too.
mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }

hash_of() {
  if has md5; then md5 -q -s "$1"; else printf '%s' "$1" | md5sum | cut -d' ' -f1; fi
}

# Prints the first of its arguments that exists, so a glob that matched nothing fails.
first() {
  for f in "$@"; do
    [ -e "$f" ] && { printf '%s' "$f"; return 0; }
  done
  return 1
}

need() {
  has "$1" || { echo "previewing .$ext needs $1 ($2)" >&2; exit 4; }
}

ext=$(printf '%s' "${src##*.}" | tr '[:upper:]' '[:lower:]')
doc=$(hash_of "$src:$(mtime_of "$src")")
out="$cache/$doc-p$page.png"
pages=1
frames=-
note=-

# Any still image to a PNG at most 1600 px on its long side. Written beside
# the target and moved into place, so a killed render leaves no half a PNG.
to_png() {
  [ -f "$2" ] && return 0
  part="${2%.png}.part$$.png"
  if has sips; then
    # sips also enlarges small images, so only resample ones over the limit.
    long=$(sips -g pixelWidth -g pixelHeight "$1" | awk '/pixel(Width|Height)/ { if ($2 > m) m = $2 } END { print m + 0 }')
    if [ "$long" -gt 1600 ]; then
      sips -s format png --resampleHeightWidthMax 1600 "$1" --out "$part" >/dev/null
    else
      sips -s format png "$1" --out "$part" >/dev/null
    fi
  else
    has magick || has convert || { echo "previewing .$ext needs ImageMagick" >&2; exit 4; }
    im "$1[0]" -auto-orient -resize '1600x1600>' "$part"
  fi
  mv "$part" "$2"
}

size_of() {
  if has sips; then
    w=$(sips -g pixelWidth "$1" | awk '/pixelWidth/ {print $2}')
    h=$(sips -g pixelHeight "$1" | awk '/pixelHeight/ {print $2}')
  else
    set -- "$(im_identify -format '%w %h' "$1")"
    w=${1% *}
    h=${1#* }
  fi
}

# Runs a command for at most $1 seconds. Quick Look, LibreOffice and a headless
# browser can all wait forever where there's no desktop session (CI, ssh).
with_timeout() {
  limit=$1
  shift
  "$@" &
  child=$!
  (sleep "$limit"; kill "$child") >/dev/null 2>&1 &
  guard=$!
  result=0
  wait "$child" 2>/dev/null || result=$?
  # Waiting on the stopped guard keeps the shell from announcing it.
  kill "$guard" 2>/dev/null || true
  wait "$guard" 2>/dev/null || true
  return "$result"
}

chrome() {
  for app in "Google Chrome" "Chromium" "Microsoft Edge" "Brave Browser"; do
    bin="/Applications/$app.app/Contents/MacOS/$app"
    [ -x "$bin" ] && { printf '%s' "$bin"; return 0; }
  done
  return 1
}

soffice_bin() {
  for bin in soffice libreoffice; do
    has "$bin" && { command -v "$bin"; return 0; }
  done
  [ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ] && {
    printf '%s' /Applications/LibreOffice.app/Contents/MacOS/soffice
    return 0
  }
  return 1
}

# Office files become a PDF once: LibreOffice when installed (exact pages),
# else, on macOS, Quick Look's HTML printed by a headless Chromium (approximate layout).
office_to_pdf() {
  pdf="$cache/$doc.pdf"
  [ -f "$pdf" ] && return 0
  work="$cache/$doc-work"
  rm -rf "$work"
  mkdir -p "$work"
  if so=$(soffice_bin); then
    with_timeout 90 "$so" --headless "-env:UserInstallation=file://$work/profile" --convert-to pdf --outdir "$work" "$src" >/dev/null 2>&1 || true
    made=$(first "$work"/*.pdf || true)
    [ -n "$made" ] && { mv "$made" "$pdf"; rm -rf "$work"; return 0; }
  fi
  has qlmanage || { rm -rf "$work"; return 1; }
  browser=$(chrome) || { rm -rf "$work"; return 1; }
  with_timeout 60 qlmanage -p -o "$work" "$src" >/dev/null 2>&1 || true
  ql=$(first "$work"/*.qlpreview || true)
  if [ -z "$ql" ] || [ ! -f "$ql/Preview.html" ]; then rm -rf "$work"; return 1; fi
  # Chromium cannot draw a PDF inside <img>: rasterize embedded ones.
  for f in "$ql"/*.pdf; do
    if [ -f "$f" ]; then pdftoppm -png -r 200 -singlefile "$f" "${f%.pdf}-pdf" 2>/dev/null || true; fi
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
  with_timeout 60 "$browser" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$work/profile" \
    --print-to-pdf="$pdf" "file://$ql/print.html" >/dev/null 2>&1 || true
  [ -f "$pdf" ] && drop_trailing_blank_pages "$pdf" "$work"
  rm -rf "$work"
  [ -f "$pdf" ] && touch "$cache/$doc.approx"
  [ -f "$pdf" ]
}

# A spreadsheet without LibreOffice: Quick Look's HTML holds the sheet as a
# table, and printing it leaves a tiny table on a letter page with its grid
# lines gone. A screenshot of the page, trimmed to the table, reads better.
# Quick Look leaves out charts either way; their empty <img> is hidden.
sheet_snapshot() {
  out="$cache/$doc-p1.png"
  [ -f "$out" ] && return 0
  has qlmanage || return 1
  browser=$(chrome) || return 1
  work="$cache/$doc-work"
  rm -rf "$work"
  mkdir -p "$work"
  with_timeout 60 qlmanage -p -o "$work" "$src" >/dev/null 2>&1 || true
  ql=$(first "$work"/*.qlpreview || true)
  if [ -z "$ql" ] || [ ! -f "$ql/Preview.html" ]; then rm -rf "$work"; return 1; fi
  sed -e "s|</head>|<style>img{display:none!important} html,body{background:#fff!important} body{zoom:2}</style></head>|" \
    "$ql/Preview.html" > "$ql/shot.html"
  with_timeout 60 "$browser" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1400,3000 --user-data-dir="$work/profile" --screenshot="$work/shot.png" "file://$ql/shot.html" \
    >/dev/null 2>&1 || true
  if [ -f "$work/shot.png" ]; then
    if has magick || has convert; then
      im "$work/shot.png" -trim +repage -bordercolor white -border 40 "$out.part$$.png"
      mv "$out.part$$.png" "$out"
    else
      mv "$work/shot.png" "$out"
    fi
  fi
  rm -rf "$work"
  [ -f "$out" ]
}

# A page is blank when, rendered tiny in gray, almost no pixel is darker than
# white. The PGM header's own few bytes stay under the threshold.
is_blank_page() {
  dark=$(pdftoppm -f "$2" -l "$2" -r 8 -gray "$1" | od -An -v -tu1 | tr -s ' ' '\n' |
    awk '$1 != "" && $1 < 245 { n++ } END { print n + 0 }')
  [ "$dark" -lt 24 ]
}

# Quick Look pads each document page to a minimum height, so printing it can
# spill an empty page at the end. Keep pages up to the last one with ink.
drop_trailing_blank_pages() {
  file=$1
  dir=$2
  total=$(pdfinfo "$file" 2>/dev/null | awk '/^Pages:/ {print $2}')
  last=${total:-1}
  while [ "$last" -gt 1 ] && is_blank_page "$file" "$last"; do last=$((last - 1)); done
  [ "$last" -lt "${total:-1}" ] || return 0
  if [ "$last" -eq 1 ]; then
    pdfseparate -f 1 -l 1 "$file" "$dir/kept.pdf"
  else
    pdfseparate -f 1 -l "$last" "$file" "$dir/page-%d.pdf"
    n=1
    set --
    while [ "$n" -le "$last" ]; do set -- "$@" "$dir/page-$n.pdf"; n=$((n + 1)); done
    pdfunite "$@" "$dir/kept.pdf"
  fi
  mv "$dir/kept.pdf" "$file"
}

render_pdf() {
  need pdftoppm "poppler"
  pages=$(pdfinfo "$1" 2>/dev/null | awk '/^Pages:/ {print $2}')
  pages=${pages:-1}
  [ "$page" -gt "$pages" ] && page=$pages
  out="$cache/$doc-p$page.png"
  if [ ! -f "$out" ]; then
    pdftoppm -f "$page" -l "$page" -png -r 120 -singlefile "$1" "${out%.png}.part$$"
    mv "${out%.png}.part$$.png" "$out"
  fi
}

# Animated images: one PNG per frame, composited, with each frame's delay.
animate() {
  has magick || has convert || return 1
  count=$(im_identify "$src" 2>/dev/null | wc -l | tr -d ' ')
  [ "${count:-1}" -gt 1 ] || return 1
  dir="$cache/$doc-frames"
  list="$dir/frames.tsv"
  if [ ! -f "$list" ]; then
    rm -rf "$dir"
    mkdir -p "$dir"
    im "$src" -coalesce -resize '960x960>' "$dir/f-%04d.png"
    n=0
    for f in "$dir"/f-*.png; do n=$((n + 1)); done
    im_identify -format '%T\n' "$src" | head -n "$n" > "$dir/delays"
    for f in "$dir"/f-*.png; do printf '%s\n' "$f"; done | paste - "$dir/delays" |
      awk -F'\t' '{ d = $2 * 10; if (d < 20) d = 100; print $1 "\t" d }' > "$list"
  fi
  frames=$list
  out=$(head -1 "$list" | cut -f1)
}

# iWork files are zip archives holding a preview image of their first page.
iwork_preview() {
  [ -f "$out" ] && return 0
  if has qlmanage; then
    tmp="$cache/ql-$doc"
    mkdir -p "$tmp"
    with_timeout 60 qlmanage -t -s 1400 -o "$tmp" "$src" >/dev/null 2>&1 || true
    thumb=$(first "$tmp"/*.png || true)
    [ -n "$thumb" ] && { mv "$thumb" "$out"; rm -rf "$tmp"; return 0; }
    rm -rf "$tmp"
  fi
  has unzip || return 1
  for name in preview.jpg QuickLook/Thumbnail.jpg; do
    if unzip -p "$src" "$name" > "$cache/$doc-preview.jpg" 2>/dev/null && [ -s "$cache/$doc-preview.jpg" ]; then
      to_png "$cache/$doc-preview.jpg" "$out"
      rm -f "$cache/$doc-preview.jpg"
      return 0
    fi
  done
  rm -f "$cache/$doc-preview.jpg"
  return 1
}

case "$ext" in
  pdf)
    render_pdf "$src"
    ;;
  docx|doc|pptx|ppt|xlsx|xls|rtf|odt|odp|ods)
    if ! soffice_bin >/dev/null && case "$ext" in xlsx|xls|ods) true ;; *) false ;; esac && sheet_snapshot; then
      note="approximate layout (Quick Look, no charts); install LibreOffice for exact pages"
    elif office_to_pdf; then
      render_pdf "$cache/$doc.pdf"
      [ -f "$cache/$doc.approx" ] &&
        note="approximate layout (Quick Look); install LibreOffice for exact pages"
    elif has qlmanage; then
      out="$cache/$doc-p1.png"
      tmp="$cache/ql-$doc"
      mkdir -p "$tmp"
      with_timeout 60 qlmanage -t -s 1400 -o "$tmp" "$src" >/dev/null 2>&1 || true
      thumb=$(first "$tmp"/*.png || true)
      [ -n "$thumb" ] || { rm -rf "$tmp"; echo "no preview for .$ext" >&2; exit 3; }
      mv "$thumb" "$out"
      rm -rf "$tmp"
      note="first page only; install LibreOffice or Chrome for every page"
    else
      case "$ext" in
        pptx|ppt|odp) part=impress ;;
        xlsx|xls|ods) part=calc ;;
        *) part=writer ;;
      esac
      if has apt-get; then how="sudo apt install libreoffice-$part"
      elif has dnf; then how="sudo dnf install libreoffice-$part"
      elif has pacman; then how="sudo pacman -S libreoffice-fresh"
      elif has brew; then how="brew install --cask libreoffice"
      else how="install LibreOffice from libreoffice.org"
      fi
      echo "previewing .$ext needs LibreOffice; install it with: $how" >&2
      exit 4
    fi
    ;;
  gif|webp|apng)
    animate || to_png "$src" "$out"
    ;;
  png|jpg|jpeg|heic|heif|avif|tif|tiff|bmp|psd|tga|ico|icns|jp2|dng|cr2|cr3|nef|arw|raf|orf|rw2)
    to_png "$src" "$out"
    ;;
  svg|svgz)
    need rsvg-convert "librsvg"
    if [ ! -f "$out" ]; then
      rsvg-convert -w 1400 --keep-aspect-ratio -b white "$src" -o "$out.part$$"
      mv "$out.part$$" "$out"
    fi
    ;;
  key|pages|numbers)
    iwork_preview || { echo "no preview inside this .$ext file" >&2; exit 3; }
    note="first page only (iWork previews hold one page)"
    ;;
  *)
    echo ".$ext is not a supported type" >&2
    exit 3
    ;;
esac

# Keep every PNG under the 2 MiB a terminal accepts as inline bytes.
bytes=$(wc -c < "$out" | tr -d ' ')
if [ "$bytes" -gt 1900000 ] && [ "$frames" = - ]; then
  small="${out%.png}-s.png"
  if [ ! -f "$small" ]; then
    if has sips; then
      sips -s format png --resampleHeightWidthMax 1000 "$out" --out "${small%.png}.part$$.png" >/dev/null
    else
      im "$out" -resize '1000x1000>' "${small%.png}.part$$.png"
    fi
    mv "${small%.png}.part$$.png" "$small"
  fi
  out=$small
fi

[ "$pages" -eq 1 ] && page=1
size_of "$out"
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$out" "$w" "$h" "$pages" "$page" "$src" "$frames" "$note"
