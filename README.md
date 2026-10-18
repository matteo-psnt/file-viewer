# file-viewer

[![CI](https://github.com/matteo-psnt/file-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/matteo-psnt/file-viewer/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/matteo-psnt/file-viewer)](https://github.com/matteo-psnt/file-viewer/releases)
[![License: MIT](https://img.shields.io/github/license/matteo-psnt/file-viewer)](LICENSE)

A Claude Code plugin that shows PDFs, slides, spreadsheets and images inline, right in the conversation.

Claude Code can read a PDF or a screenshot, but you never see it. With this plugin Claude puts the page under its message, so when it talks about the chart on slide 12 you're looking at slide 12 too. You can also open any file yourself with `/view <path>`.

![Claude shows slide 3 of a deck inline and answers from it, then /view opens the deck with a thumbnail strip](demo/demo.gif)

## Install

In Claude Code:

```
/plugin install file-viewer --marketplace matteo-psnt/file-viewer
```

Then install the converters. On macOS:

```
brew install poppler librsvg imagemagick
brew install --cask libreoffice
```

On Debian or Ubuntu:

```
sudo apt install poppler-utils librsvg2-bin imagemagick libheif1 unzip
sudo apt install libreoffice-writer libreoffice-impress libreoffice-calc libreoffice-math
```

LibreOffice is only for Word, PowerPoint and Excel. Without it, macOS falls back to Quick Look, which gets every page but only roughly the right layout, and Linux can't open them at all.

`sh scripts/doctor.sh`, run from the plugin's folder, tells you what's missing and whether your terminal can show pictures.

## Terminals

Claude Code only draws pictures in [Ghostty](https://ghostty.org) and [kitty](https://sw.kovidgoyal.net/kitty/) 0.28+. iTerm2, Rio and Claude Agents sessions (`<<`) can show them too once you add this to `~/.claude/settings.json` and restart:

```json
{
  "env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" }
}
```

That applies everywhere you run Claude Code, so leave it out if you also use a terminal from the "Blocks" rows below; you'd see stray characters there.

| Terminal | What you see |
| --- | --- |
| Ghostty, kitty 0.28+ | The real picture |
| iTerm2, Rio, Claude Agents sessions | The real picture with the setting above, blocks without it |
| Warp, WezTerm, Konsole, VS Code | Blocks. They don't draw the placeholders Claude Code uses |
| Terminal.app, Alacritty, Windows Terminal, foot | Blocks. No kitty graphics |
| tmux, screen | Blocks. Claude Code doesn't send pictures through them |

Where pictures can't show, the page is drawn in coloured block characters, four blocks to a character cell, with a line saying why and what would show the real picture. It's rough, but you can tell the slides apart and see the charts. Claude is told you see a block preview, so it describes small text and fine detail in words. The blocks come from ImageMagick, or from `sips` on macOS; with neither, you get a notice with a button to open the file in its own app.

Click a picture to open the file in its own app. Over ssh and under WSL the plugin sends picture bytes instead of file paths; if that guess is wrong, change "Image transport" in `/config`.

## What it opens

| Type | How |
| --- | --- |
| PDF | Any page, with paging |
| Word, PowerPoint, Excel, RTF, OpenDocument | Every page or slide, converted once and cached |
| PNG, JPEG, HEIC, AVIF, WebP, TIFF, BMP, PSD, camera RAW | `sips` on macOS, ImageMagick on Linux |
| Animated GIF and WebP | Plays with the file's own timing |
| SVG | Drawn with `rsvg-convert` |
| Keynote, Pages, Numbers | First page only |

Text files aren't previewed, since Claude Code already shows them.

## Using it

Ask in plain words, like "show me slide 12 of the lecture" or "open my report in the viewer". Claude also uses it on its own when a picture would help, say after it makes a chart.

In the viewer, `↑`/`↓` or `p`/`n` turn pages, `o` opens the file in its own app and `Esc` closes it. The keys work while the viewer has the keyboard; `ctrl+x tab` gives it back after you've typed in the prompt.

Everything runs on your machine, and the plugin never uploads your files. See [PRIVACY.md](PRIVACY.md).

The plugin API this uses is in early access, so a Claude Code update can break it.

## License

MIT
