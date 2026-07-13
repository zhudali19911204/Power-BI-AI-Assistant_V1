import { join } from 'node:path'

const EXECUTABLE_NAME = 'powerbi-modeling-mcp.exe'

export interface McpBinaryLocationInput {
  readonly appPath: string
  readonly resourcesPath: string
  readonly isPackaged: boolean
}

export function resolvePowerBiMcpBinary(input: McpBinaryLocationInput): string {
  const binaryPath = input.isPackaged
    ? join(input.resourcesPath, 'powerbi-modeling-mcp', EXECUTABLE_NAME)
    : join(
        input.appPath,
        'node_modules',
        '@microsoft',
        'powerbi-modeling-mcp-win32-x64',
        'dist',
        EXECUTABLE_NAME
      )

  return binaryPath
}
