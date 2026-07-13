import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PowerBiMcpClient } from '../../src/main/mcp/powerbi-mcp-client'
import { MicrosoftPowerBiReadAdapter } from '../../src/main/powerbi/powerbi-read-adapter'
import { buildModelSnapshot } from '../../src/main/powerbi/schema-service'

describe('stage 1 live Power BI model acceptance', () => {
  it('reads one open Desktop model into a complete, grounded snapshot', async () => {
    const binary = resolve(
      'node_modules/@microsoft/powerbi-modeling-mcp-win32-x64/dist/powerbi-modeling-mcp.exe'
    )
    const adapter = new MicrosoftPowerBiReadAdapter(new PowerBiMcpClient(binary))
    let connection: Awaited<ReturnType<typeof adapter.connect>> | null = null

    try {
      const models = await adapter.discoverDesktopModels()
      expect(
        models,
        '请在 Power BI Desktop 中只打开一个待验收的 PBIX 模型。'
      ).toHaveLength(1)

      connection = await adapter.connect(models[0]!)
      const rawModel = await adapter.readModel(connection)
      const { snapshot, registry } = buildModelSnapshot(rawModel, {
        connectionId: randomUUID(),
        connectionSessionId: randomUUID()
      })

      expect(snapshot.tables.length).toBeGreaterThan(0)
      expect(snapshot.schemaHash).toMatch(/^[a-f0-9]{64}$/)
      expect(snapshot.statistics).toEqual({
        tables: snapshot.tables.length,
        columns: snapshot.tables.reduce((total, table) => total + table.columns.length, 0),
        measures: snapshot.tables.reduce((total, table) => total + table.measures.length, 0),
        relationships: snapshot.relationships.length
      })

      for (const table of snapshot.tables) {
        expect(registry.resolveTable(table.name)).toBe(table)
        for (const column of table.columns) {
          expect(column.dataType.length).toBeGreaterThan(0)
          expect(registry.resolveColumn(table.name, column.name)).toBe(column)
        }
        for (const measure of table.measures) {
          expect(measure.expression?.length ?? 0).toBeGreaterThan(0)
          expect(registry.resolveMeasure(measure.name, table.name)).toBe(measure)
        }
      }

      for (const relationship of snapshot.relationships) {
        expect(
          registry.resolveColumn(relationship.fromTable, relationship.fromColumn)
        ).toBeDefined()
        expect(
          registry.resolveColumn(relationship.toTable, relationship.toColumn)
        ).toBeDefined()
      }
    } finally {
      if (connection) await adapter.disconnect(connection).catch(() => undefined)
      await adapter.dispose()
    }
  }, 120_000)
})
