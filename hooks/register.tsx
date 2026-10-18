import type { Elements, EngineInterface, ImageSource, PluginOptions, Register, RenderInput, Timer } from 'claude-code'

import type { Frame, Preview, Size, Thumb, Viewer } from '../types'

type ImagePreview = Extract<Preview, { kind: 'image' }>

const TOOL = 'preview'
const FULL_TOOL = 'mcp__file-viewer__preview'
const PANE = 'file-viewer'
const STORE_INDEX = 'previews:index'
const STORE_KEEP = 500
const KEEP = 100
const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|log|ipynb|py|ts|tsx|js|jsx|java|c|h|cpp|hpp|cc|rs|go|rb|sh|zsh|sql|tex|scala|kt|swift|hs)$/i
const SUPPORTED =
  'PDF; Word, PowerPoint and Excel (every page); images (png, jpg, heic, avif, webp, tiff, ' +
  'bmp, psd, camera raw); animated gif/webp; svg; Keynote, Pages and Numbers (first page)'
const WIDTH: Record<Size, number> = { small: 36, medium: 64, large: 100 }
const INLINE_LOOPS = 5
const SIDEBAR = 5
const FORMAT: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', doc: 'Word', rtf: 'Rich Text', odt: 'Document',
  pptx: 'PowerPoint', ppt: 'PowerPoint', odp: 'Presentation',
  xlsx: 'Excel', xls: 'Excel', ods: 'Spreadsheet',
  key: 'Keynote', pages: 'Pages', numbers: 'Numbers', svg: 'SVG', svgz: 'SVG',
  gif: 'GIF', webp: 'WebP', heic: 'HEIC', heif: 'HEIF',
}

// The plugin's two state values, read and written through $.state. A read
// made while a hook draws subscribes the drawing, so a write redraws it.
async function getPreviews($: EngineInterface): Promise<Record<string, Preview>> {
  return (await $.state.get({ plugin: 'file-viewer', key: 'previews' })).value ?? {}
}

async function updatePreviews($: EngineInterface, change: (all: Record<string, Preview>) => Record<string, Preview>) {
  for (;;) {
    const held = await $.state.get({ plugin: 'file-viewer', key: 'previews' })
    const written = await $.state.set({ plugin: 'file-viewer', key: 'previews' }, change(held.value ?? {}), {
      ifVersion: held.version,
    })
    if (written.isSet) {
      return
    }
  }
}

async function getViewer($: EngineInterface): Promise<Viewer | null> {
  return (await $.state.get({ plugin: 'file-viewer', key: 'viewer' })).value ?? null
}

async function updateViewer($: EngineInterface, change: (state: Viewer | null) => Viewer | null) {
  for (;;) {
    const held = await $.state.get({ plugin: 'file-viewer', key: 'viewer' })
    const written = await $.state.set({ plugin: 'file-viewer', key: 'viewer' }, change(held.value ?? null), {
      ifVersion: held.version,
    })
    if (written.isSet) {
      return
    }
  }
}

function nameOf(path: string) {
  return path.split('/').pop() ?? path
}

function extOf(path: string) {
  const name = nameOf(path)

  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
}

function formatOf(path: string) {
  const ext = extOf(path)

  return FORMAT[ext] ?? (ext === '' ? 'File' : ext.toUpperCase())
}

async function renderImage(
  $: EngineInterface,
  source: string,
  page: number,
): Promise<ImagePreview> {
  const script = `${$.plugin.root}/scripts/render.sh`
  const ran = await $.process.run(['/bin/sh', script, source, String(page)], {
    timeoutMs: 120_000,
  })
  if (ran.exitCode !== 0) {
    throw new Error(ran.stderr.trim() || `render.sh exited ${ran.exitCode}`)
  }
  const [png, width, height, pages, shown, absolute, frameList, note] = ran.stdout.trim().split('\t')
  if (!png) {
    throw new Error('render.sh printed no picture')
  }
  let frames: Frame[] | undefined
  if (frameList && frameList !== '-') {
    frames = (await $.fs.read(frameList))
      .trim()
      .split('\n')
      .map(line => {
        const [file, ms] = line.split('\t')

        return { png: file ?? png, ms: Number(ms) || 100 }
      })
  }

  return {
    kind: 'image',
    source: absolute || source,
    png,
    width: Number(width),
    height: Number(height),
    pages: Number(pages),
    page: Number(shown),
    ...(frames ? { frames } : {}),
    ...(note && note !== '-' ? { note } : {}),
  }
}

async function preview($: EngineInterface, source: string, page: number): Promise<Preview> {
  if (TEXT.test(source)) {
    return {
      kind: 'unsupported',
      source,
      reason: `.${extOf(source)} is a text file, which Claude Code already shows`,
    }
  }
  $.ui.status(`file-viewer: preparing ${nameOf(source)}…`)
  try {
    return await renderImage($, source, page)
  } catch (err) {
    return { kind: 'unsupported', source, reason: (err as Error).message }
  } finally {
    $.ui.status(undefined)
  }
}

// The session's state draws this session; the store keeps each preview so a
// resumed conversation draws its old rows again.
async function remember($: EngineInterface, id: string, value: Preview) {
  await updatePreviews($, all => {
    const kept = Object.entries(all).filter(([key]) => key !== id).slice(-(KEEP - 1))

    return { ...Object.fromEntries(kept), [id]: value }
  })
  await $.store.set(`preview:${id}`, value)
  const index = ((await $.store.get(STORE_INDEX)) as string[] | undefined) ?? []
  const next = [...index.filter(key => key !== id), id]
  for (const old of next.slice(0, Math.max(0, next.length - STORE_KEEP))) {
    await $.store.delete(`preview:${old}`)
  }
  await $.store.set(STORE_INDEX, next.slice(-STORE_KEEP))
}

async function lookup($: EngineInterface, id: string): Promise<Preview | undefined> {
  const live = (await getPreviews($))[id]
  if (live !== undefined) {
    return live
  }

  return (await $.store.get(`preview:${id}`)) as Preview | undefined
}

// A preview whose PNG the cache lost is rendered again, outside the draw.
const rerendering = new Set<string>()

function restore($: EngineInterface, id: string, value: ImagePreview) {
  if (rerendering.has(id)) {
    return
  }
  rerendering.add(id)
  $.clock.after(0, () => {
    void renderImage($, value.source, value.page)
      .then(fresh => remember($, id, { ...fresh, caption: value.caption, size: value.size }))
      // Only a missing file is permanent; a timeout or a missing tool may pass.
      .catch(async () => {
        if (!(await $.fs.exists(value.source))) {
          await remember($, id, { kind: 'unsupported', source: value.source, reason: 'the file is no longer there' })
        }
      })
      .finally(() => rerendering.delete(id))
  })
}

