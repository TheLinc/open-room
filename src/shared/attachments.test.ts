import { describe, expect, it } from 'vitest'
import {
  acceptImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  userContent,
  type ImageAttachment
} from './attachments'

const png: ImageAttachment = { name: 'shot.png', mediaType: 'image/png', data: 'AAAA' }

describe('acceptImage', () => {
  it('accepts a small png with room left', () => {
    expect(acceptImage({ type: 'image/png', size: 1024 }, 0)).toEqual({ ok: true })
  })

  it('rejects a non-image with a reason naming the type', () => {
    const result = acceptImage({ type: 'application/pdf', size: 10 }, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/pdf/i)
  })

  it('rejects an image over the byte limit', () => {
    expect(acceptImage({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }, 0).ok).toBe(false)
  })

  it('rejects the sixth image', () => {
    expect(acceptImage({ type: 'image/png', size: 1 }, MAX_IMAGES).ok).toBe(false)
  })

  it('treats an empty type as unknown rather than throwing', () => {
    expect(acceptImage({ type: '', size: 1 }, 0).ok).toBe(false)
  })
})

describe('userContent', () => {
  it('sends plain text as a string when nothing is attached', () => {
    // A string is what the SDK has always received; keep that shape so no
    // downstream check on `typeof content === 'string'` changes behaviour.
    expect(userContent('hello', [])).toBe('hello')
  })

  it('puts the text first, then one image block per attachment', () => {
    expect(userContent('look', [png])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
  })

  it('omits the text block when only images are sent', () => {
    expect(userContent('', [png])).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    ])
  })
})
