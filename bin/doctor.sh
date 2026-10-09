#!/bin/sh
# doctor.sh: checks what asset-viewer can preview on this machine and whether
# this terminal can draw the pictures. Run it in the terminal you use Claude Code in.
os=$(uname -s)

has() { command -v "$1" >/dev/null 2>&1; }
if [ -t 1 ]; then g='\033[32m' r='\033[31m' y='\033[33m' x='\033[0m'; else g='' r='' y='' x=''; fi
ok() { printf "  ${g}✓${x} %s\n" "$1"; }
no() { printf "  ${r}✗${x} %s\n" "$1"; }
meh() { printf "  ${y}~${x} %s\n" "$1"; }

has_office() {
  has soffice || has libreoffice || [ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]
}
chrome() {
  for app in "Google Chrome" "Chromium" "Microsoft Edge" "Brave Browser"; do
    [ -x "/Applications/$app.app/Contents/MacOS/$app" ] && return 0
  done
  return 1
}

if [ "$os" = Darwin ]; then
  install="brew install"
  office_hint="brew install --cask libreoffice"
else
  install="sudo apt install"
  office_hint="sudo apt install libreoffice-writer libreoffice-impress libreoffice-calc libreoffice-math"
fi

echo "Formats on $os"
if has pdftoppm && has pdfinfo; then ok "PDF"; else no "PDF: $install poppler$([ "$os" = Darwin ] || echo -utils)"; fi

if has_office; then
  ok "Word, PowerPoint, Excel: every page, exact layout (LibreOffice)"
elif has qlmanage && chrome; then
  meh "Word, PowerPoint, Excel: every page, approximate layout. For exact: $office_hint"
elif has qlmanage; then
  meh "Word, PowerPoint, Excel: first page only. For every page: $office_hint"
else
  no "Word, PowerPoint, Excel: $office_hint"
fi

if has sips; then
  ok "Images: png, jpg, heic, avif, webp, tiff, psd, camera raw (sips)"
elif has magick || has convert; then
  ok "Images (ImageMagick; HEIC also needs libheif)"
else
  no "Images: $install imagemagick"
fi

if has magick || has convert; then ok "Animated GIF and WebP"; else no "Animated GIF and WebP: $install imagemagick"; fi
if has rsvg-convert; then ok "SVG"; else no "SVG: $install librsvg$([ "$os" = Darwin ] || echo 2-bin)"; fi
if has qlmanage || has unzip; then ok "Keynote, Pages, Numbers (first page)"; else no "Keynote, Pages, Numbers: $install unzip"; fi

echo
echo "Terminal (${TERM_PROGRAM:-unknown}, TERM=${TERM:-unset})"
if [ -n "$TMUX" ]; then
  no "Inside tmux: Claude Code can't draw pictures through tmux. Run it outside tmux."
fi
if [ -n "$SSH_CONNECTION$SSH_TTY" ]; then
  meh "Over ssh: pictures are sent as bytes, since your terminal can't read this machine's files."
fi
if ! has python3 || [ ! -t 0 ]; then
  meh "Can't probe the terminal (needs python3 and an interactive terminal)."
  exit 0
fi

python3 - <<'EOF'
import os, sys, termios, tty, select, time, tempfile, base64

png = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
fd, path = tempfile.mkstemp(suffix=".png")
os.write(fd, png)
os.close(fd)
tty_fd = os.open("/dev/tty", os.O_RDWR)
old = termios.tcgetattr(tty_fd)
tty.setraw(tty_fd)
buf = b""
try:
    os.write(tty_fd, (
        "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\"
        f"\x1b_Gi=32,a=q,t=f,f=100;{base64.b64encode(path.encode()).decode()}\x1b\\"
        "\x1b[c"
    ).encode())
    end = time.time() + 2
    while time.time() < end:
        ready, _, _ = select.select([tty_fd], [], [], 0.1)
        if ready:
            buf += os.read(tty_fd, 4096)
            if b"\x1b[?" in buf and buf.rstrip().endswith(b"c"):
                break
finally:
    termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
    os.unlink(path)

text = buf.decode(errors="replace")
color = sys.stdout.isatty()
green, red, yellow = (
    ("\033[32m✓\033[0m", "\033[31m✗\033[0m", "\033[33m~\033[0m") if color else ("✓", "✗", "~")
)
if "i=31;OK" not in text:
    print(f"  {red} No kitty graphics: previews show as a text placeholder.")
    print("    Ghostty, kitty and Warp draw them.")
elif "i=32;OK" in text:
    print(f"  {green} Kitty graphics, including local files. Everything works.")
else:
    print(f"  {yellow} Kitty graphics, but this terminal won't read local files.")
    print("    asset-viewer sends bytes when it detects ssh, Warp or WSL; elsewhere set its")
    print('    "Image transport" option to "bytes" in /config.')
EOF
