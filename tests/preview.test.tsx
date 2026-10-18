import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const failed = (stderr: string) => ({
  value: { exitCode: 3, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})
const page = (n: number, note = '-') =>
  ok(`/c/p${n}.png\t1000\t750\t12\t${n}\t/notes/deck.pptx\t-\t${note}\n`)

const result = (id: string, output: unknown) => ({
  tool_use_id: id,
  tool: 'mcp__file-viewer__preview',
  output,
  isErrored: false,
})

test('a deck shows inline without its note and pages with the buttons', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$, e) => page(Number(e.argv[3]), 'approximate layout (Quick Look)'))

  const ran = await $.tool.call({
    tool: 'mcp__file-viewer__preview',
    tool_use_id: 'call-1',
    path: '/notes/deck.pptx',
    page: 3,
  })
  expect(ran.result).toBe(
    'Shown to the user: /notes/deck.pptx (page 3 of 12). Note: approximate layout (Quick Look).',
  )

  const ui = await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'call-1',
    props: result('call-1', ran.result),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/p3.png' } })
  // The layout note is the viewer's to show; the card stays quiet.
  expect(await ui.find({ type: 'Text', text: /approximate layout/ })).toBeUndefined()

  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/p4.png' } })
})

test('unsupported and text files are reported inline and to the model', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => failed('.zip is not a supported type'))

  const zip = await $.tool.call({ tool: 'mcp__file-viewer__preview', tool_use_id: 'z', path: '/a/sub.zip' })
  expect(zip.result).toMatch(/^Can't preview sub\.zip: \.zip is not a supported type\. Supported:/)
  const ui = await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'z',
    props: result('z', zip.result),
  })
  expect(await ui.find({ type: 'Text', text: /Can't preview sub\.zip/ })).toBeDefined()

  const py = await $.tool.call({ tool: 'mcp__file-viewer__preview', path: '/a/main.py' })
  expect(py.result).toMatch(/\.py is a text file, which Claude Code already shows/)
})

test('an animated gif plays by swapping frames', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  const clock = mock.clock(on)
  on('process.run', () =>
    ok('/c/f0.png\t100\t100\t1\t1\t/a/spin.gif\t/c/frames.tsv\t-\n'),
  )
  on('fs.read', () => ({ value: '/c/f0.png\t80\n/c/f1.png\t80\n/c/f2.png\t80\n' }))
  const blits: string[] = []
  on('ui.blit', (_$, e) => {
    if ('source' in e && 'file' in e.source) {
      blits.push(e.source.file)
    }

    return { value: {} }
  })

  await $.tool.call({ tool: 'mcp__file-viewer__preview', tool_use_id: 'g', path: '/a/spin.gif' })
  await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'g',
    props: result('g', ''),
  })
  for (let i = 0; i < 4; i++) {
    await clock.advance(80)
  }
  expect(blits.slice(0, 3)).toEqual(['/c/f1.png', '/c/f2.png', '/c/f0.png'])
})

test('the viewer shows a sidebar of pages and turns with the arrow keys', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$, e) => page(Number(e.argv[3])))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.focus', () => ({}))
  await $.tool.call({ tool: 'mcp__file-viewer__preview', path: '/notes/deck.pptx', page: 6, mode: 'viewer' })

  const ui = await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'file-viewer',
    viewport: { columns: 140, rows: 50 },
    props: { title: 'Viewer', isFocused: true, bodyColumns: 130, placement: 'inline' } as never,
  })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ source: { file: '/c/p6.png' } })
  for (const n of [4, 5, 6, 7, 8]) {
    expect(await ui.find({ key: `thumb:${n}` })).toBeDefined()
  }

  // An arrow key moving the ring onto page 7's button turns to page 7.
  await $.ui.focus({ component: 'Pane', requestId: 'file-viewer', element: 'thumb:7', origin: { kind: 'person' } })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ source: { file: '/c/p7.png' } })
  expect(await ui.find({ key: 'thumb:9' })).toBeDefined()

  await ui.press({ key: 'thumb:5' })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ source: { file: '/c/p5.png' } })
  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ source: { file: '/c/p6.png' } })
})

test('a resumed conversation draws a preview from the store', async ($, on) => {
  mock.store(on, {
    'preview:old-call': {
      kind: 'image', source: '/notes/deck.pptx', png: '/c/p5.png', width: 1000, height: 750, page: 5, pages: 12,
    },
  })
  on('fs.exists', () => ({ value: true }))

  const ui = await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'old-call',
    props: result('old-call', ''),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/p5.png' } })
})

