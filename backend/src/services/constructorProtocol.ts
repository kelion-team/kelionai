import AjvModule, { type ErrorObject, type Options, type ValidateFunction } from 'ajv'

export const CONSTRUCTOR_PROTOCOL_ID = 'kelion.constructor/v1' as const

export const COMENZI_VERIFICARE_CONSTRUCTOR = [
  'npm --prefix backend run build',
  'npm --prefix backend run typecheck',
  'npm --prefix backend run lint',
  'npm --prefix backend test',
  'npm --prefix frontend run build',
  'npm --prefix frontend run lint',
  'node scripts/verifica-sintaxa.mjs',
  'node scripts/verifica-exporturi.mjs',
] as const

type ComandaVerificare = (typeof COMENZI_VERIFICARE_CONSTRUCTOR)[number]
export type AccesFisierConstructor = 'inspect' | 'create' | 'modify' | 'delete'

export interface ConstructorProtocol {
  protocol: typeof CONSTRUCTOR_PROTOCOL_ID
  naturalLanguage: {
    task: string
    rationale: string
    instructions: Array<{ operationId: string; text: string }>
  }
  technical: {
    files: Array<{ path: string; access: AccesFisierConstructor }>
    operations: Array<{
      id: string
      action: AccesFisierConstructor
      file: string
      symbol?: string
    }>
    checks: Array<
      | { type: 'command'; command: ComandaVerificare }
      | { type: 'condition'; assertion: string }
    >
  }
}

const PATH_PATTERN = '^(?!/)(?![A-Za-z]:[\\\\/])(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[A-Za-z0-9_.@/+\\-]+$'

