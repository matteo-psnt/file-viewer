import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, PluginOptions, Register, Timer } from 'claude-code'

import type { Frame, GridCell, Preview, Size, Viewer } from '../types'

type ImagePreview = Extract<Preview, { kind: 'image' }>

const TOOL = 'show'
const FULL_TOOL = 'mcp__asset-viewer__show'
const PANE = 'asset-viewer'
const STORE_INDEX = 'previews:index'
const STORE_KEEP = 500
const KEEP = 100
const AUTO = /\.(png|jpe?g|gif|heic|heif|avif|webp|tiff?|bmp|svgz?|pdf)$/i
const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|log|ipynb|py|ts|tsx|js|jsx|java|c|h|cpp|hpp|cc|rs|go|rb|sh|zsh|sql|tex|scala|kt|swift|hs)$/i
const SUPPORTED =
  'PDF; Word, PowerPoint and Excel (every page); images (png, jpg, heic, avif, webp, tiff, ' +
  'bmp, psd, camera raw); animated gif/webp; svg; Keynote, Pages and Numbers (first page)'
const WIDTH: Record<Size, number> = { small: 36, medium: 64, large: 100 }
const INLINE_LOOPS = 5
const GRID = 6
const FORMAT: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', doc: 'Word', rtf: 'Rich Text', odt: 'Document',
  pptx: 'PowerPoint', ppt: 'PowerPoint', odp: 'Presentation',
  xlsx: 'Excel', xls: 'Excel', ods: 'Spreadsheet',
  key: 'Keynote', pages: 'Pages', numbers: 'Numbers', svg: 'SVG', svgz: 'SVG',
  gif: 'GIF', webp: 'WebP', heic: 'HEIC', heif: 'HEIF',
}

const previews = atom({ plugin: 'asset-viewer', key: 'previews' } as const, {})
const viewer = atom({ plugin: 'asset-viewer', key: 'viewer' } as const, null)

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
  $.ui.status(`asset-viewer: preparing ${nameOf(source)}…`)
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
      .catch(() => remember($, id, { kind: 'unsupported', source: value.source, reason: 'the file is no longer there' }))
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

function firstPage(pages: string | undefined) {
  const n = Number.parseInt(pages ?? '', 10)

  return Number.isFinite(n) && n > 0 ? n : 1
}

function clampPage(p: ImagePreview, page: number) {
  return Math.min(Math.max(1, page), p.pages)
}

function pageLabel(p: ImagePreview) {
  return p.pages > 1 ? ` · page ${p.page}/${p.pages}` : ''
}

function progressBar(page: number, pages: number, width: number) {
  const filled = Math.max(1, Math.round((page / pages) * width))

  return '━'.repeat(filled) + '─'.repeat(Math.max(0, width - filled))
}

// How a picture reaches the terminal: by path, which the terminal reads itself,
// or as bytes in the drawing. A terminal on another machine (ssh), Warp and
// a Windows terminal in front of WSL cannot read this machine's files.
type Transport = 'file' | 'bytes'
let transport: Transport | undefined
let transportSetting: unknown = 'auto'

