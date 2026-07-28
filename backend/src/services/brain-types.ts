// Messages API wire-format types — the subset the codebase actually uses.
// These are plain TypeScript interfaces describing the JSON that Kimi and GLM
// (both Messages-compatible API endpoints) send and receive. No SDK
// is involved: the native fetch client in `brain.ts` produces/consumes
// exactly these shapes over the wire (POST /v1/messages, SSE streaming).

// ── Content blocks (in a Message response) ────────────────────────────────
export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

// A Message's content is a text/tool_use stream; server-side tool blocks
// (code execution) may also appear at runtime and are read via `unknown[]`
// casts where needed (see sandboxTranscript), so the union stays minimal.
export type ContentBlock = TextBlock | ToolUseBlock

// ── Content-block params (in a request) ───────────────────────────────────
export interface TextBlockParam {
  type: 'text'
  text: string
}

export interface ToolResultBlockParam {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

export interface ImageBlockParam {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

// ── Tool definition ───────────────────────────────────────────────────────
export interface Tool {
  name: string
  description?: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

// ── Messages in a request ─────────────────────────────────────────────────
export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | Array<ContentBlock | ToolResultBlockParam | TextBlockParam | ImageBlockParam>
}

// ── Usage + the assembled Message ─────────────────────────────────────────
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
}

export interface Message {
  id: string
  role: 'assistant'
  model: string
  content: ContentBlock[]
  stop_reason: string | null
  stop_sequence: string | null
  usage: Usage
}

