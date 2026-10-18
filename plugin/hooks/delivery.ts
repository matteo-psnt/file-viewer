// Files Claude hands over with these tools get a card under the delivery, so a
// PDF or a deck it made shows its first page where it arrives.
export const DELIVERY_TOOLS = new Set(['SendUserFile', 'SendUserMessage'])
export const DELIVERED_MAX = 4
export const PREVIEWABLE =
  /\.(pdf|docx?|pptx?|xlsx?|rtf|odt|odp|ods|gif|webp|apng|png|jpe?g|heic|heif|avif|tiff?|bmp|psd|tga|ico|icns|jp2|dng|cr2|cr3|nef|arw|raf|orf|rw2|svgz?|key|pages|numbers)$/i

export function deliveredFiles(output: unknown): string[] {
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
