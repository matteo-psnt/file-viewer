# Security

file-viewer turns files into pictures with programs already on your machine. A file can come from anywhere (a download, an email, a repo you just cloned), so the plugin treats what it previews as untrusted.

## What it does

- **Images are checked before they're decoded.** ImageMagick picks its decoder by what a file holds, not by its name, so a `.png` that really holds PostScript, PDF, SVG or one of ImageMagick's own script formats would reach Ghostscript or worse. The plugin reads each image's first bytes and refuses one that isn't the kind of image it's named for.
- **Huge images are refused before they're decoded.** A small file can claim to be enormous. Anything over 200 million pixels is refused before it's converted. ImageMagick reads only the header to tell; without it, macOS asks `sips`.
- **ImageMagick runs within limits.** Past 512 MiB of memory it spills to disk, and past 4 GiB of disk or 2 minutes it gives up. LibreOffice, Quick Look and the headless browser are stopped after 60 to 90 seconds.
- **The cache is private.** Rendered pages go in `~/Library/Caches/claude-file-viewer` on macOS or `~/.cache/claude-file-viewer` on Linux, a folder only your user can read.
- **A click opens only the file that was previewed.** The click layer sends no path; the plugin looks up which file that picture belongs to.
- **Nothing leaves your machine.** See [PRIVACY.md](PRIVACY.md).

## What it doesn't do

- PDFs, SVGs and Office files are handed to the programs made to read them: poppler, `rsvg-convert` and LibreOffice, which runs headless with a fresh profile at its default macro security. A flaw in one of those is a flaw in that program; keep them up to date.
- "Open in app" hands the file to your system's default app for its type, as double-clicking it would.

## Reporting a problem

Please report security issues privately, through [GitHub's private vulnerability reporting](https://github.com/matteo-psnt/file-viewer/security/advisories/new), rather than in a public issue.
