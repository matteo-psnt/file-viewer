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
# Claude Code places pictures with kitty's Unicode placeholders (U=1), which some
# terminals that answer the query above still don't draw. There's no query for
# it, so draw one the same way and ask.
def placeholder_test():
    import zlib, struct
    w, h = 32, 16
    raw = b"".join(b"\x00" + b"".join(bytes((230, 60, 60)) if x < w // 2 else bytes((60, 90, 230)) for x in range(w)) for _ in range(h))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    image = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    payload = base64.b64encode(image).decode()
    image_id = 77
    cols, rows_ = 4, 1
    diacritics = ["\u0305", "\u030d", "\u030e", "\u0310"]
    out = f"\x1b_Ga=T,q=2,f=100,t=d,U=1,i={image_id},c={cols},r={rows_};{payload}\x1b\\"
    line = "".join("\U0010EEEE" + diacritics[0] + diacritics[c] for c in range(cols))
    out += f"    \x1b[38;5;{image_id}m{line}\x1b[39m\n"
    sys.stdout.write(out)
    sys.stdout.flush()
    try:
        answer = open("/dev/tty").readline().strip().lower()
    except Exception:
        answer = ""
    sys.stdout.write(f"\x1b_Ga=d,d=I,i={image_id},q=2\x1b\\")
    return answer.startswith("y")

if "i=31;OK" not in text:
    print(f"  {red} No kitty graphics: previews show as a text placeholder.")
    print("    Ghostty and kitty draw them.")
else:
    print("  Do you see a small red and blue bar here? [y/n] ", end="")
    if not placeholder_test():
        print(f"  {red} This terminal answers kitty graphics queries but doesn't draw the")
        print("    placeholder images Claude Code uses (Warp, WezTerm, Konsole and VS Code are")
        print("    known cases). Previews show as a text placeholder.")
    elif "i=32;OK" in text:
        print(f"  {green} Kitty graphics with placeholders and local files. Everything works.")
    else:
        print(f"  {yellow} Kitty graphics, but this terminal won't read local files.")
        print("    asset-viewer sends bytes when it detects ssh, Warp or WSL; elsewhere set its")
        print('    "Image transport" option to "bytes" in /config.')
EOF
