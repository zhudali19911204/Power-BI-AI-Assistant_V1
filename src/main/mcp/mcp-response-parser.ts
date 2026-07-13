import { z } from 'zod'

export type JsonObject = Record<string, unknown>

const responseEnvelopeSchema = z
  .object({
    message: z.string().optional(),
    operation: z.string().trim().min(1),
    data: z.unknown().optional()
  })
  .passthrough()

const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
})

const toolResultSchema = z
  .object({
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
    content: z.array(z.unknown()).optional()
  })
  .passthrough()

export class McpResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpResponseError'
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOperationEnvelope(value: unknown, expectedOperation: string): JsonObject | null {
  const envelope = responseEnvelopeSchema.safeParse(value)
  if (!envelope.success) return null
  if (
    envelope.data.operation.toLocaleLowerCase('en-US') !==
    expectedOperation.toLocaleLowerCase('en-US')
  ) {
    throw new McpResponseError('MCP returned a result for a different operation.')
  }
  return envelope.data
}

export function parseMcpToolResult(result: unknown, expectedOperation: string): JsonObject {
  if (expectedOperation.trim().length === 0) {
    throw new McpResponseError('MCP result validation requires an expected operation.')
  }
  const parsedResult = toolResultSchema.safeParse(result)
  if (!parsedResult.success) {
    throw new McpResponseError('MCP returned an invalid result envelope.')
  }

  if (parsedResult.data.isError) {
    throw new McpResponseError('Power BI Modeling MCP reported an operation error.')
  }

  if (isJsonObject(parsedResult.data.structuredContent)) {
    const structured = parseOperationEnvelope(
      parsedResult.data.structuredContent,
      expectedOperation
    )
    if (structured) return structured
  }

  for (const item of parsedResult.data.content ?? []) {
    const content = textContentSchema.safeParse(item)
    if (!content.success) {
      continue
    }

    try {
      const json = JSON.parse(content.data.text) as unknown
      const envelope = parseOperationEnvelope(json, expectedOperation)
      if (envelope) return envelope
    } catch {
      // Continue looking for a valid JSON text block.
    }
  }

  throw new McpResponseError('MCP returned no valid structured JSON payload.')
}

export function getCaseInsensitive(record: JsonObject, names: readonly string[]): unknown {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase('en-US')))
  const entry = Object.entries(record).find(([key]) =>
    wanted.has(key.toLocaleLowerCase('en-US'))
  )
  return entry?.[1]
}

export function readString(record: JsonObject, names: readonly string[]): string | null {
  const value = getCaseInsensitive(record, names)
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

export function readBoolean(record: JsonObject, names: readonly string[]): boolean | null {
  const value = getCaseInsensitive(record, names)
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (value.toLocaleLowerCase('en-US') === 'true') return true
    if (value.toLocaleLowerCase('en-US') === 'false') return false
  }
  return null
}

export function readNumber(record: JsonObject, names: readonly string[]): number | null {
  const value = getCaseInsensitive(record, names)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

export function extractRecords(
  value: unknown,
  collectionKeys: readonly string[] = []
): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!isJsonObject(item)) return []
      const nested = getCaseInsensitive(item, ['definition', 'item'])
      return isJsonObject(nested) ? [nested] : [item]
    })
  }

  if (!isJsonObject(value)) {
    return []
  }

  const nestedCollection = getCaseInsensitive(value, [
    ...collectionKeys,
    'items',
    'results',
    'definitions'
  ])
  if (Array.isArray(nestedCollection)) {
    return extractRecords(nestedCollection)
  }

  const nestedData = getCaseInsensitive(value, ['data'])
  if (nestedData !== undefined && nestedData !== value) {
    const records = extractRecords(nestedData, collectionKeys)
    if (records.length > 0) return records
  }

  return [value]
}

export function findStringDeep(
  value: unknown,
  names: readonly string[],
  depth = 0
): string | null {
  if (depth > 5 || !isJsonObject(value)) return null

  const direct = readString(value, names)
  if (direct) return direct

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findStringDeep(item, names, depth + 1)
        if (found) return found
      }
    } else if (isJsonObject(child)) {
      const found = findStringDeep(child, names, depth + 1)
      if (found) return found
    }
  }

  return null
}