// Terminal cells are about twice as tall as wide, so halve the row count.
function boxFor(
  size: { width: number; height: number },
  columnsAvailable: number,
  maxRows: number,
  width: number,
) {
  let columns = Math.max(1, Math.min(width, columnsAvailable, 255))
  let rows = Math.round((columns * size.height) / size.width / 2)
  if (rows > maxRows) {
    columns = Math.max(1, Math.round((columns * maxRows) / rows))
    rows = maxRows
  }

  return { columns, rows: Math.max(1, Math.min(rows, 255)) }
}

function clampPage(p: ImagePreview, page: number) {
  return Math.min(Math.max(1, page), p.pages)
}

function pageLabel(p: ImagePreview) {
  return p.pages > 1 ? ` · page ${p.page}/${p.pages}` : ''
}

// How a picture reaches the terminal: by path, which the terminal reads itself,
// or as bytes in the drawing. A terminal on another machine (ssh), Warp and
// a Windows terminal in front of WSL cannot read this machine's files.
type Transport = 'file' | 'bytes'
let transport: Transport | undefined
let transportSetting: unknown = 'auto'

// What the terminal showed when the plugin drew a one-cell picture in the band
// above the prompt at session start and swapped it: Claude Code refuses a swap
// onto a picture it is drawing as alt text, and says why.
type Probe = {
  phase: 'idle' | 'drawing' | 'done'
  bandId?: string
  verdict?: Transport | 'none'
  blocked?: Blocked
}
const probe: Probe = { phase: 'idle' }
const PROBE_BYTES =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

// Why pictures can't show, and what would make them show, in words for the
// person and for Claude. Claude Code turns pictures on only for Ghostty and
// kitty 0.28+, and says which check failed in its refusal, e.g. "no
// placeholder images (probe: graphics reply OK, terminal iTerm2 3.7.4)".
type Blocked = { why: string; fix: string; isForced?: true }

const TERMINAL_NAMES: Record<string, string> = {
  Apple_Terminal: 'Terminal.app',
  WarpTerminal: 'Warp',
  vscode: 'VS Code',
  'iTerm.app': 'iTerm2',
}
// Terminals that draw Claude Code's pictures once it is told to (tested).
const FORCE_FIX =
  'To turn them on, add "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" to env in ~/.claude/settings.json.'
const FORCEABLE = /^(iTerm2|Rio)\b/

function explainDeny(deny: string, termProgram: string | undefined): Blocked {
  const elsewhere = 'Open Claude Code in Ghostty or kitty to see pictures.'
  if (deny.includes('bg worker')) {
    return {
      why: 'This session runs in Claude Agents, where Claude Code turns pictures off by default.',
      fix: FORCE_FIX,
    }
  }
  if (deny.includes('tmux or screen')) {
    return {
      why: "This session runs inside tmux or screen, and Claude Code doesn't send pictures through them.",
      fix: 'Run claude outside tmux, in Ghostty or kitty.',
    }
  }
  const named = deny.match(/, terminal ([^)]+)\)/)?.[1]?.trim()
  const terminal = named ?? (termProgram === undefined ? undefined : (TERMINAL_NAMES[termProgram] ?? termProgram))
  if (terminal?.startsWith('kitty')) {
    return { why: `Claude Code shows pictures in kitty 0.28 and newer, and this is ${terminal}.`, fix: 'Update kitty.' }
  }
  if (deny.includes('graphics reply') && terminal !== undefined) {
    return FORCEABLE.test(terminal)
      ? {
          why: `Claude Code only turns pictures on in Ghostty and kitty, and this is ${terminal}.`,
          fix: terminal.startsWith('iTerm2')
            ? `iTerm2 can show them. ${FORCE_FIX} Or, for this plugin only: python3 -m pip install iterm2, then turn on iTerm2 > Settings > General > Magic > Enable Python API.`
            : `${terminal.split(' ')[0]} can show them. ${FORCE_FIX}`,
        }
      : { why: `Claude Code only shows pictures in Ghostty and kitty, and this is ${terminal}.`, fix: elsewhere }
  }
  if (deny.includes('no reply to the graphics query')) {
    return { why: `${terminal ?? 'This terminal'} doesn't support kitty graphics, which Claude Code draws pictures with.`, fix: elsewhere }
  }

  return { why: `Claude Code can't draw pictures here (${deny.replace(/^.*?: /, '')}).`, fix: elsewhere }
}

async function runProbe($: EngineInterface, attempt = 0) {
  // Asked for blocks: where the probe passes but nothing shows (tmux), or to
  // record them.
  if ((await $.env.get('FILE_VIEWER_BLOCKS').catch(() => undefined)) === '1') {
    probe.blocked = {
      why: 'Block previews are turned on (FILE_VIEWER_BLOCKS).',
      fix: 'Remove FILE_VIEWER_BLOCKS from env for real pictures.',
      isForced: true,
    }
    probe.verdict = 'none'
    probe.phase = 'done'
    $.ui.invalidate('ui.render')
    return
  }
  if (probe.bandId === undefined) {
    if (attempt < 10) {
      $.clock.after(300, () => void runProbe($, attempt + 1))
    } else {
      probe.phase = 'done'
    }
    return
  }
  const site = { requestId: probe.bandId, key: 'probe' }
  const probeFile = `${$.plugin.root}/assets/probe.png`
  const blitFile = () =>
    $.ui.blit({ ...site, source: { file: probeFile, format: 'png' } }).catch((err: Error) => ({ deny: err.message }))
  // The first file swap can come back as "not yet said ... blit again" while
  // the terminal answers whether it reads local files; that's a wait, not a no.
  let byFile = await blitFile()
  for (let tries = 0; tries < 5 && byFile.deny?.includes('blit again'); tries++) {
    await new Promise<void>(resolve => $.clock.after(300, resolve))
    byFile = await blitFile()
  }
  if (byFile.deny === undefined) {
    probe.verdict = 'file'
  } else {
    const byBytes = await $.ui.blit({ ...site, source: { png: PROBE_BYTES } }).catch((err: Error) => ({ deny: err.message }))
    probe.verdict = byBytes.deny === undefined ? 'bytes' : 'none'
    if (probe.verdict === 'none') {
      const termProgram = await $.env.get('TERM_PROGRAM').catch(() => undefined)
      probe.blocked = explainDeny(byBytes.deny ?? byFile.deny ?? '', termProgram)
      if (termProgram === 'iTerm.app') {
        await startOverlay($)
      }
    }
  }
  probe.phase = 'done'
  transport = undefined
  $.ui.invalidate('ui.render')
}

