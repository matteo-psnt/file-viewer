import type { Elements } from 'claude-code'

import type { Blocked } from './deny.ts'
import { formatOf, nameOf, pageLabel, type ImagePreview } from './files.ts'
import { clickTargets } from './session.ts'

// A picture under a layer that opens `source` in its own app when clicked.
export function clickable(
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
