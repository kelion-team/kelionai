/** Read a fetch response without allowing a provider or proxy to allocate an
 * unbounded Buffer in this process. */
export async function readResponseBufferLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('invalid_body_limit')
  const declared = response.headers.get('content-length')
  if (declared && Number(declared) > maxBytes) throw new Error('response_too_large')
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('response_too_large').catch(() => undefined)
        throw new Error('response_too_large')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  return (await readResponseBufferLimited(response, maxBytes)).toString('utf8')
}
