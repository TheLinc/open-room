import { acceptImage, type ImageAttachment, type ImageMediaType } from '@shared/attachments'

/** Reads a File into an attachment, or explains why it cannot be one. */
export async function readImage(
  file: File,
  alreadyAttached: number
): Promise<{ ok: true; image: ImageAttachment } | { ok: false; reason: string }> {
  const verdict = acceptImage(file, alreadyAttached)
  if (!verdict.ok) return verdict

  let dataUri: string
  try {
    dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  } catch {
    return { ok: false, reason: `Could not read ${file.name || 'the image'}.` }
  }
  // `readAsDataURL` yields `data:<type>;base64,<data>`; the SDK wants the tail.
  const data = dataUri.slice(dataUri.indexOf(',') + 1)
  const name = file.name || `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  return { ok: true, image: { name, mediaType: file.type as ImageMediaType, data } }
}

/** Image files among what was dropped or pasted, in order. */
export function imageFiles(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return []
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && file.type.startsWith('image/')) files.push(file)
  }
  return files
}
