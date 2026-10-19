// The real type of downloaded image bytes. Servers label images loosely (Roblox's
// CDN sends "image/Png"), and vision APIs accept only exact lowercase types.
const SIGNATURES = [
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP']
]

/** The type the bytes' signature names, else the header's type lowercased, else PNG. */
export function imageMimeType(bytes, contentType) {
  const sniffed = SIGNATURES.find(([, matches]) => bytes.length >= 12 && matches(bytes))?.[0]
  return sniffed ?? (contentType?.split(';')[0].trim().toLowerCase() || 'image/png')
}
