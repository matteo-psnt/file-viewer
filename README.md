# asset-viewer

Claude Code can read a PDF or a screenshot, but you can't see it in the conversation. This plugin draws the file inline, right under the tool call, so you and Claude are looking at the same slide.

It adds a `show` tool Claude can call whenever seeing a file would help (a plot it just made, the lecture slide it's explaining, page 4 of your report). Reading an image or PDF previews it automatically, and `/view <path>` opens a full viewer you can page through from the keyboard.

<!-- demo.gif goes here -->

## Install

```
/plugin install asset-viewer --marketplace matteo-psnt/asset-viewer
```

Answer `y` to add the marketplace, then pick the user scope. It loads in every session after that.

You need a terminal Claude Code will draw pictures in. Out of the box that's [Ghostty](https://ghostty.org) and [kitty](https://sw.kovidgoyal.net/kitty/) 0.28 or newer; iTerm2 and Rio work too once you turn on `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` (see below). Anywhere else the preview is a short notice saying why pictures can't show there and what would fix it, with a button that opens the file in its own app. Run `sh bin/doctor.sh` from the plugin folder in the terminal you use Claude Code in, and it tells you what works and what to install.

On macOS, install the converters with Homebrew:

```
brew install poppler librsvg imagemagick
brew install --cask libreoffice
```

On Debian or Ubuntu:

```
sudo apt install poppler-utils librsvg2-bin imagemagick libheif1 unzip
sudo apt install libreoffice-writer libreoffice-impress libreoffice-calc libreoffice-math
```

> **Install LibreOffice if you open Word, PowerPoint or Excel files.** It's what turns them into exact pages. On Linux the plugin can't show them without it, and `libreoffice-math` is needed or Word equations come out blank. On macOS the plugin falls back to Quick Look and headless Chrome, which gets every page but only an approximate layout, and drops equations. The viewer says so under any page drawn that way.

## Where it works

Claude Code decides which terminals get pictures: it asks the terminal for its name and turns pictures on only for Ghostty and kitty 0.28+. Other terminals are turned away by name, even ones that could draw them, unless you turn that check off. Add this to `~/.claude/settings.json` and restart Claude Code:

```json
{
  "env": {
    "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1"
  }
}
```

The setting makes Claude Code draw pictures in any terminal and assume the terminal can read this computer's files. It applies to every terminal you run Claude Code in, and to Claude Agents sessions, so add it only if you use Ghostty, kitty, iTerm2 or Rio. In a terminal that can't draw pictures you'll see stray characters instead, and over ssh pictures won't load. To turn it on for one terminal only, set it in that terminal's profile or shell instead (`export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`). I've tested the rows marked tested on macOS; the rest come from each terminal's docs, so trust `doctor.sh` over them.

| Terminal | Pictures | Notes |
| --- | --- | --- |
| Ghostty | Yes | Tested |
| kitty 0.28+ | Yes | The protocol's home |
| iTerm2 | With the setting | Tested (3.7.4): turned away by name, draws correctly when forced |
| Rio | With the setting | Tested (0.5.28): turned away by name, draws correctly with the setting in settings.json |
| Warp | No | Tested: draws kitty images but shows the placeholders as raw characters |
| WezTerm, Konsole, VS Code | No | They draw kitty images but not the placeholders Claude Code uses |
| Terminal.app, Alacritty, Windows Terminal, foot | No | No kitty graphics (tested Terminal.app) |
| tmux, screen | No | Claude Code doesn't send pictures through them |

Sessions in Claude Agents (opened with `<<`) run in Claude Code's background daemon, where Claude Code turns pictures off by default. The same setting turns them back on: I tested it in a Claude Agents session in Ghostty and pictures draw as they do in a normal session. Without it, the preview is a notice naming Claude Agents as the reason.

Wherever pictures can't show, Claude is told so in the tool result, with the reason, and describes what matters in words instead.

Over ssh the terminal can't read files on the remote machine, so the plugin sends the picture's bytes instead. It does the same under WSL. If it guesses wrong for your setup, set "Image transport" to `bytes` or `file` in `/config`.

It runs on macOS and Linux. Native Windows isn't supported; WSL is, with a terminal from the "Yes" rows. The Claude desktop app and the VS Code extension don't show pictures, since the image element only exists in the terminal.

## What it shows

| Type | How |
| --- | --- |
| PDF | One page at a time, any page, with paging |
| Word, PowerPoint, Excel, RTF, OpenDocument | Every page or slide, converted to PDF once and cached |
| PNG, JPEG, HEIC, AVIF, WebP, TIFF, BMP, PSD, camera RAW | `sips` on macOS, ImageMagick on Linux (HEIC there needs libheif) |
| Animated GIF and WebP | Plays frame by frame with the file's own timing |
| SVG | Rendered with `rsvg-convert` on white |
| Keynote, Pages, Numbers | First page only, since that's all the file's preview holds |

Text files (code, Markdown, CSV) aren't previewed because Claude Code already shows them. Anything else gets a one-line warning saying it can't be previewed and what can, and Claude gets the same message.

## Using it

Ask for it in plain words: "show me slide 12 of the Bayes nets lecture" or "open my report in the viewer". Claude picks the tool up on its own when a picture would help.

Each preview is a small card with the file type, name and page count on top and a row of controls under the picture: ◀ ▶ to page, replay for animations, viewer to open the full viewer, and open to hand the file to its own app. Clicking them needs a terminal that reports mouse clicks to Claude Code, which fullscreen mode does.

The viewer pane shows the current page large with a sidebar of the pages around it, and takes the keyboard while it's open:

| Key | Does |
| --- | --- |
| `↑` / `↓` | Previous or next page (the focus walks the sidebar) |
| `p` / `n` | Previous or next page |
| `o` | Open the file in its default app |
| `Esc` | Close |

Clicking a page in the sidebar jumps to it.

## How it works

`bin/render.sh` turns a file into a PNG (or a folder of frames) under `~/Library/Caches/asset-viewer` (or `~/.cache/asset-viewer` on Linux), keyed by path, modification time and page, so the second look at anything is instant. The page after the one you're on is rendered ahead of time.

`hooks/register.tsx` is a Claude Code function-hooks module. It registers the tool, draws each preview by hooking the `ToolResult` row with an `Image` element, and animates GIFs by swapping that image's source with `$.ui.blit` on a timer. Previews are saved to the plugin store, so a resumed conversation draws them again. If the cache got cleared in between, the row re-renders the file.

## Developing

```
git clone https://github.com/matteo-psnt/asset-viewer
claude plugin marketplace add ./asset-viewer
claude plugin install asset-viewer@asset-viewer
```

A marketplace added from a folder is read from that folder, so edits show up after `/reload-plugins` with no reinstall. Check your changes with:

```
claude plugin validate .
claude plugin test .
sh tests/converter.sh
```

The first two check the hooks module against Claude Code itself. The last runs the converter over the files in `tests/fixtures`, and CI runs it on both macOS and Ubuntu.

The plugin API this is built on is in early access and may change between Claude Code releases.

## License

MIT