async function transportOf($: EngineInterface): Promise<Transport> {
  if (transport !== undefined) {
    return transport
  }
  if (transportSetting === 'file' || transportSetting === 'bytes') {
    transport = transportSetting
  } else if (probe.verdict === 'file' || probe.verdict === 'bytes') {
    transport = probe.verdict
  } else {
    try {
      const remote = (await $.env.get('SSH_CONNECTION')) ?? (await $.env.get('SSH_TTY'))
      const isWarp = (await $.env.get('TERM_PROGRAM')) === 'WarpTerminal'
      const isWsl = (await $.env.get('WSL_DISTRO_NAME')) !== undefined
      transport = remote !== undefined || isWarp || isWsl ? 'bytes' : 'file'
    } catch {
      transport = 'file'
    }
  }

  return transport
}

const bytesOf = new Map<string, string>()

async function imageSource($: EngineInterface, png: string): Promise<ImageSource> {
  if ((await transportOf($)) === 'file') {
    return { file: png, format: 'png' }
  }
  let base64 = bytesOf.get(png)
  if (base64 === undefined) {
    base64 = (await $.fs.read(png, { as: 'bytes' })).base64
    bytesOf.set(png, base64)
    const oldest = bytesOf.keys().next().value
    if (bytesOf.size > 64 && oldest !== undefined) {
      bytesOf.delete(oldest)
    }
  }

  return { png: base64 }
}

// Where the terminal can't draw pictures, a page is drawn in block characters:
// each cell holds 2 by 2 pixels in two colours, the quadrant glyph picking which
// pixels take the foreground. Bit 0 is top left, 1 top right, 2 bottom left, 3
// bottom right.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
const cellsOf = new Map<string, string>()

type Rgb = [number, number, number]

// The pixels of an uncompressed 24- or 32-bit BMP, as cells.sh writes it, top
// row first; transparent pixels go on white.
function readBmp(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0) !== 0x424d) {
    throw new Error('not a BMP')
  }
  const start = view.getUint32(10, true)
  const header = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const tall = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  if (bits !== 24 && bits !== 32) {
    throw new Error(`a ${bits}-bit BMP`)
  }
  // 32-bit pixels say where each channel is; 24-bit ones are blue, green, red.
  const masks = bits === 32 && header >= 56 && view.getUint32(30, true) === 3
    ? [0, 4, 8, 12].map(at => view.getUint32(54 + at, true))
    : [0xff0000, 0xff00, 0xff, bits === 32 ? 0xff000000 : 0]
  const channel = (value: number, mask: number) =>
    mask === 0 ? 255 : (((value & mask) >>> 0) / mask) * 255
  const height = Math.abs(tall)
  const stride = Math.ceil((width * bits) / 32) * 4
  const at = (x: number, y: number): Rgb => {
    const row = tall < 0 ? y : height - 1 - y
    const offset = start + row * stride + x * (bits / 8)
    const value = bits === 32
      ? view.getUint32(offset, true)
      : view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
    const alpha = masks[3] === 0 ? 1 : channel(value, masks[3]!) / 255
    const blend = (mask: number) => Math.round(channel(value, mask) * alpha + 255 * (1 - alpha))

    return [blend(masks[0]!), blend(masks[1]!), blend(masks[2]!)]
  }

  return { width, height, at }
}

// One cell from its four pixels: the split into two colours that strays least.
function quadrant(pixels: Rgb[]): [number, number, number] {
  const pack = ([r, g, b]: Rgb) => (r << 16) | (g << 8) | b
  let best = { error: Number.POSITIVE_INFINITY, mask: 15, fg: pixels[0]!, bg: pixels[0]! }
  // A split and its complement are one split; bit 3 stays background.
  for (let mask = 0; mask < 8; mask++) {
    const groups: [Rgb[], Rgb[]] = [[], []]
    pixels.forEach((pixel, i) => groups[(mask >> i) & 1 ? 0 : 1].push(pixel))
    const mean = (group: Rgb[]): Rgb =>
      [0, 1, 2].map(c => group.reduce((sum, p) => sum + p[c]!, 0) / Math.max(1, group.length)) as Rgb
    const fg = mean(groups[0])
    const bg = mean(groups[1])
    let error = 0
    pixels.forEach((pixel, i) => {
      const centre = (mask >> i) & 1 ? fg : bg
      error += pixel.reduce((sum, v, c) => sum + (v - centre[c]!) ** 2, 0)
    })
    if (error < best.error) {
      best = { error, mask: mask === 0 ? 15 : mask, fg: mask === 0 ? bg : fg, bg }
    }
  }
  const round = (rgb: Rgb) => rgb.map(Math.round) as Rgb

  return [QUADRANTS.codePointAt(best.mask)!, pack(round(best.fg)), pack(round(best.bg))]
}

// In iTerm2, scripts/iterm_overlay.py draws the real picture over a block
// preview. It finds each box by a marker hidden in the first cells of every
// row: a check glyph, three for the box's id and one for the row, braille
// because nothing else draws it, in the cell's own colour so it doesn't show.
// Each glyph mixes in the row, so when a box moves every marker cell changes
// and Claude Code paints them all again. After inline-images (MIT).
const MARKER_CELLS = 5
const BRAILLE_BLANK = 0x2800
let overlay: 'off' | 'starting' | 'live' | 'failed' = 'off'
const registered = new Set<string>()

