/**
 * Images attached to a prompt.
 *
 * They travel as base64 content blocks on the ordinary user message — the
 * SDK accepts `image` blocks in streaming input mode — so nothing is written
 * to disk and a screenshot pasted from the clipboard needs no path at all.
 */

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type ImageAttachment = {
  /** Shown on the chip; a pasted image gets a generated one. */
  name: string
  mediaType: ImageMediaType
  /** Base64 without a data-URI prefix — the SDK's `source.data` shape. */
  data: string
}

/** A prompt is a question, not an album. Five covers "here are the screens". */
export const MAX_IMAGES = 5
/** Base64 inflates by a third and the whole message crosses IPC as JSON. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const MEDIA_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function isImageMediaType(type: string): type is ImageMediaType {
  return MEDIA_TYPES.has(type)
}

/** Whether a file may be attached, with a reason the chip can show if not. */
export function acceptImage(
  file: { type: string; size: number },
  alreadyAttached: number
): { ok: true } | { ok: false; reason: string } {
  if (alreadyAttached >= MAX_IMAGES) {
    return { ok: false, reason: `At most ${MAX_IMAGES} images per message.` }
  }
  if (!isImageMediaType(file.type)) {
    return {
      ok: false,
      reason: `Only PNG, JPEG, GIF or WebP images can be attached (got ${file.type || 'an unknown type'}).`
    }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `Images must be under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` }
  }
  return { ok: true }
}

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }

/**
 * The `message.content` for a prompt.
 *
 * A string when there is nothing attached, because that is what every
 * existing path expects — `isCommandEcho`, `parseCommand` and the user bubble
 * all read a string. Blocks only when there is an image to carry.
 */
export function userContent(text: string, images: ImageAttachment[]): string | UserContentBlock[] {
  if (images.length === 0) return text
  const blocks: UserContentBlock[] = []
  if (text) blocks.push({ type: 'text', text })
  for (const image of images) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data }
    })
  }
  return blocks
}
