import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Calculează incremental digestul corpului cache-uit. Headerele pot fi
 * copiate sau stale și nu sunt niciodată tratate drept dovadă de integritate. */
export async function sha256ResponseBody(response: Response): Promise<{ size: number; sha256: string }> {
  if (!response.body) throw new Error('response_body_unavailable')
  const digest = sha256.create()
  const reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      digest.update(value)
    }
  } finally {
    reader.releaseLock()
  }
  return { size, sha256: bytesToHex(digest.digest()) }
}
