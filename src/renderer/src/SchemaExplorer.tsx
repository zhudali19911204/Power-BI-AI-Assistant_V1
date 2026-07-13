import { useMemo, useState } from 'react'
import type {
  ModelColumn,
  ModelMeasure,
  ModelRelationship,
  ModelSnapshot,
  ModelTable
} from '../../shared/model-contract'

type SelectedObject =
  | { readonly kind: 'table'; readonly table: ModelTable }
  | { readonly kind: 'column'; readonly table: ModelTable; readonly column: ModelColumn }
  | { readonly kind: 'measure'; readonly table: ModelTable; readonly measure: ModelMeasure }

interface SchemaExplorerProps {
  readonly snapshot: ModelSnapshot
}

function includesQuery(values: readonly (string | null)[], query: string): boolean {
  return values.some((value) => value?.toLocaleLowerCase().includes(query))
}

function tableKindLabel(kind: ModelTable['kind']): string {
  if (kind === 'calculatedTable') return '计算表'
  if (kind === 'calculationGroup') return '计算组'
  return '数据表'
}

function columnKindLabel(kind: ModelColumn['kind']): string {
  if (kind === 'calculated') return '计算列'
  if (kind === 'calculatedTableColumn') return '计算表列'
  if (kind === 'rowNumber') return '行号列'
  if (kind === 'data') return '数据列'
  return '其他列'
}

function dateTableLabel(table: ModelTable): string {
  if (table.dateTableStatus === 'marked') return '已标记日期表'
  if (table.dateTableStatus === 'unmarked') return '未标记日期表'
  return '日期标记状态未知'
}