test('a preview whose cached PNG is gone is rendered again', async ($, on) => {
  mock.store(on, {
    'preview:purged': {
      kind: 'image', source: '/notes/deck.pptx', png: '/c/gone.png', width: 1000, height: 750, page: 2, pages: 12,
    },
  })
  const clock = mock.clock(on)
  let isCached = false
  on('fs.exists', () => ({ value: isCached }))
  on('process.run', (_$, e) => {
    isCached = true

    return page(Number(e.argv[3]))
  })

  const ui = await $.ui.mount({
    plugin: 'file-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'purged',
    props: result('purged', ''),
  })
  expect(await ui.find({ type: 'Text', text: /Preparing preview of deck\.pptx/ })).toBeDefined()
  await clock.advance(1)
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/p2.png' } })
})

const ONE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const pngTool = (id: string) =>
  ({ tool: 'mcp__file-viewer__preview', tool_use_id: id, path: '/a/pic.png' }) as const

test('over ssh the picture is sent as bytes', async ($, on) => {
  mock.store(on)
  mock.env(on, { SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: { base64: ONE_PIXEL } }))
  on('process.run', () => ok('/c/pic.png\t10\t10\t1\t1\t/a/pic.png\t-\t-\n'))

  await $.tool.call(pngTool('s1'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's1', props: result('s1', ''),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { png: ONE_PIXEL } })
})

test('the transport setting overrides the guess', { options: { transport: 'bytes' } }, async ($, on) => {
  mock.store(on)
  mock.env(on, {})
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: { base64: ONE_PIXEL } }))
  on('process.run', () => ok('/c/pic.png\t10\t10\t1\t1\t/a/pic.png\t-\t-\n'))

  await $.tool.call(pngTool('s2'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's2', props: result('s2', ''),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { png: ONE_PIXEL } })
})

test('a local terminal reads the file by path', async ($, on) => {
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ok('/c/pic.png\t10\t10\t1\t1\t/a/pic.png\t-\t-\n'))

  await $.tool.call(pngTool('s3'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's3', props: result('s3', ''),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/pic.png', format: 'png' } })
})

// Runs the session-start probe with Claude Code refusing the picture swap.
async function startRefused(
  ...[$, on, deny, write]: [...Parameters<TestBody>, string, ((path: string, text: string) => void)?]
) {
  const clock = mock.clock(on)
  on('ui.blit', () => ({ value: { deny } }))
  on('fs.write', (_$, e) => {
    write?.(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', () => ({ cwd: '/a' }))
  on('tool.register', () => ({ value: { tool: 'mcp__file-viewer__preview' } }))
  on('command.register', () => ({ value: { command: 'view' } }))
  await $.session.start({ cwd: '/a', surface: 'terminal', isInteractive: true } as never)
  await $.ui.mount({ plugin: 'file-viewer', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: {} as never })
  await clock.advance(500)
}

// A 24-bit top-down BMP, as cells.sh writes it: the left half red, the right blue.
function halves(width: number, height: number) {
  const stride = Math.ceil((width * 3) / 4) * 4
  const bytes = new Uint8Array(54 + stride * height)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x424d)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true)
  view.setUint16(28, 24, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.set(x < width / 2 ? [0, 0, 255] : [255, 0, 0], 54 + y * stride + x * 3)
    }
  }

  return bytes.toBase64()
}

// The cell at `index` of a Raster's cells: glyph, foreground, background.
function cellAt(cells: string, index: number) {
  const view = new DataView(Uint8Array.fromBase64(cells).buffer)

  return [0, 4, 8].map(at => view.getUint32(index * 12 + at, true))
}

test('in Claude Agents the card draws the picture in blocks and says why', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  let size = [0, 0]
  on('process.run', (_$, e) => {
    if (e.argv[1]?.endsWith('cells.sh')) {
      size = [Number(e.argv[3]), Number(e.argv[4])]
      return ok('/c/pic-c.bmp\n')
    }
    return ok('/c/pic.png\t200\t100\t1\t1\t/a/pic.png\t-\t-\n')
  })
  on('fs.read', () => ({ value: { base64: halves(size[0]!, size[1]!) } }))
  await startRefused($, on, 'the Image draws its alt here: the terminal draws no placeholder images (bg worker)')

  const ran = await $.tool.call(pngTool('b1'))
  expect(ran.result).toMatch(/^Shown to the user as a rough preview in coloured block characters: \/a\/pic\.png\. This session runs in Claude Agents/)
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'b1', props: result('b1', ran.result),
  })
  const raster = (await ui.find({ key: 'pic' }))?.props as { type?: string; columns: number; rows: number; cells: string }
  expect(raster).toMatchObject({ columns: 64, rows: 16 })
  expect(size).toEqual([128, 32])
  expect(cellAt(raster.cells, 0)).toEqual([0x2588, 0xff0000, 0xff0000])
  expect(cellAt(raster.cells, 63)).toEqual([0x2588, 0x0000ff, 0x0000ff])
  expect(await ui.find({ type: 'Text', text: /CLAUDE_CODE_FORCE_TERMINAL_IMAGES/ })).toBeDefined()
})