async function transportOf($: EngineInterface): Promise<Transport> {
  if (transport !== undefined) {
    return transport
  }
  if (transportSetting === 'file' || transportSetting === 'bytes') {
    transport = transportSetting
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

// Render the page after the one just shown so the next press is instant.
function prefetch($: EngineInterface, p: ImagePreview) {
  if (p.page < p.pages) {
    void renderImage($, p.source, p.page + 1).catch(() => undefined)
  }
}

// Animation: a keyed Image whose source a timer swaps frame by frame.
type Animation = { timer?: Timer; frame: number; loops: number; misses: number }
const animations = new Map<string, Animation>()

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
  const run: Animation = { frame: 0, loops: 0, misses: 0 }
  animations.set(id, run)
  const step = async () => {
    if (animations.get(id) !== run) {
      return
    }
    run.frame = (run.frame + 1) % frames.length
    if (run.frame === 0 && ++run.loops >= maxLoops) {
      await $.ui.blit({ requestId, key, source: await imageSource($, frames[0]!.png) }).catch(() => undefined)
      animations.delete(id)
      run.loops = -1

      return
    }
    const shown = await $.ui
      .blit({ requestId, key, source: await imageSource($, frames[run.frame]!.png) })
      .catch((err: Error) => ({ deny: err.message }))
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

async function openViewer($: EngineInterface, value: ImagePreview) {
  await update($, viewer, () => ({ preview: value }))
  await $.ui.open({ id: PANE, title: `${formatOf(value.source)} · ${nameOf(value.source)}`, focus: true, closeOnEscape: true })
  prefetch($, value)
}

async function turnInline($: EngineInterface, id: string, p: ImagePreview, page: number) {
  const next = await renderImage($, p.source, clampPage(p, page))
  await remember($, id, { ...next, caption: p.caption, size: p.size })
  prefetch($, next)
}

async function turnViewer($: EngineInterface, p: ImagePreview, page: number) {
  const next = await renderImage($, p.source, clampPage(p, page))
  await update($, viewer, () => ({ preview: next }))
  prefetch($, next)
}

async function showGrid($: EngineInterface, p: ImagePreview, start: number) {
  const first = Math.min(Math.max(1, start), Math.max(1, p.pages - GRID + 1))
  const pages = Array.from({ length: Math.min(GRID, p.pages) }, (_, i) => first + i)
  const cells: GridCell[] = await Promise.all(
    pages.map(async page => {
      const one = await renderImage($, p.source, page)

      return { page, png: one.png, width: one.width, height: one.height }
    }),
  )
  await update($, viewer, () => ({ preview: p, grid: { start: first, cells } }))
}

function openExternally($: EngineInterface, source: string) {
  void $.process.run(['/bin/sh', `${$.plugin.root}/bin/open.sh`, source]).catch(() => undefined)
}

function unsupportedText(value: Extract<Preview, { kind: 'unsupported' }>) {
  return `Can't preview ${nameOf(value.source)}: ${value.reason}. Supported: ${SUPPORTED}.`
}

export const register: Register = (on, options: PluginOptions) => {
  transport = undefined
  transportSetting = options.transport ?? 'auto'
  // Animations started this load: a redraw must not restart one that finished.
  const started = new Set<string>()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.tool.register({
      name: TOOL,
      description:
        'Show the user a visual file inline in the terminal. Use it when seeing the file ' +
        'helps: a plot or diagram you made, a slide or page you are explaining, a ' +
        'screenshot, a document. Supports ' + SUPPORTED + '. Multi-page files show one ' +
        'page with prev/next buttons; mode "viewer" opens a paging viewer with a thumbnail ' +
        'grid. Animated GIFs play. Text files are not previewed (Claude Code already shows ' +
        'them). The user sees it; you do not. If a type is not supported the result says so.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or working-directory-relative path' },
          page: { type: 'integer', minimum: 1, description: 'Page or slide, 1-based; default 1' },
          caption: { type: 'string', description: 'One short line shown above the preview' },
          size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Default medium' },
          mode: {
            type: 'string',
            enum: ['inline', 'viewer'],
            description: 'inline (default): in the conversation. viewer: open the paging viewer pane',
          },
        },
        required: ['path'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'view',
      description: 'Open a file in the asset viewer: /view <path> [page]',
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
      mode?: 'inline' | 'viewer'
    }
    const value = await preview($, input.path, input.page ?? 1)
    if (value.kind === 'unsupported') {
      await remember($, e.tool_use_id, { ...value, caption: input.caption })

      return { result: unsupportedText(value) }
    }
    const shown: ImagePreview = { ...value, caption: input.caption, size: input.size }
    await remember($, e.tool_use_id, shown)
    if (input.mode === 'viewer') {
      await openViewer($, shown)
    } else {
      prefetch($, shown)
    }
    const where = shown.pages > 1 ? ` (page ${shown.page} of ${shown.pages})` : ''
    const how = input.mode === 'viewer' ? ' in the viewer pane' : ''
    const note = shown.note ? ` Note: ${shown.note}.` : ''

    return { result: `Shown to the user${how}: ${input.path}${where}.${note}` }
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || !AUTO.test(e.file_path)) {
      return ran
    }
    const value = await preview($, e.file_path, firstPage(e.pages))
    if (value.kind === 'image') {
      await remember($, e.tool_use_id, { ...value, size: 'small' })
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored || (e.props.tool !== 'Read' && e.props.tool !== FULL_TOOL)) {
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
        <Box flexDirection="column">
          <Text color="warning">⚠ Can't preview {nameOf(value.source)}: {value.reason}</Text>
          <Text dimColor>Supported: {SUPPORTED}</Text>
        </Box>
      )
    }

    const columns = (e.viewport?.columns ?? 100) - 6
    const box = boxFor(value, columns, value.size === 'small' ? 16 : 36, WIDTH[value.size ?? 'medium'])
    const label = `${value.caption ? `${value.caption} · ` : ''}${nameOf(value.source)}${pageLabel(value)}`
    ensureAnimation($, id, 'pic', value.frames, INLINE_LOOPS, started)

    return (
      <Box flexDirection="column">
        <Text dimColor>{label}</Text>
        <Image
          key="pic"
          source={await imageSource($, value.png)}
          columns={box.columns}
          rows={box.rows}
          alt={`[${formatOf(value.source)}: ${nameOf(value.source)}${pageLabel(value)}. This terminal cannot draw images; try Ghostty or kitty]`}
        />
        {value.note && <Text dimColor italic>ⓘ {value.note}</Text>}
        <Box flexDirection="row" gap={1}>
          {value.pages > 1 && (
            <Button key="prev" label="◀" onPress={() => turnInline($, id, value, value.page - 1)} />
          )}
          {value.pages > 1 && (
            <Button key="next" label="▶" onPress={() => turnInline($, id, value, value.page + 1)} />
          )}
          {value.frames && (
            <Button
              key="replay"
              label="↻ Replay"
              onPress={() => playAnimation($, id, 'pic', value.frames ?? [], INLINE_LOOPS)}
            />
          )}
          <Button key="viewer" label="⤢ Viewer" onPress={() => openViewer($, value)} />
          <Button key="open" label="↗ Open" dimColor onPress={() => openExternally($, value.source)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const { Box, Text, Button, Image, Input } = $.ui.resolve(e)
    const state: Viewer | null = await read($, viewer)
    if (state === null) {
      return <Text dimColor>Nothing open. Use /view &lt;path&gt;.</Text>
    }
    const p = state.preview
    const isPaged = p.pages > 1
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const bodyRows = Math.max(10, (e.viewport?.rows ?? 30) - 12)
    const go = (page: number) => turnViewer($, p, page)
    const close = <Button key="close" label="Close" hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
    const open = <Button key="open" label="Open in app" hotkey="o" onPress={() => openExternally($, p.source)} />
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="claude">
          {formatOf(p.source)} <Text color="text">{nameOf(p.source)}</Text>
        </Text>
        <Text dimColor>{isPaged ? `${p.page} / ${p.pages}` : `${p.width}×${p.height}`}</Text>
      </Box>
    )

    if (state.grid) {
      const grid = state.grid
      const cellColumns = Math.floor((inner - 4) / 3)
      const rowsEach = Math.max(4, Math.floor((bodyRows - 4) / 2))
      const sources = new Map(
        await Promise.all(grid.cells.map(async cell => [cell.page, await imageSource($, cell.png)] as const)),
      )
      const rowsOf = [grid.cells.slice(0, 3), grid.cells.slice(3, 6)]
      const pick = async (page: number) => {
        await go(page)
      }

      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          {header}
          {rowsOf.map((row, r) => (
            <Box key={`row${r}`} flexDirection="row" gap={1}>
              {row.map((cell, i) => {
                const box = boxFor(cell, cellColumns, rowsEach, cellColumns)
                const n = r * 3 + i + 1

                return (
                  <Box key={`cell${cell.page}`} flexDirection="column" width={cellColumns} alignItems="center">
                    <Image key={`thumb${cell.page}`} source={sources.get(cell.page) ?? { file: cell.png, format: 'png' }} columns={box.columns} rows={box.rows} alt={`page ${cell.page}`} />
                    <Button
                      key={`go${cell.page}`}
                      label={`${cell.page}`}
                      hotkey={`${n}`}
                      dimColor={cell.page !== p.page}
                      onPress={() => pick(cell.page)}
                    />
                  </Box>
                )
              })}
            </Box>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key="gprev" label="◀ Prev 6" hotkey="p" onPress={() => showGrid($, p, grid.start - GRID)} />
            <Button key="gnext" label="Next 6 ▶" hotkey="n" variant="primary" onPress={() => showGrid($, p, grid.start + GRID)} />
            <Button key="single" label="Single page" hotkey="g" onPress={() => update($, viewer, () => ({ preview: p }))} />
            {open}
            {close}
          </Box>
          <Text dimColor>1-6 open a page · n/p next/prev six · g single page · Esc close</Text>
        </Box>
      )
    }

    const box = boxFor(p, inner, bodyRows, 255)
    ensureAnimation($, PANE, 'page', p.frames, Number.POSITIVE_INFINITY, started)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        {header}
        <Box justifyContent="center">
          <Image
            key="page"
            source={await imageSource($, p.png)}
            columns={box.columns}
            rows={box.rows}
            alt={`[${nameOf(p.source)}${pageLabel(p)}]`}
          />
        </Box>
        {isPaged && <Text color="claude">{progressBar(p.page, p.pages, inner)}</Text>}
        {p.note && <Text dimColor italic>ⓘ {p.note}</Text>}
        <Box flexDirection="row" gap={1}>
          {isPaged && <Button key="first" label="⏮ First" hotkey="f" onPress={() => go(1)} />}
          {isPaged && <Button key="prev" label="◀ Prev" hotkey="p" onPress={() => go(p.page - 1)} />}
          {isPaged && <Button key="next" label="Next ▶" hotkey="n" variant="primary" onPress={() => go(p.page + 1)} />}
          {isPaged && <Button key="last" label="Last ⏭" hotkey="l" onPress={() => go(p.pages)} />}
          {isPaged && <Button key="grid" label="▦ Grid" hotkey="g" onPress={() => showGrid($, p, p.page)} />}
          {open}
          {close}
        </Box>
        {isPaged && (
          <Input
            key="goto"
            label="Go to page"
            placeholder={`1-${p.pages}`}
            submitLabel="Go"
            onSubmit={(text: string) => {
              const n = Number.parseInt(text, 10)
              if (Number.isFinite(n)) {
                void go(n)
              }
            }}
          />
        )}
        <Text dimColor>
          {isPaged ? 'n/p page · f/l first/last · g grid · ' : ''}o open in app · Esc close
        </Text>
      </Box>
    )
  })

  on('session.end', ($, e, next) => {
    for (const id of [...animations.keys()]) {
      stopAnimation(id)
    }

    return next(e)
  })
}
