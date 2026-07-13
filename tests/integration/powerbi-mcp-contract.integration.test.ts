import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PowerBiMcpClient } from '../../src/main/mcp/powerbi-mcp-client'

describe.skipIf(process.platform !== 'win32')('Power BI Modeling MCP contract', () => {
  it('starts the pinned server in read-only mode and lists local instances', async () => {
    const binary = resolve(
      'node_modules/@microsoft/powerbi-modeling-mcp-win32-x64/dist/powerbi-modeling-mcp.exe'
    )
    const client = new PowerBiMcpClient(binary)

    try {
      const result = await client.call({
        tool: 'connection_operations',
        operation: 'ListLocalInstances'
      })

      expect(result.operation).toBe('ListLocalInstances')
      expect(Array.isArray(result.data)).toBe(true)
    } finally {
      await client.dispose()
    }
  }, 20_000)
})