test('where blocks cannot be made either, the card offers the app', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$, e) =>
    e.argv[1]?.endsWith('cells.sh') ? failed('a block preview needs ImageMagick') : ok('/c/pic.png\t200\t200\t1\t1\t/a/pic.png\t-\t-\n'),
  )
  await startRefused($, on, 'the Image draws its alt here: the terminal draws no placeholder images (bg worker)')

  const ran = await $.tool.call(pngTool('b3'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'b3', props: result('b3', ran.result),
  })
  expect(await ui.find({ key: 'pic' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Can't show pictures here/ })).toBeDefined()
  expect(await ui.find({ key: 'open' })).toBeDefined()
})

test('a click on the picture opens the file in its app', async ($, on) => {
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('fs.exists', () => ({ value: true }))
  const opened: string[] = []
  on('process.run', (_$, e) => {
    if (e.argv[1]?.endsWith('open.sh')) {
      opened.push(e.argv[2] ?? '')
    }
    return ok('/c/pic.png\t10\t10\t1\t1\t/a/pic.png\t-\t-\n')
  })

  await $.tool.call(pngTool('k1'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'k1', props: result('k1', ''),
  })
  // The surface measures the layer before it sends pointer events.
  await ui.resize({ columns: 64, rows: 32, in: 'click:pic' })
  await ui.pointer({ type: 'down', x: 1, y: 1, button: 'left', in: 'click:pic' })
  await ui.pointer({ type: 'up', x: 1, y: 1, button: 'left', in: 'click:pic' })
  expect(opened).toEqual(['/a/pic.png'])
})

test('iTerm2 is told how to turn pictures on', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ok('/c/pic.png\t200\t200\t1\t1\t/a/pic.png\t-\t-\n'))
  await startRefused(
    $,
    on,
    'the Image draws its alt here: the terminal draws no placeholder images (probe: graphics reply OK, terminal iTerm2 3.7.4)',
  )

  const ran = await $.tool.call(pngTool('b2'))
  expect(ran.result).toContain('only turns pictures on in Ghostty and kitty, and this is iTerm2 3.7.4.')
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'b2', props: result('b2', ran.result),
  })
  expect(await ui.find({ type: 'Text', text: /"CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" to env in ~\/\.claude\/settings\.json/ })).toBeDefined()
})

test('the desktop app gets the page as a JPEG inside an Svg', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: { base64: ONE_PIXEL } }))
  on('process.run', (_$, e) =>
    e.argv[1]?.endsWith('jpeg.sh') ? ok('/c/pic-w800.jpg\n') : ok('/c/pic.png\t1200\t900\t1\t1\t/a/pic.png\t-\t-\n'),
  )

  await $.tool.call(pngTool('d1'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'desktop', component: 'ToolResult', requestId: 'd1', props: result('d1', ''),
  })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props).toMatchObject({ width: 640 })
  expect((svg?.props as { source: string }).source).toContain(`data:image/jpeg;base64,${ONE_PIXEL}`)
  expect(await ui.find({ key: 'open' })).toBeDefined()
})

test('the desktop card turns pages', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: { base64: ONE_PIXEL } }))
  on('process.run', (_$, e) =>
    e.argv[1]?.endsWith('jpeg.sh') ? ok('/c/p.jpg\n') : page(Number(e.argv[3])),
  )

  await $.tool.call({ tool: 'mcp__file-viewer__preview', tool_use_id: 'd2', path: '/notes/deck.pptx', page: 3 })
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'desktop', component: 'ToolResult', requestId: 'd2', props: result('d2', ''),
  })
  expect(await ui.find({ type: 'Text', text: /page 3\/12/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /page 4\/12/ })).toBeDefined()
})

const delivery = (id: string, output: unknown) => ({ tool_use_id: id, tool: 'SendUserFile', output, isErrored: false })

// Claude Code's own row for a delivery, which the cards go under.
function coreRow(on: Parameters<TestBody>[1]) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>sent</Text>
  })
}

