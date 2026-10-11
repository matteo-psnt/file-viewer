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
  tool: 'mcp__asset-viewer__show',
  output,
  isErrored: false,
})

test('a deck shows inline without its note and pages with the buttons', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$, e) => page(Number(e.argv[3]), 'approximate layout (Quick Look)'))

  const ran = await $.tool.call({
    tool: 'mcp__asset-viewer__show',
    tool_use_id: 'call-1',
    path: '/notes/deck.pptx',
    page: 3,
  })
  expect(ran.result).toBe(
    'Shown to the user: /notes/deck.pptx (page 3 of 12). Note: approximate layout (Quick Look).',
  )

  const ui = await $.ui.mount({
    plugin: 'asset-viewer',
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

  const zip = await $.tool.call({ tool: 'mcp__asset-viewer__show', tool_use_id: 'z', path: '/a/sub.zip' })
  expect(zip.result).toMatch(/^Can't preview sub\.zip: \.zip is not a supported type\. Supported:/)
  const ui = await $.ui.mount({
    plugin: 'asset-viewer',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'z',
    props: result('z', zip.result),
  })
  expect(await ui.find({ type: 'Text', text: /Can't preview sub\.zip/ })).toBeDefined()

  const py = await $.tool.call({ tool: 'mcp__asset-viewer__show', path: '/a/main.py' })
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

  await $.tool.call({ tool: 'mcp__asset-viewer__show', tool_use_id: 'g', path: '/a/spin.gif' })
  await $.ui.mount({
    plugin: 'asset-viewer',
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
  await $.tool.call({ tool: 'mcp__asset-viewer__show', path: '/notes/deck.pptx', page: 6, mode: 'viewer' })

  const ui = await $.ui.mount({
    plugin: 'asset-viewer',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'asset-viewer',
    viewport: { columns: 140, rows: 50 },
    props: { title: 'Viewer', isFocused: true, bodyColumns: 130, placement: 'inline' } as never,
  })
  expect((await ui.find({ key: 'page' }))?.props).toMatchObject({ source: { file: '/c/p6.png' } })
  for (const n of [4, 5, 6, 7, 8]) {
    expect(await ui.find({ key: `thumb:${n}` })).toBeDefined()
  }

  // An arrow key moving the ring onto page 7's button turns to page 7.
  await $.ui.focus({ component: 'Pane', requestId: 'asset-viewer', element: 'thumb:7', origin: { kind: 'person' } })
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
    plugin: 'asset-viewer',
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
    plugin: 'asset-viewer',
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
  ({ tool: 'mcp__asset-viewer__show', tool_use_id: id, path: '/a/pic.png' }) as const

test('over ssh the picture is sent as bytes', async ($, on) => {
  mock.store(on)
  mock.env(on, { SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: { base64: ONE_PIXEL } }))
  on('process.run', () => ok('/c/pic.png\t10\t10\t1\t1\t/a/pic.png\t-\t-\n'))

  await $.tool.call(pngTool('s1'))
  const ui = await $.ui.mount({
    plugin: 'asset-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's1', props: result('s1', ''),
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
    plugin: 'asset-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's2', props: result('s2', ''),
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
    plugin: 'asset-viewer', surface: 'terminal', component: 'ToolResult', requestId: 's3', props: result('s3', ''),
  })
  expect((await ui.find({ key: 'pic' }))?.props).toMatchObject({ source: { file: '/c/pic.png', format: 'png' } })
})

// Runs the session-start probe with Claude Code refusing the picture swap.
async function startRefused(...[$, on, deny]: [...Parameters<TestBody>, string]) {
  const clock = mock.clock(on)
  on('ui.blit', () => ({ value: { deny } }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/a' }))
  on('tool.register', () => ({ value: { tool: 'mcp__asset-viewer__show' } }))
  on('command.register', () => ({ value: { command: 'view' } }))
  await $.session.start({ cwd: '/a', surface: 'terminal', isInteractive: true } as never)
  await $.ui.mount({ plugin: 'asset-viewer', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: {} as never })
  await clock.advance(500)
}

test('in Claude Agents the card says why pictures cannot show and offers the app', async ($, on) => {
  mock.store(on)
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ok('/c/pic.png\t200\t200\t1\t1\t/a/pic.png\t-\t-\n'))
  await startRefused($, on, 'the Image draws its alt here: the terminal draws no placeholder images (bg worker)')

  const ran = await $.tool.call(pngTool('b1'))
  expect(ran.result).toMatch(/^Not shown: This session runs in Claude Agents/)
  const ui = await $.ui.mount({
    plugin: 'asset-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'b1', props: result('b1', ran.result),
  })
  expect(await ui.find({ key: 'pic' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /CLAUDE_CODE_FORCE_TERMINAL_IMAGES/ })).toBeDefined()
  expect(await ui.find({ key: 'open' })).toBeDefined()
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
    plugin: 'asset-viewer', surface: 'terminal', component: 'ToolResult', requestId: 'b2', props: result('b2', ran.result),
  })
  expect(await ui.find({ type: 'Text', text: /"CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" to env in ~\/\.claude\/settings\.json/ })).toBeDefined()
})
