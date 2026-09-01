import { describe, expect, it } from 'vitest'
import { sha256ResponseBody } from './lib/offlineHash'

describe('offline artifact body hashing', () => {
  it('hashuiește corpul real incremental și ignoră un ETag copiat', async () => {
    const response = new Response(new Uint8Array([0x61, 0x62, 0x63]), {
      headers: {
        'content-length': '145337486',
        'x-linked-etag': '2f2ab89d085805d52d80062b7751bd63d0b5fbf9c53d0ead111f458633764742',
      },
    })
    await expect(sha256ResponseBody(response)).resolves.toEqual({
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    })
  })
})