function DefinitionList({
  items
}: {
  readonly items: readonly [label: string, value: string | null][]
}): React.JSX.Element {
  return (
    <dl className="object-properties">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function DaxDefinition({ expression }: { readonly expression: string | null }): React.JSX.Element {
  return (
    <section className="dax-definition" aria-label="DAX 定义">
      <div className="detail-section-title">
        <h4>DAX 定义</h4>
        <span>只读</span>
      </div>
      {expression ? (
        <pre tabIndex={0}>
          <code>{expression}</code>
        </pre>
      ) : (
        <p className="muted-copy">当前模型未返回表达式。</p>
      )}
    </section>
  )
}

function ObjectDetails({ selected }: { readonly selected: SelectedObject | null }): React.JSX.Element {
  if (!selected) {
    return (
      <aside className="object-details empty-details" aria-label="对象详情">
        <span className="empty-details-icon" aria-hidden="true">
          i
        </span>
        <h3>查看对象详情</h3>
        <p>从左侧选择表、列或度量值，查看其属性和只读 DAX 定义。</p>
      </aside>
    )
  }

  if (selected.kind === 'table') {
    const dateLabel = dateTableLabel(selected.table)
    return (
      <aside className="object-details" aria-label="对象详情">
        <p className="detail-type">{tableKindLabel(selected.table.kind)}</p>
        <h3>{selected.table.name}</h3>
        <DefinitionList
          items={[
            ['状态', selected.table.isHidden ? '已隐藏' : '可见'],
            ['列', String(selected.table.columns.length)],
            ['度量值', String(selected.table.measures.length)],
            ['日期表', dateLabel],
            ['日期列', selected.table.dateColumn],
            ['说明', selected.table.description]
          ]}
        />
        {selected.table.kind === 'calculatedTable' && (
          <DaxDefinition expression={selected.table.expression} />
        )}
      </aside>
    )
  }

  if (selected.kind === 'column') {
    const { column, table } = selected
    return (
      <aside className="object-details" aria-label="对象详情">
        <p className="detail-type">{columnKindLabel(column.kind)}</p>
        <h3>{column.name}</h3>
        <p className="qualified-name">'{table.name}'[{column.name}]</p>
        <DefinitionList
          items={[
            ['数据类型', column.dataType],
            ['格式', column.formatString],
            ['汇总方式', column.summarizeBy],
            ['显示文件夹', column.displayFolder],
            ['排序依据', column.sortByColumn],
            ['状态', column.isHidden ? '已隐藏' : '可见'],
            ['说明', column.description]
          ]}
        />
        {column.kind === 'calculated' && <DaxDefinition expression={column.expression} />}
      </aside>
    )
  }

  const { measure, table } = selected
  return (
    <aside className="object-details" aria-label="对象详情">
      <p className="detail-type">度量值</p>
      <h3>{measure.name}</h3>
      <p className="qualified-name">'{table.name}'[{measure.name}]</p>
      <DefinitionList
        items={[
          ['主表', measure.tableName],
          ['数据类型', measure.dataType],
          ['格式', measure.formatString],
          ['显示文件夹', measure.displayFolder],
          ['状态', measure.isHidden ? '已隐藏' : '可见'],
          ['说明', measure.description]
        ]}
      />
      <DaxDefinition expression={measure.expression} />
    </aside>
  )
}

function TableTree({
  table,
  query,
  onSelect
}: {
  readonly table: ModelTable
  readonly query: string
  readonly onSelect: (selected: SelectedObject) => void
}): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(true)
  const tableMatches = includesQuery([table.name, table.description], query)
  const columns = table.columns.filter(
    (column) =>
      tableMatches ||
      includesQuery([column.name, column.description, column.displayFolder], query)
  )
  const measures = table.measures.filter(
    (measure) =>
      tableMatches ||
      includesQuery([measure.name, measure.description, measure.displayFolder], query)
  )

  if (!tableMatches && columns.length === 0 && measures.length === 0) return null

  const isExpanded = isOpen || query.length > 0

  return (
    <div className={`schema-table ${isExpanded ? 'open' : ''}`}>
      <div className="schema-table-header">
        <button
          type="button"
          className="tree-toggle"
          aria-label={`${isExpanded ? '收起' : '展开'} ${table.name}`}
          aria-expanded={isExpanded}
          onClick={() => setIsOpen((value) => !value)}
        >
          <span className="tree-chevron" aria-hidden="true">
          ›
          </span>
        </button>
        <button type="button" className="tree-object table-object" onClick={() => onSelect({ kind: 'table', table })}>
          <span className="object-icon table-icon" aria-hidden="true">
            ▦
          </span>
          <span className="tree-name">{table.name}</span>
          {table.isHidden && <span className="visibility-label">隐藏</span>}
        </button>
        <span className="tree-count">{columns.length + measures.length}</span>
      </div>
      {isExpanded && <ul className="schema-objects">
        {columns.map((column) => (
          <li key={`column:${column.name}`}>
            <button
              type="button"
              className="tree-object"
              aria-label={column.name}
              onClick={() => onSelect({ kind: 'column', table, column })}
            >
              <span className="object-icon column-icon" aria-hidden="true">
                {column.kind === 'calculated' ? 'ƒ' : 'Ⅲ'}
              </span>
              <span className="tree-name">{column.name}</span>
              <span className="object-data-type" aria-hidden="true">{column.dataType}</span>
            </button>
          </li>
        ))}
        {measures.map((measure) => (
          <li key={`measure:${measure.name}`}>
            <button
              type="button"
              className="tree-object"
              aria-label={measure.name}
              onClick={() => onSelect({ kind: 'measure', table, measure })}
            >
              <span className="object-icon measure-icon" aria-hidden="true">
                ∑
              </span>
              <span className="tree-name">{measure.name}</span>
              <span className="object-data-type" aria-hidden="true">{measure.dataType ?? '度量值'}</span>
            </button>
          </li>
        ))}
      </ul>}
    </div>
  )
}

function relationshipDirection(relationship: ModelRelationship): string {
  const behavior = relationship.crossFilteringBehavior?.toLocaleLowerCase()
  if (behavior?.includes('both')) return '双向'
  if (behavior?.includes('single')) return '单向'
  return relationship.crossFilteringBehavior ?? '未知'
}

function RelationshipsView({
  relationships,
  query
}: {
  readonly relationships: readonly ModelRelationship[]
  readonly query: string
}): React.JSX.Element {
  const visibleRelationships = relationships.filter((relationship) =>
    includesQuery(
      [
        relationship.name,
        relationship.fromTable,
        relationship.fromColumn,
        relationship.toTable,
        relationship.toColumn
      ],
      query
    )
  )

  if (visibleRelationships.length === 0) {
    return (
      <div className="empty-list" role="status">
        <h3>{query ? '未找到匹配的关系' : '当前模型没有关系'}</h3>
        <p>{query ? '请尝试其他表名或列名。' : '关系创建后将在这里显示。'}</p>
      </div>
    )
  }

  return (
    <div className="relationship-table-wrap">
      <table className="relationship-table">
        <thead>
          <tr>
            <th scope="col">从</th>
            <th scope="col">关系</th>
            <th scope="col">到</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {visibleRelationships.map((relationship) => (
            <tr key={relationship.name}>
              <td>
                <strong>{relationship.fromTable}</strong>
                <span>[{relationship.fromColumn}]</span>
              </td>
              <td>
                <span className="cardinality">
                  {relationship.fromCardinality ?? '?'} → {relationship.toCardinality ?? '?'}
                </span>
                <small>{relationship.name}</small>
                <small>{relationshipDirection(relationship)}</small>
              </td>
              <td>
                <strong>{relationship.toTable}</strong>
                <span>[{relationship.toColumn}]</span>
              </td>
              <td>
                <span className={`relationship-state ${relationship.isActive ? 'active' : ''}`}>
                  {relationship.isActive ? '活动' : '非活动'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SchemaExplorer({ snapshot }: SchemaExplorerProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'schema' | 'relationships'>('schema')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SelectedObject | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const matchingTableCount = useMemo(
    () =>
      snapshot.tables.filter((table) => {
        if (includesQuery([table.name, table.description], normalizedQuery)) return true
        return (
          table.columns.some((column) =>
            includesQuery([column.name, column.description], normalizedQuery)
          ) ||
          table.measures.some((measure) =>
            includesQuery([measure.name, measure.description], normalizedQuery)
          )
        )
      }).length,
    [normalizedQuery, snapshot.tables]
  )

  return (
    <section className="schema-workspace" aria-labelledby="schema-heading">
      <div className="workspace-heading">
        <div>
          <p className="section-kicker">只读模型视图</p>
          <h2 id="schema-heading">模型架构</h2>
          <p>
            快照时间：
            {new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'medium',
              timeStyle: 'medium'
            }).format(new Date(snapshot.capturedAt))}
          </p>
        </div>
        <label className="schema-search">
          <span className="visually-hidden">搜索模型对象</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索表、列、度量值或关系"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">
              ×
            </button>
          )}
        </label>
      </div>

      <div className="workspace-tabs" role="tablist" aria-label="模型视图">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'schema'}
          onClick={() => setActiveTab('schema')}
        >
          表与对象
          <span>{snapshot.statistics.tables}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'relationships'}
          onClick={() => setActiveTab('relationships')}
        >
          关系
          <span>{snapshot.statistics.relationships}</span>
        </button>
      </div>

      {activeTab === 'schema' ? (
        <div className="schema-grid" role="tabpanel" aria-label="表与对象">
          <div className="schema-tree" aria-label="模型对象列表">
            <div className="tree-summary">
              <span>{normalizedQuery ? `找到 ${matchingTableCount} 个表` : '全部表'}</span>
              <span>{snapshot.statistics.columns} 列 · {snapshot.statistics.measures} 度量值</span>
            </div>
            {snapshot.tables.map((table) => (
              <TableTree
                key={table.name}
                table={table}
                query={normalizedQuery}
                onSelect={setSelected}
              />
            ))}
            {matchingTableCount === 0 && (
              <div className="empty-list" role="status">
                <h3>未找到匹配对象</h3>
                <p>请尝试更短的表名、列名或度量值名。</p>
              </div>
            )}
          </div>
          <ObjectDetails selected={selected} />
        </div>
      ) : (
        <div role="tabpanel" aria-label="关系">
          <RelationshipsView relationships={snapshot.relationships} query={normalizedQuery} />
        </div>
      )}
    </section>
  )
}