test('a file Claude sends shows its first page under the delivery', async ($, on) => {
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: 'ghostty' })
  on('fs.exists', () => ({ value: true }))
  const clock = mock.clock(on)
  on('process.run', () => ok('/c/r1.png\t800\t1000\t3\t1\t/a/report.pdf\t-\t-\n'))
  coreRow(on)

  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'u1',
    props: delivery('u1', { attachments: [{ path: '/a/report.pdf', size: 1, isImage: false }, { path: '/a/notes.md', size: 1, isImage: false }] }),
  })
  expect(await ui.find({ type: 'Text', text: /Preparing preview of report\.pdf/ })).toBeDefined()
  await clock.advance(10)
  expect((await ui.find({ key: 'f0:pic' }))?.props).toMatchObject({ source: { file: '/c/r1.png' } })
  expect(await ui.find({ key: 'f1:pic' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /1 \/ 3/ })).toBeDefined()
})

test('a file sent as a download only gets no preview', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    return ok('/c/r1.png\t800\t1000\t1\t1\t/a/report.pdf\t-\t-\n')
  })
  coreRow(on)

  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'u2',
    props: delivery('u2', { display: 'attach', attachments: [{ path: '/a/report.pdf', size: 1, isImage: false }] }),
  })
  expect(await ui.find({ type: 'Text', text: /Preparing preview/ })).toBeUndefined()
  expect(runs).toEqual([])
})

test('in iTerm2 the overlay draws over marked blocks', async ($, on) => {
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: 'w0t0p0:ABC' })
  on('fs.exists', () => ({ value: true }))
  let size = [0, 0]
  on('process.run', (_$, e) => {
    if (e.argv[1]?.endsWith('cells.sh')) {
      size = [Number(e.argv[3]), Number(e.argv[4])]
      return ok('/c/pic-c.bmp\n')
    }
    return ok('/c/pic.png\t200\t100\t1\t1\t/a/pic.png\t-\t-\n')
  })
  on('fs.read', () => ({ value: { base64: halves(size[0]!, size[1]!) } }))
  const spawned: string[][] = []
  let ready = (): void => undefined
  let stop = (): void => undefined
  on('process.spawn', async function* (_$, e) {
    spawned.push([...e.argv])
    await new Promise<void>(resolve => {
      ready = resolve
    })
    yield { stream: 'stdout' as const, text: '{"ok": true, "ready": true}\n' }
    await new Promise<void>(resolve => {
      stop = resolve
    })
  })
  const records = new Map<string, string>()
  await startRefused(
    $,
    on,
    'the Image draws its alt here: the terminal draws no placeholder images (probe: graphics reply OK, terminal iTerm2 3.7.4)',
    (path, text) => records.set(path, text),
  )
  expect(spawned[0]?.slice(-2)).toEqual(['--session', 'w0t0p0:ABC'])

  const ran = await $.tool.call(pngTool('i1'))
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'i1', props: result('i1', ran.result),
  })
  const raster = (await ui.find({ key: 'pic' }))?.props as { cells: string }
  // The first five cells of a row are braille in the cell's own colour.
  const first = cellAt(raster.cells, 0)
  expect(first[0]! >= 0x2800 && first[0]! <= 0x28ff).toBe(true)
  expect(first[1]).toBe(first[2])
  expect(cellAt(raster.cells, 5)[0]).toBe(0x2588)
  const [path, text] = [...records.entries()].find(([p]) => p.startsWith('/c/overlays/')) ?? []
  expect(path).toMatch(/^\/c\/overlays\/[0-9a-f]{6}\.json$/)
  expect(JSON.parse(text ?? '{}')).toMatchObject({ png: '/c/pic.png', columns: 64, rows: 16 })
  expect(await ui.find({ type: 'Text', text: /Block preview/ })).toBeDefined()

  // Once the overlay says it's ready, the row redraws without the note.
  ready()
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
  expect(await ui.find({ type: 'Text', text: /Block preview/ })).toBeUndefined()
  stop()
})

test('FILE_VIEWER_BLOCKS draws blocks without a note', async ($, on) => {
  mock.store(on)
  mock.env(on, { TERM_PROGRAM: 'ghostty', FILE_VIEWER_BLOCKS: '1' })
  on('fs.exists', () => ({ value: true }))
  let size = [0, 0]
  on('process.run', (_$, e) => {
    if (e.argv[1]?.endsWith('cells.sh')) {
      size = [Number(e.argv[3]), Number(e.argv[4])]
      return ok('/c/pic-c.bmp\n')
    }
    return ok('/c/pic.png\t200\t100\t1\t1\t/a/pic.png\t-\t-\n')
  })
  on('fs.read', () => ({ value: { base64: halves(size[0]!, size[1]!) } }))
  await startRefused($, on, 'never asked')

  const ran = await $.tool.call(pngTool('f1'))
  expect(ran.result).toMatch(/coloured block characters/)
  const ui = await $.ui.mount({
    plugin: 'file-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'f1', props: result('f1', ran.result),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ columns: 64, rows: 16 })
  expect(await ui.find({ type: 'Text', text: /Block preview/ })).toBeUndefined()
})
