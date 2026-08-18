import AjvModule, { type Options, type ValidateFunction } from 'ajv'

type AjvConstructor = new (options?: Options) => {
  compile<T>(schema: object): ValidateFunction<T>
}

const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as unknown as AjvConstructor

export function compileJsonSchema<T>(schema: object, strict: boolean): ValidateFunction<T> {
  return new Ajv({ allErrors: true, strict }).compile<T>(schema)
}
