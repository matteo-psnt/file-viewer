import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, ImageSource, PluginOptions, Register, Timer } from 'claude-code'

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

const previews = atom({ plugin: 'file-viewer', key: 'previews' } as const, {})
const viewer = atom({ plugin: 'file-viewer', key: 'viewer' } as const, null)

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
  const script = `${$.plugin.root}/bin/render.sh`
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
  await update($, previews, all => {
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
  const live = (await read($, previews))[id]
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
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Why pictures can't show, and what would make them show, in words for the
// person and for Claude. Claude Code turns pictures on only for Ghostty and
// kitty 0.28+, and says which check failed in its refusal, e.g. "no
// placeholder images (probe: graphics reply OK, terminal iTerm2 3.7.4)".
type Blocked = { why: string; fix: string }

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
          fix: `${terminal.split(' ')[0]} can show them. ${FORCE_FIX}`,
        }
      : { why: `Claude Code only shows pictures in Ghostty and kitty, and this is ${terminal}.`, fix: elsewhere }
  }
  if (deny.includes('no reply to the graphics query')) {
    return { why: `${terminal ?? 'This terminal'} doesn't support kitty graphics, which Claude Code draws pictures with.`, fix: elsewhere }
  }

  return { why: `Claude Code can't draw pictures here (${deny.replace(/^.*?: /, '')}).`, fix: elsewhere }
}