export const CONSTRUCTOR_PROTOCOL_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://kelionai.app/schemas/constructor-protocol-v1.json',
  title: 'Kelion constructor protocol v1',
  type: 'object',
  additionalProperties: false,
  required: ['protocol', 'naturalLanguage', 'technical'],
  properties: {
    protocol: { const: CONSTRUCTOR_PROTOCOL_ID },
    naturalLanguage: {
      type: 'object',
      additionalProperties: false,
      required: ['task', 'rationale', 'instructions'],
      properties: {
        task: { type: 'string', minLength: 8, maxLength: 2500 },
        rationale: { type: 'string', minLength: 1, maxLength: 1200 },
        instructions: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['operationId', 'text'],
            properties: {
              operationId: { type: 'string', pattern: '^S[1-9][0-9]?$' },
              text: { type: 'string', minLength: 3, maxLength: 500 },
            },
          },
        },
      },
    },
    technical: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'operations', 'checks'],
      properties: {
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'access'],
            properties: {
              path: { type: 'string', minLength: 1, maxLength: 240, pattern: PATH_PATTERN },
              access: { enum: ['inspect', 'create', 'modify', 'delete'] },
            },
          },
        },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'action', 'file'],
            properties: {
              id: { type: 'string', pattern: '^S[1-9][0-9]?$' },
              action: { enum: ['inspect', 'create', 'modify', 'delete'] },
              file: { type: 'string', minLength: 1, maxLength: 240, pattern: PATH_PATTERN },
              symbol: { type: 'string', minLength: 1, maxLength: 160 },
            },
          },
        },
        checks: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'command'],
                properties: {
                  type: { const: 'command' },
                  command: { enum: COMENZI_VERIFICARE_CONSTRUCTOR },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'assertion'],
                properties: {
                  type: { const: 'condition' },
                  assertion: { type: 'string', minLength: 3, maxLength: 500 },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const

type AjvConstructor = new (options?: Options) => {
  compile<T>(schema: object): ValidateFunction<T>
}
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown as AjvConstructor
const ajv = new Ajv({ allErrors: true, strict: true })
const valideazaSchema = ajv.compile<ConstructorProtocol>(CONSTRUCTOR_PROTOCOL_SCHEMA)

export interface ProtocolVerdict {
  ok: boolean
  protocol: ConstructorProtocol | null
  errors: string[]
}

export function normalizeazaCatalogConstructor(repositoryFiles: unknown[]): string[] {
  return [...new Set(repositoryFiles.map(String))]
    .filter(esteCaleProtocolConstructorSigura)
    .slice(0, 2500)
}

function eroriAjv(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
}

export function esteCaleProtocolConstructorSigura(path: string): boolean {
  if (!path || path.length > 240 || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')) return false
  const segmente = path.split('/')
  return /^[A-Za-z0-9_.@/+-]+$/.test(path) &&
    segmente.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

export function valideazaConstructorProtocol(value: unknown, repositoryFiles: string[] = []): ProtocolVerdict {
  if (!valideazaSchema(value)) return { ok: false, protocol: null, errors: eroriAjv(valideazaSchema.errors) }

  const protocol = value as ConstructorProtocol
  const errors: string[] = []
  const paths = protocol.technical.files.map((f) => f.path)
  const pathSet = new Set(paths)
  if (pathSet.size !== paths.length) errors.push('technical.files contains duplicate paths')
  for (const path of paths) if (!esteCaleProtocolConstructorSigura(path)) errors.push(`unsafe file path: ${path}`)
  const repositorySet = new Set(normalizeazaCatalogConstructor(repositoryFiles))
  if (repositorySet.size) {
    const repositoryDirs = new Set([...repositorySet].flatMap((file) => {
      const parts = file.split('/')
      const dirs: string[] = []
      for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'))
      return dirs
    }))
    for (const file of protocol.technical.files) {
      if (file.access === 'create') {
        const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
        if (parent && !repositoryDirs.has(parent)) errors.push(`create parent directory is not in repository: ${parent}`)
      } else if (!repositorySet.has(file.path)) {
        errors.push(`protocol file is not in repository catalog: ${file.path}`)
      }
    }
  }

  const operationIds = protocol.technical.operations.map((o) => o.id)
  if (new Set(operationIds).size !== operationIds.length) errors.push('technical.operations contains duplicate ids')
  const accessByPath = new Map(protocol.technical.files.map((f) => [f.path, f.access]))
  for (const operation of protocol.technical.operations) {
    if (!pathSet.has(operation.file)) errors.push(`operation ${operation.id} references undeclared file: ${operation.file}`)
    const access = accessByPath.get(operation.file)
    if (operation.action !== 'inspect' && access && access !== operation.action)
      errors.push(`operation ${operation.id} action ${operation.action} conflicts with file access ${access}`)
  }

  const instructionIds = protocol.naturalLanguage.instructions.map((i) => i.operationId)
  if (new Set(instructionIds).size !== instructionIds.length)
    errors.push('naturalLanguage.instructions contains duplicate operation ids')
  const operationIdSet = new Set(operationIds)
  for (const id of instructionIds) if (!operationIdSet.has(id)) errors.push(`instruction references unknown operation: ${id}`)
  for (const id of operationIds) if (!instructionIds.includes(id)) errors.push(`operation has no natural-language instruction: ${id}`)

  return errors.length ? { ok: false, protocol: null, errors } : { ok: true, protocol, errors: [] }
}

export function parseazaConstructorProtocol(text: string, repositoryFiles: string[] = []): ProtocolVerdict {
  let raw = String(text ?? '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith('{') || !raw.endsWith('}'))
    return { ok: false, protocol: null, errors: ['response must contain one JSON object and no prose'] }
  try {
    return valideazaConstructorProtocol(JSON.parse(raw) as unknown, repositoryFiles)
  } catch (error) {
    return { ok: false, protocol: null, errors: [`invalid JSON: ${String((error as Error).message ?? error)}`] }
  }
}

export function fisiereDinConstructorProtocol(protocol: ConstructorProtocol): string[] {
  return protocol.technical.files.map((f) => f.path)
}

/** Compatibilitate temporara pentru workerul vechi in timpul unui rolling deploy. */
export function protocolCaPlanText(protocol: ConstructorProtocol): string {
  const instructions = new Map(protocol.naturalLanguage.instructions.map((i) => [i.operationId, i.text]))
  const files = protocol.technical.files.map((f) => `- ${f.path} [${f.access}]`).join('\n')
  const steps = protocol.technical.operations
    .map((o, index) => `${index + 1}) ${o.action} ${o.file}${o.symbol ? ` :: ${o.symbol}` : ''} — ${instructions.get(o.id) ?? o.id}`)
    .join('\n')
  const checks = protocol.technical.checks
    .map((c) => `- ${c.type === 'command' ? c.command : c.assertion}`)
    .join('\n')
  return `FILES:\n${files}\nSTEPS:\n${steps}\nCHECK:\n${checks}`
}
