# Privacy

file-viewer runs entirely on your computer. It has no server, and it never uploads your files or sends anything about them anywhere.

## What it reads

The files you or Claude ask it to preview, and only when asked. It also reads a few environment variables (`SSH_CONNECTION`, `SSH_TTY`, `WSL_DISTRO_NAME`, `TERM_PROGRAM`) to tell whether your terminal can read files from this computer. Those values stay on your machine.

## What it stores

Rendered pages of the files it previews, as PNG images in a local cache folder: `~/Library/Caches/claude-file-viewer` on macOS, `~/.cache/claude-file-viewer` on Linux. Anything unused for 30 days is deleted. You can delete the folder at any time.

It also saves which file and page each preview showed, inside Claude Code's own plugin storage on your machine, so a resumed conversation can draw the preview again.

## What it runs

Local programs that turn files into pictures: poppler, LibreOffice, ImageMagick or `sips`, `rsvg-convert`, and on macOS without LibreOffice, Quick Look and a headless Chrome. The open button hands the file to your system's default app. None of these are given anything except the file you asked to preview.

## Questions

Open an issue at https://github.com/matteo-psnt/file-viewer/issues.
