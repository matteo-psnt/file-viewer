import { expect, test } from 'claude-code/testing'

import { explainDeny } from '../hooks/deny.ts'

const deny = (why: string) => `the Image draws its alt here: the terminal draws no placeholder images (${why})`

test('each refusal Claude Code gives is put in words', () => {
  expect(explainDeny(deny('bg worker'), undefined).why).toMatch(/Claude Agents/)
  expect(explainDeny('pictures are off inside tmux or screen', undefined).why).toMatch(/tmux or screen/)
  expect(explainDeny(deny('probe: graphics reply OK, terminal iTerm2 3.7.4'), undefined)).toMatchObject({
    why: 'Claude Code only turns pictures on in Ghostty and kitty, and this is iTerm2 3.7.4.',
    fix: expect.stringContaining('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
  })
  expect(explainDeny(deny('probe: graphics reply OK, terminal kitty 0.26.5'), undefined).fix).toBe('Update kitty.')
  expect(explainDeny(deny('probe: graphics reply OK, terminal WezTerm 2024'), undefined).fix).toMatch(/Ghostty or kitty/)
})

test('the newer refusal names the terminal from its environment', () => {
  expect(explainDeny(deny('env: terminal=Apple_Terminal, not asked yet, no answer'), undefined).why).toBe(
    "Terminal.app doesn't support kitty graphics, which Claude Code draws pictures with.",
  )
})

test('an unknown refusal keeps its own words', () => {
  expect(explainDeny('the Image draws its alt here: something new', undefined).why).toBe(
    "Claude Code can't draw pictures here (something new).",
  )
})
