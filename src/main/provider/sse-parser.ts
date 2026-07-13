import { ProviderServiceError } from './provider-error'

const MAX_PENDING_EVENT_CHARS = 64 * 1024

export interface ParsedSseData {
  readonly done: boolean
  readonly delta: string
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .join('')
}

function parseData(data: string): ParsedSseData {
  if (data.trim() === '[DONE]') return { done: true, delta: '' }

  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    throw new ProviderServiceError('MALFORMED_STREAM', true)
  }
  if (!payload || typeof payload !== 'object') {
    throw new ProviderServiceError('MALFORMED_STREAM', true)
  }

  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices)) {
    throw new ProviderServiceError('MALFORMED_STREAM', true)
  }
  if (choices.length === 0) return { done: false, delta: '' }
  const first = choices[0]
  if (!first || typeof first !== 'object') {
    throw new ProviderServiceError('MALFORMED_STREAM', true)
  }
  const delta = (first as Record<string, unknown>).delta
  if (!delta || typeof delta !== 'object') return { done: false, delta: '' }
  return {
    done: false,
    delta: extractContent((delta as Record<string, unknown>).content)
  }
}

export class OpenAiSseParser {
  private pending = ''

  push(chunk: string): readonly ParsedSseData[] {
    this.pending += chunk
    if (this.pending.length > MAX_PENDING_EVENT_CHARS) {
      throw new ProviderServiceError('RESPONSE_TOO_LARGE', false)
    }

    const parsed: ParsedSseData[] = []
    let match = /\r?\n\r?\n/u.exec(this.pending)
    while (match?.index !== undefined) {
      const eventBlock = this.pending.slice(0, match.index)
      this.pending = this.pending.slice(match.index + match[0].length)
      const event = this.parseEventBlock(eventBlock)
      if (event) parsed.push(event)
      match = /\r?\n\r?\n/u.exec(this.pending)
    }
    return parsed
  }

  finish(): readonly ParsedSseData[] {
    if (!this.pending.trim()) return []
    const event = this.parseEventBlock(this.pending)
    this.pending = ''
    return event ? [event] : []
  }

  private parseEventBlock(block: string): ParsedSseData | null {
    const dataLines = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /u, ''))
    if (dataLines.length === 0) return null
    return parseData(dataLines.join('\n'))
  }
}
