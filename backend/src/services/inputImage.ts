export const MAX_INPUT_IMAGE_DATA_URL_CHARS = 2_000_000

export type InputImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ParsedInputImage {
  dataUrl: string
  mediaType: InputImageMediaType
  base64: string
}

export interface InputImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: InputImageMediaType
    data: string
  }
}

const INPUT_IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/

/** Canonical validator shared by camera-live and the chat multimodal payload. */
export function parseInputImageDataUrl(value: unknown): ParsedInputImage | null {
  if (typeof value !== 'string' || value.length > MAX_INPUT_IMAGE_DATA_URL_CHARS) return null
  const match = INPUT_IMAGE_DATA_URL.exec(value)
  if (!match) return null
  return {
    dataUrl: value,
    mediaType: match[1] as InputImageMediaType,
    base64: match[2],
  }
}

/** Preserves the validated MIME type until chat maps the block to OpenAI input_image. */
export function inputImageBlock(value: unknown): InputImageBlock | null {
  const parsed = parseInputImageDataUrl(value)
  if (!parsed) return null
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: parsed.mediaType,
      data: parsed.base64,
    },
  }
}
