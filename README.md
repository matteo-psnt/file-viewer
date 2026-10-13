# file-viewer

A Claude Code plugin that shows PDFs, slides, spreadsheets and images inline, right in the conversation.

Claude Code can read a PDF or a screenshot, but you never see it. With this plugin Claude puts the page under its message, so when it talks about the chart on slide 12 you're looking at slide 12 too. You can also open any file yourself with `/view <path>`.

![Claude writes an SVG bar chart of a week of running and shows it inline](demo/demo.gif)

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

`sh bin/doctor.sh`, run from the plugin's folder, tells you what's missing and whether your terminal can show pictures.

## Terminals

Claude Code only draws pictures in [Ghostty](https://ghostty.org) and [kitty](https://sw.kovidgoyal.net/kitty/) 0.28+. iTerm2, Rio and Claude Agents sessions (`<<`) can show them too once you add this to `~/.claude/settings.json` and restart:

```json
{
  "env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" }
}
```

That applies everywhere you run Claude Code, so leave it out if you also use a terminal from the "No" rows below; you'd see stray characters there.

| Terminal | Pictures |
| --- | --- |
| Ghostty, kitty 0.28+ | Yes |
| iTerm2, Rio, Claude Agents sessions | With the setting above |
| Warp, WezTerm, Konsole, VS Code | No. They don't draw the placeholders Claude Code uses |
| Terminal.app, Alacritty, Windows Terminal, foot | No kitty graphics |
| tmux, screen | No. Claude Code doesn't send pictures through them |

Anywhere pictures can't show, you get a short notice saying why, with a button to open the file in its own app, and Claude describes the file in words instead. Over ssh and under WSL the plugin sends picture bytes instead of file paths; if that guess is wrong, change "Image transport" in `/config`.

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

## What it runs

Everything happens on your machine, and the plugin never uploads your files or sends them anywhere.

To turn a file into a picture it runs `bin/render.sh`, which calls the converters above (poppler, LibreOffice, `sips` or ImageMagick, `rsvg-convert`, and on macOS without LibreOffice, Quick Look and a headless Chrome printing the Quick Look page to PDF). It keeps the rendered pages in `~/Library/Caches/claude-file-viewer` (`~/.cache/claude-file-viewer` on Linux) and deletes them after 30 days unused. The open button runs `bin/open.sh`, which hands the file to `open`, `xdg-open` or `wslview`.

Its hooks:

- `session.start` registers the `preview` tool and `/view`, and draws a one-pixel picture once to learn whether this terminal can show pictures.
- `tool.call` answers the plugin's own `preview` tool; it doesn't stand in for any other tool.
- `command.run` answers `/view`.
- `ui.render` draws the preview card, the viewer pane and that one-pixel check.
- `ui.focus` turns the viewer's page when the arrow keys move between page numbers.
- `session.end` stops any animation still playing.

It reads `SSH_CONNECTION`, `SSH_TTY`, `WSL_DISTRO_NAME` and `TERM_PROGRAM` only to tell whether the terminal can read this machine's files, and sends none of them anywhere.

The plugin API this uses is in early access, so a Claude Code update can break it.

## License

MIT
