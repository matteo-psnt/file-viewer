import type { Elements } from 'claude-code'

import type { Blocked } from './deny.ts'
import { formatOf, nameOf, pageLabel, type ImagePreview } from './files.ts'
import { clickTargets, type ClickTarget } from './session.ts'

// Records what a click on a picture's layer does (opening a file or turning
// to a page) and returns the layer's key. The layer itself is drawn beside
// the $ calls, in register.tsx.
export function clickLayer(requestId: string, key: string, target: ClickTarget) {
  const layer = `click:${key}`
  clickTargets.set(`${requestId}\u0000${layer}`, target)
  if (clickTargets.size > 500) {
    clickTargets.delete(clickTargets.keys().next().value!)
  }

  return layer
}

// Drawn in place of the picture where the terminal can't show one: why, what
// would fix it, and the file one press away in its own app.
export function blockedNotice(
  { Box, Text, Button }: Elements['terminal'],
  value: ImagePreview,
  blocked: Blocked,
  inPane: boolean,
  onOpen: () => void,
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
        <Button key="open" label="↗ open in app" hotkey={inPane ? 'o' : undefined} onPress={onOpen} />
        {inPane && <Text dimColor>esc close</Text>}
      </Box>
    </Box>
  )
}