async function runProbe($: EngineInterface, attempt = 0) {
  if (probe.bandId === undefined) {
    if (attempt < 10) {
      $.clock.after(300, () => void runProbe($, attempt + 1))
    } else {
      probe.phase = 'done'
    }
    return
  }
  const site = { requestId: probe.bandId, key: 'probe' }
  const blitFile = () =>
    $.ui
      .blit({ ...site, source: { file: `${$.plugin.root}/bin/probe.png`, format: 'png' } })
      .catch((err: Error) => ({ deny: err.message }))
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
    const byBytes = await $.ui
      .blit({ ...site, source: { png: PROBE_BYTES } })
      .catch((err: Error) => ({ deny: err.message }))
    probe.verdict = byBytes.deny === undefined ? 'bytes' : 'none'
    if (probe.verdict === 'none') {
      const termProgram = await $.env.get('TERM_PROGRAM').catch(() => undefined)
      probe.blocked = explainDeny(byBytes.deny ?? byFile.deny ?? '', termProgram)
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

type Draw = { key: string; png: string; columns: number; rows: number; alt: string }

async function picture($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], draw: Draw) {
  if (e.surface !== 'terminal') {
    return null
  }
  const { Image } = $.ui.resolve(e)

  return (
    <Image key={draw.key} source={await imageSource($, draw.png)} columns={draw.columns} rows={draw.rows} alt={draw.alt} />
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
  await update($, viewer, () => ({ preview: p, thumbs: undefined }))
  const thumbs = await thumbsFor($, p)
  await update($, viewer, state => (state?.preview.png === p.png ? { preview: p, thumbs } : state))
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
  void $.process.run(['/bin/sh', `${$.plugin.root}/bin/open.sh`, source]).catch(() => undefined)
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

function unsupportedText(value: Extract<Preview, { kind: 'unsupported' }>) {
  return `Can't preview ${nameOf(value.source)}: ${value.reason}. Supported: ${SUPPORTED}.`
}

export const register: Register = (on, options: PluginOptions) => {
  transport = undefined
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

  on('tool.call', { tool: FULL_TOOL }, async ($, e) => {
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

    if (probe.blocked !== undefined) {
      return {
        result:
          `Not shown: ${probe.blocked.why} The user sees a notice saying so, with a button to open ` +
          `${input.path}${where} in their default app. If what it shows matters, describe it in words.`,
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
    if (e.props.isErrored || e.props.tool !== FULL_TOOL) {
      return next(e)
    }
    const value = await lookup($, e.requestId)
    if (value === undefined || e.surface !== 'terminal') {
      return next(e)
    }
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const id = e.requestId
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

    if (probe.blocked !== undefined) {
      return blockedNotice($, $.ui.resolve(e), value, probe.blocked, false)
    }

    const columns = (e.viewport?.columns ?? 100) - 10
    const box = boxFor(value, columns, value.size === 'small' ? 16 : 36, WIDTH[value.size ?? 'medium'])
    const cardWidth = Math.max(box.columns, 34) + 4
    const isPaged = value.pages > 1
    ensureAnimation($, id, 'pic', value.frames, INLINE_LOOPS, started)

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
          {await picture($, e, {
            key: 'pic',
            png: value.png,
            ...box,
            alt: `[${formatOf(value.source)}: ${nameOf(value.source)}${pageLabel(value)}. This terminal cannot draw images; try Ghostty or kitty]`,
          })}
        </Box>
        <Box flexDirection="row" gap={2}>
          {isPaged && <Button key="prev" label="◀" plain dimColor onPress={() => turnInline($, id, value, value.page - 1)} />}
          {isPaged && <Button key="next" label="▶" plain dimColor onPress={() => turnInline($, id, value, value.page + 1)} />}
          {value.frames && (
            <Button
              key="replay"
              label="↻ replay"
              plain
              dimColor
              onPress={() => playAnimation($, id, 'pic', value.frames ?? [], INLINE_LOOPS)}
            />
          )}
          <Button key="viewer" label="⤢ viewer" plain dimColor onPress={() => openViewer($, value)} />
          <Button key="open" label="↗ open" plain dimColor onPress={() => openExternally($, value.source)} />
        </Box>
      </Box>
    )
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
    if (!Number.isFinite(page) && ((await read($, viewer))?.preview.pages ?? 0) > 1) {
      return {}
    }
    const moved = await next(e)
    if (moved.deny !== undefined || !Number.isFinite(page)) {
      return moved
    }
    const state = await read($, viewer)
    if (state !== null && state.preview.page !== page) {
      void turnViewer($, state.preview, page).catch(() => undefined)
    }

    return moved
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const state: Viewer | null = await read($, viewer)
    if (state === null) {
      return <Text dimColor>Nothing open. Use /view &lt;path&gt;.</Text>
    }
    const p = state.preview
    if (probe.blocked !== undefined) {
      return blockedNotice($, $.ui.resolve(e), p, probe.blocked, true)
    }
    const isPaged = p.pages > 1
    // The pane's own frame is the only border; inside it a header row, the
    // page with its thumbnails, an optional note row and one footer row.
    const room = (e.props.scroll?.bodyRows ?? 0) > 0 ? e.props.scroll.bodyRows : Math.max(12, (e.viewport?.rows ?? 30) - 10)
    const bodyRows = Math.max(6, room - 4 - (p.note ? 1 : 0))
    const inner = Math.max(20, e.props.bodyColumns - 2)
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
    const page = (
      <Box flexDirection="column" flexGrow={isStrip ? 0 : 1} alignItems="center" justifyContent="center" height={isStrip ? box.rows : pageRows}>
        {await picture($, e, { key: 'page', png: p.png, ...box, alt: `[${nameOf(p.source)}${pageLabel(p)}]` })}
      </Box>
    )
    // Footer: the buttons always, then as much of the key hint as fits. The
    // keys only reach the pane while it holds the keyboard, so say how to get it.
    const buttonsWidth = (isPaged ? 18 : 0) + 14
    const hints = e.props.isFocused
      ? [isPaged ? '↑↓ pages · esc close' : '', 'esc close']
      : ['ctrl+x tab to use keys', 'ctrl+x tab']
    const hint = hints.find(h => h !== '' && buttonsWidth + 2 + h.length <= inner)
    ensureAnimation($, PANE, 'page', p.frames, Number.POSITIVE_INFINITY, started)

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
        {p.note && <Text dimColor italic wrap="truncate-end">ⓘ {p.note}</Text>}
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

  on('session.end', (_$, e, next) => {
    for (const id of [...animations.keys()]) {
      stopAnimation(id)
    }

    return next(e)
  })
}
