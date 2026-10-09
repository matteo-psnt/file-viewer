# Changelog

## 0.1.0 (unreleased)

First version.

- `show` tool Claude can call to put a file inline under its tool row
- Automatic previews when Claude reads an image or PDF
- `/view <path> [page]` and a viewer pane with a page sidebar, arrow-key paging and the layout note
- Inline previews drawn as a card with quiet text controls
- PDFs; Word, PowerPoint and Excel through LibreOffice or Quick Look plus headless Chrome; images through `sips`; SVG through `rsvg-convert`
- Animated GIF and WebP playback
- Previews saved to the plugin store so resumed conversations draw them again
- Linux support for the converter (ImageMagick, LibreOffice, XDG cache)
- Pictures sent as bytes over ssh, in Warp and under WSL, with an "Image transport" setting to override
- `bin/doctor.sh` to check installed converters and whether the terminal draws placeholder images
