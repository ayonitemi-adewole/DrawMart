/**
 * Shrinks a picked photo to a JPEG data URL so it fits in the mock's
 * localStorage. A real backend would upload the original to storage and
 * return a URL instead.
 */
export async function photoToDataUrl(file: File, maxSide = 900, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that photo.')
  ctx.fillStyle = '#ffffff' // transparent PNGs become white, like a studio shot
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', quality)
}