function markerOf(png: string, columns: number, rows: number) {
  let hash = 0x811c9dc5
  for (const char of `${png}:${columns}:${rows}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  }

  return [hash & 0xff, (hash >>> 8) & 0xff, (hash >>> 16) & 0xff]
}

function markerGlyphs(marker: number[], row: number) {
  const r = row & 0xff
  const shuffled = marker.map((byte, i) => (byte + r * 37 + (i + 1) * 11) & 0xff)
  const check = (marker[0]! + marker[1]! + marker[2]! + r * 37 + 0x5a) & 0xff

  return [check, ...shuffled, r].map(value => BRAILLE_BLANK + value)
}

// Whether block previews carry markers: the overlay runs or is starting.
function isMarked(columns: number) {
  return (overlay === 'starting' || overlay === 'live') && columns >= MARKER_CELLS
}

// A Raster's cells for a page in a box of columns by rows.
async function blockCells($: EngineInterface, png: string, columns: number, rows: number) {
  const marker = isMarked(columns) ? markerOf(png, columns, rows) : undefined
  const key = `${png}\t${columns}x${rows}${marker ? '\tm' : ''}`
  const known = cellsOf.get(key)
  if (known !== undefined) {
    return known
  }
  const ran = await $.process.run(
    ['/bin/sh', `${$.plugin.root}/scripts/cells.sh`, png, String(columns * 2), String(rows * 2)],
    { timeoutMs: 30_000 },
  )
  if (ran.exitCode !== 0) {
    throw new Error(ran.stderr.trim() || `cells.sh exited ${ran.exitCode}`)
  }
  const bmp = readBmp(Uint8Array.fromBase64((await $.fs.read(ran.stdout.trim(), { as: 'bytes' })).base64))
  const out = new DataView(new ArrayBuffer(columns * rows * 12))
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = Math.min(column * 2, bmp.width - 2)
      const y = Math.min(row * 2, bmp.height - 2)
      const cell = quadrant([bmp.at(x, y), bmp.at(x + 1, y), bmp.at(x, y + 1), bmp.at(x + 1, y + 1)])
      if (marker !== undefined && column < MARKER_CELLS) {
        cell[0] = markerGlyphs(marker, row)[column]!
        cell[1] = cell[2]
      }
      cell.forEach((word, i) => out.setUint32((row * columns + column) * 12 + i * 4, word, true))
    }
  }
  const cells = new Uint8Array(out.buffer).toBase64()
  if (marker !== undefined) {
    await registerOverlay($, png, marker, columns, rows, out)
  }
  cellsOf.set(key, cells)
  const oldest = cellsOf.keys().next().value
  if (cellsOf.size > 64 && oldest !== undefined) {
    cellsOf.delete(oldest)
  }

  return cells
}

// What the overlay draws for a marker, and every glyph of the box, so it can
// tell its box repainted from something else drawn over it. Kept in the
// cache's overlays folder, which the overlay reads.
async function registerOverlay(
  $: EngineInterface,
  png: string,
  marker: number[],
  columns: number,
  rows: number,
  cells: DataView,
) {
  const hex = marker.map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (registered.has(hex)) {
    return
  }
  let glyphs = ''
  for (let at = 0; at < columns * rows; at++) {
    glyphs += String.fromCodePoint(cells.getUint32(at * 12, true))
  }
  const folder = png.slice(0, png.lastIndexOf('/'))
  await $.fs.write(`${folder}/overlays/${hex}.json`, JSON.stringify({ png, columns, rows, glyphs }))
  registered.add(hex)
}

// Starts the iTerm2 overlay for this session's life. It needs the iterm2
// Python module and iTerm2's Python API; without them the previews stay
// blocks, and only the debug log says why.
async function startOverlay($: EngineInterface) {
  const session = await $.env.get('ITERM_SESSION_ID').catch(() => undefined)
  if (overlay !== 'off' || session === undefined) {
    return
  }
  overlay = 'starting'
  $.ui.invalidate('ui.render')
  void (async () => {
    let buffer = ''
    let reason = ''
    try {
      for await (const piece of $.process.spawn({ argv: ['python3', `${$.plugin.root}/scripts/iterm_overlay.py`, '--session', session] })) {
        if (piece.stream === 'stderr') {
          reason = piece.text.trim().split('\n').pop() ?? reason
          continue
        }
        buffer += piece.text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const message = (() => {
            try {
              return JSON.parse(line) as { ready?: boolean; error?: string }
            } catch {
              return {}
            }
          })()
          if (message.ready === true) {
            overlay = 'live'
            $.ui.invalidate('ui.render')
          } else if (message.error !== undefined) {
            reason = message.error
          }
        }
      }
    } catch (err) {
      reason = (err as Error).message
    }
    overlay = 'failed'
    cellsOf.clear()
    $.ui.invalidate('ui.render')
    $.ui.log(`file-viewer: block previews only in iTerm2: ${reason || 'the overlay stopped'}`, { to: 'debug' })
  })()
}

// Whether pictures go out as block characters: the probe found the terminal
// can't draw them.
function isBlocks() {
  return probe.blocked !== undefined
}

type Draw = { key: string; png: string; columns: number; rows: number; alt: string }

// The picture, or null on another surface, or where blocks were wanted and
// could not be made (no converter).
async function picture($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], draw: Draw) {
  if (e.surface !== 'terminal') {
    return null
  }
  const { Image, Raster } = $.ui.resolve(e)
  if (isBlocks()) {
    const cells = await blockCells($, draw.png, draw.columns, draw.rows).catch(() => undefined)

    return cells === undefined ? null : <Raster key={draw.key} columns={draw.columns} rows={draw.rows} cells={cells} />
  }

  return (
    <Image key={draw.key} source={await imageSource($, draw.png)} columns={draw.columns} rows={draw.rows} alt={draw.alt} />
  )
}

// What a click on a picture opens, by the drawing and the click layer's key:
// the layer's message names no path, so nothing it sends picks the file.
const clickTargets = new Map<string, string>()

// A picture under a layer that opens `source` in its own app when clicked.
function clickable(
  { Box, Client }: Elements['terminal'],
  requestId: string,
  key: string,
  node: ReturnType<Elements['terminal']['Box']>,
  box: { columns: number; rows: number },
  source: string,
) {
  const layer = `click:${key}`
  clickTargets.set(`${requestId}\u0000${layer}`, source)
  if (clickTargets.size > 500) {
    clickTargets.delete(clickTargets.keys().next().value!)
  }

  // The layer comes first: drawn after a Raster, its empty box would paint over it.
  return (
    <Box key={`wrap:${key}`} width={box.columns} height={box.rows}>
      <Box position="absolute" top={0} left={0} width={box.columns} height={box.rows}>
        <Client key={layer} module="./click.tsx" width={box.columns} height={box.rows} />
      </Box>
      {node}
    </Box>
  )
}

// Render the page after the one just shown so the next press is instant.
function prefetch($: EngineInterface, p: ImagePreview) {
  if (p.page < p.pages) {
    void renderImage($, p.source, p.page + 1).catch(() => undefined)
  }
}

// Animation: a keyed Image whose source a timer swaps frame by frame.
type Animation = { timer?: Timer; frame: number; loops: number; misses: number }
const animations = new Map<string, Animation>()
// Animations started this load: a redraw must not restart one that finished.
const started = new Set<string>()

function stopAnimation(id: string) {
  animations.get(id)?.timer?.cancel()
  animations.delete(id)
}

function playAnimation(
  $: EngineInterface,
  requestId: string,
  key: string,
  frames: Frame[],
  maxLoops: number,
) {
  const id = `${requestId}/${key}`
  stopAnimation(id)
  const show = async (frame: Frame) => $.ui.blit({ requestId, key, source: await imageSource($, frame.png) })
  const run: Animation = { frame: 0, loops: 0, misses: 0 }
  animations.set(id, run)
  const step = async () => {
    if (animations.get(id) !== run) {
      return
    }
    run.frame = (run.frame + 1) % frames.length
    if (run.frame === 0 && ++run.loops >= maxLoops) {
      await show(frames[0]!).catch(() => undefined)
      animations.delete(id)
      run.loops = -1

      return
    }
    const shown = await show(frames[run.frame]!).catch((err: Error) => ({ deny: err.message }))
    // A few misses while the Image mounts are expected; more means it is gone.
    if (shown.deny !== undefined && ++run.misses > 3) {
      animations.delete(id)

      return
    }
    run.timer = $.clock.after(frames[run.frame]!.ms, () => void step())
  }
  run.timer = $.clock.after(frames[0]!.ms, () => void step())
}

function ensureAnimation(
  $: EngineInterface,
  requestId: string,
  key: string,
  frames: Frame[] | undefined,
  maxLoops: number,
  started: Set<string>,
) {
  const id = `${requestId}/${key}`
  if (frames === undefined || frames.length < 2 || animations.has(id) || started.has(id)) {
    return
  }
  started.add(id)
  playAnimation($, requestId, key, frames, maxLoops)
}

// The pages around `page` that the viewer's sidebar shows, centred on it.
function sidebarPages(page: number, pages: number) {
  const first = Math.min(Math.max(1, page - Math.floor(SIDEBAR / 2)), Math.max(1, pages - SIDEBAR + 1))

  return Array.from({ length: Math.min(SIDEBAR, pages) }, (_, i) => first + i)
}

async function thumbsFor($: EngineInterface, p: ImagePreview): Promise<Thumb[] | undefined> {
  if (p.pages < 2) {
    return undefined
  }

  // A page that fails to render is left out rather than failing the viewer.
  const thumbs = await Promise.all(
    sidebarPages(p.page, p.pages).map(async page => {
      const one = page === p.page ? p : await renderImage($, p.source, page).catch(() => undefined)

      return one && { page, png: one.png, width: one.width, height: one.height }
    }),
  )

  return thumbs.filter(t => t !== undefined)
}

async function showInViewer($: EngineInterface, p: ImagePreview) {
  // The pane's animation belongs to what it showed before; this one starts afresh.
  stopAnimation(`${PANE}/page`)
  started.delete(`${PANE}/page`)
  await updateViewer($, () => ({ preview: p, thumbs: undefined }))
  const thumbs = await thumbsFor($, p)
  await updateViewer($, state => (state?.preview.png === p.png ? { preview: p, thumbs } : state))
  // Keep the focus ring on the current page so the next arrow moves one page.
  if (p.pages > 1) {
    void $.ui.focus({ requestId: PANE, key: `thumb:${p.page}` }).catch(() => undefined)
  }
}

async function openViewer($: EngineInterface, value: ImagePreview) {
  await $.ui.open({ id: PANE, title: `${formatOf(value.source)} · ${nameOf(value.source)}`, focus: true, closeOnEscape: true })
  await showInViewer($, value)
}

async function turnInline($: EngineInterface, id: string, p: ImagePreview, page: number) {
  const next = await renderImage($, p.source, clampPage(p, page))
  await remember($, id, { ...next, caption: p.caption, size: p.size })
  prefetch($, next)
}

async function turnViewer($: EngineInterface, p: ImagePreview, page: number) {
  if (clampPage(p, page) === p.page) {
    return
  }
  await showInViewer($, await renderImage($, p.source, clampPage(p, page)))
}

function openExternally($: EngineInterface, source: string) {
  void $.process.run(['/bin/sh', `${$.plugin.root}/scripts/open.sh`, source]).catch(() => undefined)
}

// Drawn in place of the picture where the terminal can't show one: why, what
// would fix it, and the file one press away in its own app.
function blockedNotice(
  $: EngineInterface,
  { Box, Text, Button }: Elements['terminal'],
  value: ImagePreview,
  blocked: Blocked,
  inPane: boolean,
) {
  // The pane has a border of its own; a second one costs rows a short window lacks.
  const frame = inPane ? {} : ({ borderStyle: 'round', borderColor: 'warning', paddingX: 1 } as const)

  return (
    <Box flexDirection="column" {...frame}>
      <Text wrap="truncate-middle">
        <Text color="warning" bold>Can't show pictures here</Text> · {formatOf(value.source)} {nameOf(value.source)}
        {pageLabel(value)}
      </Text>
      {value.caption && <Text dimColor italic wrap="truncate-end">{value.caption}</Text>}
      <Text>{blocked.why}</Text>
      <Text>{blocked.fix}</Text>
      <Box flexDirection="row" gap={2}>
        <Button key="open" label="↗ open in app" hotkey={inPane ? 'o' : undefined} onPress={() => openExternally($, value.source)} />
        {inPane && <Text dimColor>esc close</Text>}
      </Box>
    </Box>
  )
}

function footerHints(isFocused: boolean, isPaged: boolean) {
  if (!isFocused) {
    return ['ctrl+x tab to use keys', 'ctrl+x tab']
  }

  return [isPaged ? '↑↓ pages · esc close' : '', 'esc close']
}

// The desktop app, the editor and the mobile app draw an Svg as an image but
// have no Image element, so a page reaches them as a JPEG inside an SVG,
// kept under the 128 KiB they take.
async function remoteSvg($: EngineInterface, value: ImagePreview) {
  const script = `${$.plugin.root}/scripts/jpeg.sh`
  const ran = await $.process.run(['/bin/sh', script, value.png, '800'])
  const jpeg = (await $.fs.read(ran.stdout.trim(), { as: 'bytes' })).base64

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${value.width} ${value.height}">` +
    `<image href="data:image/jpeg;base64,${jpeg}" width="${value.width}" height="${value.height}"/></svg>`
  )
}

