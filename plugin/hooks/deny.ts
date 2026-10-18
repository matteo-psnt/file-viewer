// Why pictures can't show, and what would make them show, in words for the
// person and for Claude. Claude Code turns pictures on only for Ghostty and
// kitty 0.28+, and says which check failed in its refusal, e.g. "no
// placeholder images (probe: graphics reply OK, terminal iTerm2 3.7.4)".
export type Blocked = { why: string; fix: string }

export const TERMINAL_NAMES: Record<string, string> = {
  Apple_Terminal: 'Terminal.app',
  WarpTerminal: 'Warp',
  vscode: 'VS Code',
  'iTerm.app': 'iTerm2',
}
// Terminals that draw Claude Code's pictures once it is told to (tested).
export const FORCE_FIX =
  'To turn them on, add "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" to env in ~/.claude/settings.json.'
export const FORCEABLE = /^(iTerm2|Rio)\b/

export function explainDeny(deny: string, termProgram: string | undefined): Blocked {
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
  // Claude Code names the terminal as "terminal iTerm2 3.7.4" or, from its
  // environment, "terminal=Apple_Terminal".
  const named = deny.match(/, terminal ([^)]+)\)/)?.[1]?.trim()
  const fromEnv = deny.match(/terminal=([^,)\s]+)/)?.[1] ?? termProgram
  const terminal = named ?? (fromEnv === undefined ? undefined : (TERMINAL_NAMES[fromEnv] ?? fromEnv))
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
  // Newer Claude Code: "(env: terminal=Apple_Terminal, not asked yet, no answer)".
  if (deny.includes('no reply to the graphics query') || /\bno answer\b/.test(deny)) {
    return { why: `${terminal ?? 'This terminal'} doesn't support kitty graphics, which Claude Code draws pictures with.`, fix: elsewhere }
  }

  return { why: `Claude Code can't draw pictures here (${deny.replace(/^.*?: /, '')}).`, fix: elsewhere }
}
