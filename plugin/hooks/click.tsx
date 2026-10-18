import type { ClientModule } from 'claude-code'

// A layer over a picture that draws nothing and tells the hooks module when the
// left button goes down and up inside it. The hooks module knows which file the
// layer stands for and opens it, so the message carries no path.
// After inline-images by Chris Nesbitt-Smith (MIT).

type State = { isListening: true }

const Click: ClientModule<null, State> = (_props, surface) => {
  if (surface.state === undefined) {
    let isDown = false

    surface.onPointer(event => {
      const isInside = event.x >= 0 && event.y >= 0 && event.x < surface.columns && event.y < surface.rows
      if (event.type === 'down') {
        isDown = event.button === 'left' && isInside
      } else if (event.type === 'up') {
        if (isDown && isInside) {
          surface.post({ open: true })
        }
        isDown = false
      } else if (event.type === 'leave') {
        isDown = false
      }
    })
    surface.setState({ isListening: true })
  }

  return surface.elements.Box({ width: surface.columns, height: surface.rows })
}

export default Click
