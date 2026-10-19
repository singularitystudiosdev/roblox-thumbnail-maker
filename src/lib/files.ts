import type { StyleUpload } from './api'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** A picked, pasted or dropped image as { dataUrl, name }; throws a sentence for the user when it cannot be used. */
export async function readImageFile(file: File): Promise<StyleUpload> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Pick a PNG, JPEG or WebP image.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Pick an image under 8 MB.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
  return { dataUrl, name: file.name.replace(/\.[a-z0-9]+$/i, '') || 'Pasted image' }
}
