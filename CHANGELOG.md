# Changelog

## [0.1.1](https://github.com/matteo-psnt/file-viewer/compare/v0.1.0...v0.1.1) (2026-10-13)


### Bug Fixes

* **viewer:** fall back to Claude Code's focus handling if the focus hook fails ([1021ba0](https://github.com/matteo-psnt/file-viewer/commit/1021ba0f9cdf691c94f60f55e14b596b437dc271))
* **viewer:** pick the footer hint with a loop the directory's checker can read ([28ac24e](https://github.com/matteo-psnt/file-viewer/commit/28ac24e03e276c14b40184da75c79e00510e2386))

## 0.1.0 (2026-10-13)

First version.

- `preview` tool Claude calls to put a file inline under its tool row, as a card with the file's name, page count and controls to page, replay, open the viewer or open the file in its own app
- `/view <path> [page]` opens a viewer pane. Portrait pages get a thumbnail column on the left and landscape pages (slides) a strip underneath; `↑`/`↓` or `p`/`n` turn pages, `o` opens the file, `Esc` closes it, and the footer says when the pane doesn't have the keyboard
- PDFs; Word, PowerPoint and Excel through LibreOffice, or Quick Look and headless Chrome on macOS without it; images through `sips` or ImageMagick; SVG through `rsvg-convert`; the first page of Keynote, Pages and Numbers files
- Animated GIF and WebP playback
- Previews saved to the plugin store, so resumed conversations draw them again
- Linux support for the converter (ImageMagick, LibreOffice, XDG cache)
- Pictures sent as bytes over ssh, in Warp and under WSL, with an "Image transport" setting to override
- Where Claude Code won't draw pictures (Claude Agents sessions, tmux, terminals other than Ghostty and kitty), a notice saying why and what would fix it, with a button to open the file in its own app; Claude gets the same reason
- `scripts/doctor.sh` checks the installed converters and whether the terminal can show pictures, including the `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` setting iTerm2 and Rio need
- `demo/record.sh` records a demo from a scenario file in kitty, without typing into your screen
