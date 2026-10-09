# asset-viewer

Claude Code can read a PDF or a screenshot, but you can't see it in the conversation. This plugin draws the file inline, right under the tool call, so you and Claude are looking at the same slide.

It adds a `show` tool Claude can call whenever seeing a file would help (a plot it just made, the lecture slide it's explaining, page 4 of your report). Reading an image or PDF previews it automatically, and `/view <path>` opens a full viewer you can page through from the keyboard.

<!-- demo.gif goes here -->

## Install

```
/plugin install asset-viewer --marketplace matteo-psnt/asset-viewer
```

Answer `y` to add the marketplace, then pick the user scope. It loads in every session after that.

You need a terminal that speaks the kitty graphics protocol to see real pixels: [Ghostty](https://ghostty.org) or [kitty](https://sw.kovidgoyal.net/kitty/). Anywhere else you get a text placeholder naming the file and page.

It runs on macOS for now, since it leans on `sips`, `qlmanage` and the Chrome app bundle. Install the rest with Homebrew:

```
brew install poppler librsvg imagemagick
```

LibreOffice is optional. With it (`brew install --cask libreoffice`) Word, PowerPoint and Excel files convert with exact page breaks and equations. Without it they go through Quick Look and headless Chrome, which gets every page but only an approximate layout.

## What it shows

| Type | How |
| --- | --- |
| PDF | One page at a time, any page, with paging |
| Word, PowerPoint, Excel, RTF, OpenDocument | Every page or slide, converted to PDF once and cached |
| PNG, JPEG, HEIC, AVIF, WebP, TIFF, BMP, PSD, camera RAW | Converted with `sips` |
| Animated GIF and WebP | Plays frame by frame with the file's own timing |
| SVG | Rendered with `rsvg-convert` on white |
| Keynote, Pages, Numbers | First page only, since that's all the file's preview holds |

Text files (code, Markdown, CSV) aren't previewed because Claude Code already shows them. Anything else gets a one-line warning saying it can't be previewed and what can, and Claude gets the same message.

## Using it

Ask for it in plain words: "show me slide 12 of the Bayes nets lecture" or "open my report in the viewer". Claude picks the tool up on its own when a picture would help.

Inline previews have buttons to page (◀ ▶), replay an animation, open the viewer, or open the file in its own app. Clicking them needs a terminal that reports mouse clicks to Claude Code, which fullscreen mode does.

The viewer pane takes the keyboard while it's open:

| Key | Does |
| --- | --- |
| `n` / `p` | Next or previous page |
| `f` / `l` | First or last page |
| `g` | Grid of six thumbnails; `1` to `6` jumps to one |
| `o` | Open the file in its default app |
| `Esc` or `q` | Close |

There's also a "Go to page" field.

## How it works

`bin/render.sh` turns a file into a PNG (or a folder of frames) under `~/Library/Caches/asset-viewer`, keyed by path, modification time and page, so the second look at anything is instant. The page after the one you're on is rendered ahead of time.

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
```

The plugin API this is built on is in early access and may change between Claude Code releases.

## License

MIT