function unsupportedText(value: Extract<Preview, { kind: 'unsupported' }>) {
  return `Can't preview ${nameOf(value.source)}: ${value.reason}. Supported: ${SUPPORTED}.`
}

// A preview's card: the picture with its name and buttons, or a notice. `id`
// is where the preview is remembered; `at` prefixes the keys, so one result
// can hold several cards. Null leaves the result as Claude Code draws it.
async function previewCard($: EngineInterface, e: RenderInput<'ToolResult'>, id: string, value: Preview, at = '') {
  if (e.surface !== 'terminal') {
    if (value.kind !== 'image' || !(await $.fs.exists(value.png))) {
      return null
    }
    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    const isPaged = value.pages > 1

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text bold>{formatOf(value.source)}</Text> {nameOf(value.source)}
          {pageLabel(value)}
        </Text>
        {value.caption && <Text dimColor italic>{value.caption}</Text>}
        <Svg
          source={await remoteSvg($, value)}
          alt={`${nameOf(value.source)}${pageLabel(value)}`}
          width={Math.min(640, value.width)}
        />
        <Box flexDirection="row" gap={2}>
          {isPaged && <Button key={`${at}prev`} label="◀ prev" onPress={() => turnInline($, id, value, value.page - 1)} />}
          {isPaged && <Button key={`${at}next`} label="next ▶" onPress={() => turnInline($, id, value, value.page + 1)} />}
          <Button key={`${at}open`} label="open in app" onPress={() => openExternally($, value.source)} />
        </Box>
      </Box>
    )
  }
  const { Box, Text, Button, Image } = $.ui.resolve(e)
  if (value.kind === 'image' && !(await $.fs.exists(value.png))) {
    restore($, id, value)

    return <Text dimColor>Preparing preview of {nameOf(value.source)}…</Text>
  }

  if (value.kind === 'unsupported') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text>
          <Text color="warning" bold>Can't preview</Text> {nameOf(value.source)}
        </Text>
        <Text dimColor>{value.reason}</Text>
        <Text dimColor>Supported: {SUPPORTED}</Text>
      </Box>
    )
  }

  if (value.isTest) {
    const bytes = (await $.fs.read(value.png, { as: 'bytes' })).base64
    const cell = boxFor(value, 22, 8, 22)
    const variants = [
      { key: 'A', label: 'A plain · file', framed: false, source: { file: value.png, format: 'png' } as const },
      { key: 'B', label: 'B plain · bytes', framed: false, source: { png: bytes } },
      { key: 'C', label: 'C card · file', framed: true, source: { file: value.png, format: 'png' } as const },
      { key: 'D', label: 'D card · bytes', framed: true, source: { png: bytes } },
    ]

    return (
      <Box flexDirection="column">
        <Text dimColor>
          file-viewer test · probe: {probe.verdict ?? probe.phase}
          {probe.blocked ? ` (${probe.blocked.why})` : ''} · transport: {await transportOf($)}
        </Text>
        <Box flexDirection="row" gap={2}>
          {variants.map(v => (
            <Box
              key={`v${v.key}`}
              flexDirection="column"
              {...(v.framed ? { borderStyle: 'round', borderColor: 'subtle', paddingX: 1 } : {})}
            >
              <Text dimColor>{v.label}</Text>
              <Image key={`img${v.key}`} source={v.source} columns={cell.columns} rows={cell.rows} alt={`[${v.key}: placeholder]`} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  const columns = (e.viewport?.columns ?? 100) - 10
  const box = boxFor(value, columns, value.size === 'small' ? 16 : 36, WIDTH[value.size ?? 'medium'])
  const shown = await picture($, e, {
    key: `${at}pic`,
    png: value.png,
    ...box,
    alt: `[${formatOf(value.source)}: ${nameOf(value.source)}${pageLabel(value)}. This terminal cannot draw images; try Ghostty or kitty]`,
  })
  if (probe.blocked !== undefined && shown === null) {
    return blockedNotice($, $.ui.resolve(e), value, probe.blocked, false)
  }
  const cardWidth = Math.max(box.columns, 34) + 4
  const isPaged = value.pages > 1
  const isAnimated = value.frames !== undefined && !isBlocks()
  if (isAnimated) {
    ensureAnimation($, id, `${at}pic`, value.frames, INLINE_LOOPS, started)
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} width={cardWidth}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text wrap="truncate-middle">
          <Text color="claude" bold>{formatOf(value.source)}</Text> {nameOf(value.source)}
        </Text>
        {isPaged && <Text dimColor>{value.page} / {value.pages}</Text>}
      </Box>
      {value.caption && <Text dimColor italic wrap="truncate-end">{value.caption}</Text>}
      <Box justifyContent="center">
        {shown && clickable($.ui.resolve(e), e.requestId, `${at}pic`, shown, box, value.source)}
      </Box>
      {probe.blocked && !probe.blocked.isForced && overlay !== 'live' && (
        <Text dimColor wrap="wrap">Block preview: {probe.blocked.why} {probe.blocked.fix}</Text>
      )}
      <Box flexDirection="row" gap={2}>
        {isPaged && <Button key={`${at}prev`} label="◀" plain dimColor onPress={() => turnInline($, id, value, value.page - 1)} />}
        {isPaged && <Button key={`${at}next`} label="▶" plain dimColor onPress={() => turnInline($, id, value, value.page + 1)} />}
        {isAnimated && (
          <Button
            key={`${at}replay`}
            label="↻ replay"
            plain
            dimColor
            onPress={() => playAnimation($, id, `${at}pic`, value.frames ?? [], INLINE_LOOPS)}
          />
        )}
        <Button key={`${at}viewer`} label="⤢ viewer" plain dimColor onPress={() => openViewer($, value)} />
        <Button key={`${at}open`} label="↗ open" plain dimColor onPress={() => openExternally($, value.source)} />
      </Box>
    </Box>
  )
}

// Files Claude hands over with these tools get a card under the delivery, so a
// PDF or a deck it made shows its first page where it arrives.
const DELIVERY_TOOLS = new Set(['SendUserFile', 'SendUserMessage'])
const DELIVERED_MAX = 4
const PREVIEWABLE =
  /\.(pdf|docx?|pptx?|xlsx?|rtf|odt|odp|ods|gif|webp|apng|png|jpe?g|heic|heif|avif|tiff?|bmp|psd|tga|ico|icns|jp2|dng|cr2|cr3|nef|arw|raf|orf|rw2|svgz?|key|pages|numbers)$/i
const delivering = new Set<string>()

function deliveredFiles(output: unknown): string[] {
  const { display, attachments } = (output ?? {}) as { display?: unknown; attachments?: unknown }
  // "attach" asks for a download card only.
  if (display === 'attach' || !Array.isArray(attachments)) {
    return []
  }

  return attachments
    .map(attachment => (attachment as { path?: unknown } | null)?.path)
    .filter((path): path is string => typeof path === 'string' && PREVIEWABLE.test(path))
    .slice(0, DELIVERED_MAX)
}

// A card for each file a delivery holds, or none for a delivery of none.
async function deliveredCards($: EngineInterface, e: RenderInput<'ToolResult', 'terminal'>) {
  const files = deliveredFiles(e.props.output)
  const { Text } = $.ui.resolve(e)

  return Promise.all(
    files.map(async (path, i) => {
      const id = `${e.requestId}#${i}`
      const value = await lookup($, id)
      if (value === undefined) {
        // Rendered outside the draw; remembering it draws this row again.
        if (!delivering.has(id)) {
          delivering.add(id)
          $.clock.after(0, () => {
            void preview($, path, 1)
              .then(made => remember($, id, made))
              .finally(() => delivering.delete(id))
          })
        }

        return <Text key={`f${i}:wait`} dimColor>Preparing preview of {nameOf(path)}…</Text>
      }

      // A file that won't preview stays the download it was sent as.
      return value.kind === 'unsupported' ? null : await previewCard($, e, id, value, `f${i}:`)
    }),
  )
}

export const register: Register = (on, options: PluginOptions) => {
  transport = undefined
  overlay = 'off'
  Object.assign(probe, { phase: 'idle', bandId: undefined, verdict: undefined, blocked: undefined })
  transportSetting = options.transport ?? 'auto'
  started.clear()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    probe.phase = 'drawing'
    probe.bandId = undefined
    $.ui.invalidate('ui.render')
    $.clock.after(400, () => void runProbe($))
    await $.tool.register({
      name: TOOL,
      description:
        'Show the user a visual file inline in the terminal. Use it when seeing the file ' +
        'helps: a plot or diagram you made, a slide or page you are explaining, a ' +
        'screenshot, a document. Supports ' + SUPPORTED + '. Multi-page files show one ' +
        'page with prev/next buttons; mode "viewer" opens a paging viewer with a thumbnail ' +
        'sidebar. Animated GIFs play. Text files are not previewed (Claude Code already shows ' +
        'them). The user sees it; you do not. If a type is not supported the result says so.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or working-directory-relative path' },
          page: { type: 'integer', minimum: 1, description: 'Page or slide, 1-based; default 1' },
          caption: { type: 'string', description: 'One short line shown above the preview, in plain words (e.g. "Sightings by species")' },
          size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Default medium' },
          mode: {
            type: 'string',
            enum: ['inline', 'viewer', 'test'],
            description:
              'inline (default): in the conversation. viewer: open the paging viewer pane. ' +
              'test: draw the file four ways side by side to debug a terminal that shows placeholders',
          },
        },
        required: ['path'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'view',
      description: 'Open a file in the file viewer: /view <path> [page]',
      argumentHint: '<path> [page]',
    })

    return result
  })

  on('command.run', { command: 'view' }, async ($, e) => {
    const match = e.args.trim().match(/^(.*?)(?:\s+(\d+))?$/)
    const path = (match?.[1] ?? '').replace(/^["']|["']$/g, '')
    if (path === '') {
      return { text: 'Usage: /view <path> [page]' }
    }
    const value = await preview($, path, Number(match?.[2] ?? 1))
    if (value.kind === 'unsupported') {
      return { text: unsupportedText(value) }
    }
    await openViewer($, value)

    return { text: `Opened ${nameOf(value.source)} in the viewer.` }
  })

  on('tool.call', { tool: 'mcp__file-viewer__preview' }, async ($, e) => {
    const input = e as unknown as {
      path: string
      page?: number
      caption?: string
      size?: Size
      mode?: 'inline' | 'viewer' | 'test'
    }
    const value = await preview($, input.path, input.page ?? 1)
    if (value.kind === 'unsupported') {
      await remember($, e.tool_use_id, { ...value, caption: input.caption })

      return { result: unsupportedText(value) }
    }
    const shown: ImagePreview = {
      ...value,
      caption: input.caption,
      size: input.size,
      ...(input.mode === 'test' ? { isTest: true } : {}),
    }
    await remember($, e.tool_use_id, shown)
    if (input.mode === 'viewer') {
      await openViewer($, shown)
    } else {
      prefetch($, shown)
    }
    const where = shown.pages > 1 ? ` (page ${shown.page} of ${shown.pages})` : ''
    const how = input.mode === 'viewer' ? ' in the viewer pane' : ''
    const note = shown.note ? ` Note: ${shown.note}.` : ''

    if (probe.blocked !== undefined && overlay !== 'live') {
      return {
        result:
          `Shown to the user${how} as a rough preview in coloured block characters: ${input.path}${where}. ` +
          `${probe.blocked.why} Fine detail and small text are lost, so if they matter, describe them in words.`,
      }
    }
    return { result: `Shown to the user${how}: ${input.path}${where}.${note}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (probe.phase !== 'drawing' || e.surface !== 'terminal') {
      return next(e)
    }
    probe.bandId = e.requestId
    const { Image } = $.ui.resolve(e)

    return <Image key="probe" source={{ png: PROBE_BYTES }} columns={1} rows={1} alt=" " />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!e.props.isErrored && DELIVERY_TOOLS.has(e.props.tool) && e.surface === 'terminal') {
      const cards = await deliveredCards($, e)
      if (cards.length === 0) {
        return next(e)
      }
      const { Box } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {await next(e)}
          {cards}
        </Box>
      )
    }
    if (e.props.isErrored || e.props.tool !== FULL_TOOL) {
      return next(e)
    }
    const value = await lookup($, e.requestId)
    if (value === undefined) {
      return next(e)
    }
    return (await previewCard($, e, e.requestId, value)) ?? next(e)
  })

  // Arrow keys walk the focus ring over the thumbnails' page buttons; landing
  // on one turns to that page. A plugin can only bind letters and digits, so
  // this is how the arrows page at all.
  on('ui.focus', async ($, e, next) => {
    const page = e.element?.startsWith('thumb:') ? Number(e.element.slice(6)) : Number.NaN
    if (e.requestId !== PANE || e.origin.kind !== 'person') {
      return next(e)
    }
    // Past the first or last thumbnail the ring would walk on to the footer
    // buttons or the close mark, and the arrows would stop paging. Keep it.
    if (!Number.isFinite(page) && ((await getViewer($))?.preview.pages ?? 0) > 1) {
      return {}
    }
    const moved = await next(e)
    if (moved.deny !== undefined || !Number.isFinite(page)) {
      return moved
    }
    const state = await getViewer($)
    if (state !== null && state.preview.page !== page) {
      void turnViewer($, state.preview, page).catch(() => undefined)
    }

    return moved
  })

  on('ui.render', { component: 'Pane', requestId: 'file-viewer' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      const remote = await getViewer($)
      if (remote === null || !(await $.fs.exists(remote.preview.png))) {
        return next(e)
      }
      const { Box, Text, Svg, Button } = $.ui.resolve(e)
      const p = remote.preview
      const isPaged = p.pages > 1

      return (
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>{formatOf(p.source)}</Text> {nameOf(p.source)}
            {pageLabel(p)}
          </Text>
          <Svg source={await remoteSvg($, p)} alt={`${nameOf(p.source)}${pageLabel(p)}`} />
          <Box flexDirection="row" gap={2}>
            {isPaged && <Button key="prev" label="◀ prev" onPress={() => turnViewer($, p, p.page - 1).catch(() => undefined)} />}
            {isPaged && <Button key="next" label="next ▶" onPress={() => turnViewer($, p, p.page + 1).catch(() => undefined)} />}
            <Button key="open" label="open in app" onPress={() => openExternally($, p.source)} />
          </Box>
        </Box>
      )
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const state: Viewer | null = await getViewer($)
    if (state === null) {
      return <Text dimColor>Nothing open. Use /view &lt;path&gt;.</Text>
    }
    const p = state.preview
    const isPaged = p.pages > 1
    // The pane's own frame is the only border; inside it a header row, the
    // page with its thumbnails, optional note rows and one footer row.
    const room = (e.props.scroll?.bodyRows ?? 0) > 0 ? e.props.scroll.bodyRows : Math.max(12, (e.viewport?.rows ?? 30) - 10)
    const inner = Math.max(20, e.props.bodyColumns - 2)
    // The notes wrap rather than losing their end ("install LibreOffice…").
    const blocksNote = probe.blocked && !probe.blocked.isForced && overlay !== 'live' ? `Block preview: ${probe.blocked.why} ${probe.blocked.fix}` : undefined
    const noteRows = [p.note, blocksNote].reduce((sum, note) => sum + (note ? Math.ceil((note.length + 2) / inner) : 0), 0)
    const bodyRows = Math.max(6, room - 4 - noteRows)
    const thumbs = state.thumbs ?? []
    const count = Math.max(1, thumbs.length)
    // Landscape pages (slides) leave room underneath, so their thumbnails go in
    // a strip below; portrait pages (documents) leave room beside, so a column.
    const isStrip = isPaged && p.width > p.height
    const thumbColumns = isStrip
      ? Math.min(24, Math.floor((inner - 2 * (count - 1)) / count))
      : Math.min(22, Math.max(6, Math.floor(inner / 6)))
    const thumbRows = isStrip
      ? Math.max(2, Math.min(7, Math.floor(bodyRows / 5)))
      : Math.max(2, Math.floor((bodyRows - (count - 1)) / count))
    const sideWidth = isPaged && !isStrip ? 2 + 1 + 1 + thumbColumns : 0
    const pageRows = isStrip ? bodyRows - thumbRows - 3 : bodyRows
    const box = boxFor(p, inner - sideWidth - (sideWidth > 0 ? 2 : 0), pageRows, 255)
    const thumbPictures = new Map(
      await Promise.all(
        thumbs.map(async t => {
          const size = boxFor(t, thumbColumns, thumbRows, thumbColumns)

          return [
            t.page,
            { size, node: await picture($, e, { key: `img:${t.page}`, png: t.png, ...size, alt: `page ${t.page}` }) },
          ] as const
        }),
      ),
    )
    const go = (page: number) => turnViewer($, p, page).catch(() => undefined)
    const pageButton = (page: number, isCurrent: boolean) => (
      <Button key={`thumb:${page}`} label={`${page}`} plain dimColor={!isCurrent} onPress={() => go(page)} />
    )
    const pagePicture = await picture($, e, { key: 'page', png: p.png, ...box, alt: `[${nameOf(p.source)}${pageLabel(p)}]` })
    if (probe.blocked !== undefined && pagePicture === null) {
      return blockedNotice($, $.ui.resolve(e), p, probe.blocked, true)
    }
    const page = (
      <Box flexDirection="column" flexGrow={isStrip ? 0 : 1} alignItems="center" justifyContent="center" height={isStrip ? box.rows : pageRows}>
        {pagePicture && clickable($.ui.resolve(e), PANE, 'page', pagePicture, box, p.source)}
      </Box>
    )
    // Footer: the buttons always, then as much of the key hint as fits. The
    // keys only reach the pane while it holds the keyboard, so say how to get it.
    const buttonsWidth = (isPaged ? 18 : 0) + 14
    const hints = footerHints(e.props.isFocused, isPaged)
    let hint = ''
    for (const candidate of hints) {
      if (candidate !== '' && buttonsWidth + 2 + candidate.length <= inner) {
        hint = candidate
        break
      }
    }
    if (!isBlocks()) {
      ensureAnimation($, PANE, 'page', p.frames, Number.POSITIVE_INFINITY, started)
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" gap={2} marginBottom={1}>
          <Text wrap="truncate-middle">
            <Text color="claude" bold>{formatOf(p.source)}</Text> {nameOf(p.source)}
          </Text>
          <Text dimColor>{isPaged ? `page ${p.page} of ${p.pages}` : `${p.width}×${p.height}`}</Text>
        </Box>
        {isStrip ? (
          <Box flexDirection="column" height={bodyRows} justifyContent="center">
            {page}
            <Box flexDirection="row" justifyContent="center" gap={2} marginTop={1}>
              {thumbs.map(t => {
                const isCurrent = t.page === p.page
                const thumb = thumbPictures.get(t.page)
                const columns = thumb?.size.columns ?? thumbColumns

                return (
                  <Box key={`side:${t.page}`} flexDirection="column" alignItems="center" width={thumbColumns}>
                    {thumb?.node}
                    <Text color="claude">{(isCurrent ? '━' : ' ').repeat(columns)}</Text>
                    <Box width={columns} justifyContent="center">
                      {pageButton(t.page, isCurrent)}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" gap={2} height={bodyRows}>
            {isPaged && (
              <Box flexDirection="column" width={sideWidth} justifyContent="center">
                {thumbs.map((t, i) => {
                  const isCurrent = t.page === p.page
                  const thumb = thumbPictures.get(t.page)
                  const rows = thumb?.size.rows ?? thumbRows

                  return (
                    <Box key={`side:${t.page}`} flexDirection="row" marginBottom={i < thumbs.length - 1 ? 1 : 0}>
                      <Box width={2} justifyContent="flex-end" marginRight={1}>
                        {pageButton(t.page, isCurrent)}
                      </Box>
                      <Text color="claude">{Array.from({ length: rows }, () => (isCurrent ? '▌' : ' ')).join('\n')}</Text>
                      {thumb?.node}
                    </Box>
                  )
                })}
              </Box>
            )}
            {page}
          </Box>
        )}
        {p.note && <Text dimColor italic>ⓘ {p.note}</Text>}
        {blocksNote && <Text dimColor italic>ⓘ {blocksNote}</Text>}
        <Box flexDirection="row" justifyContent="space-between" gap={2} marginTop={1}>
          <Box flexDirection="row" gap={2}>
            {isPaged && <Button key="prev" label="prev" hotkey="p" plain dimColor onPress={() => go(p.page - 1)} />}
            {isPaged && <Button key="next" label="next" hotkey="n" plain dimColor onPress={() => go(p.page + 1)} />}
            <Button key="open" label="open in app" hotkey="o" plain dimColor onPress={() => openExternally($, p.source)} />
          </Box>
          {hint && <Text dimColor>{hint}</Text>}
        </Box>
      </Box>
    )
  })

  // A click on a picture opens its file in the file's own app.
  on('ui.message', async ($, e, next) => {
    const source = clickTargets.get(`${e.requestId}\u0000${e.element}`)
    if ((e.data as { open?: unknown } | undefined)?.open === true && source !== undefined) {
      openExternally($, source)
    }

    return next(e)
  })

  on('session.end', ($, e, next) => {
    for (const id of [...animations.keys()]) {
      stopAnimation(id)
    }

    return next(e)
  })
}
