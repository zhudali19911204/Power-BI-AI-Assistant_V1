import { dirname } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { JsonObject } from './mcp-response-parser'
import { parseMcpToolResult } from './mcp-response-parser'
import {
  assertPhaseOneReadOperation,
  assertPhaseOneToolContracts,
  type PhaseOneMcpTool
} from './readonly-operation-policy'

const MCP_VERSION = '0.5.0-beta.11'
const MCP_ARGUMENTS = ['--start', '--readonly', '--compatibility=PowerBI'] as const
const MCP_TIMEOUT_MS = 60_000

export interface McpCallInput {
  readonly tool: PhaseOneMcpTool
  readonly operation: string
  readonly request?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

export class PowerBiMcpClient {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private startPromise: Promise<void> | null = null
  private closing = false
  private readonly closedListeners = new Set<() => void>()

  constructor(private readonly executablePath: string) {}

  async start(): Promise<void> {
    if (this.client) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    this.closing = false
    let startupCompleted = false
    const transport = new StdioClientTransport({
      command: this.executablePath,
      args: [...MCP_ARGUMENTS],
      cwd: dirname(this.executablePath),
      stderr: 'pipe'
    })
    const client = new Client({ name: 'power-bi-ai-assistant', version: '0.2.0' })

    transport.stderr?.on('data', () => {
      // Drain stderr without logging model names, local paths, or raw MCP output.
    })
    client.onerror = () => {
      // Callers receive a sanitized error from the failed request.
    }
    client.onclose = () => {
      this.client = null
      this.transport = null
      if (!this.closing && startupCompleted) {
        for (const listener of this.closedListeners) listener()
      }
    }

    try {
      await client.connect(transport)
      const tools = await client.listTools(undefined, { timeout: MCP_TIMEOUT_MS })
      assertPhaseOneToolContracts(tools.tools)

      this.client = client
      this.transport = transport
      startupCompleted = true
    } catch (error) {
      await transport.close().catch(() => undefined)
      throw error
    }
  }

  async call(input: McpCallInput): Promise<JsonObject> {
    assertPhaseOneReadOperation(input.tool, input.operation)
    await this.start()

    if (!this.client) {
      throw new Error('Power BI Modeling MCP is unavailable.')
    }

    const result = await this.client.callTool(
      {
        name: input.tool,
        arguments: {
          request: {
            ...(input.request ?? {}),
            operation: input.operation
          }
        }
      },
      undefined,
      { signal: input.signal, timeout: MCP_TIMEOUT_MS, maxTotalTimeout: MCP_TIMEOUT_MS }
    )

    return parseMcpToolResult(result, input.operation)
  }

  onTransportClosed(listener: () => void): () => void {
    this.closedListeners.add(listener)
    return () => this.closedListeners.delete(listener)
  }

  async dispose(): Promise<void> {
    this.closing = true
    const transport = this.transport
    this.client = null
    this.transport = null
    if (transport) await transport.close().catch(() => undefined)
    this.closing = false
  }
}

export function getPowerBiMcpLaunchContract(): {
  readonly version: string
  readonly arguments: readonly string[]
} {
  return { version: MCP_VERSION, arguments: MCP_ARGUMENTS }
}
