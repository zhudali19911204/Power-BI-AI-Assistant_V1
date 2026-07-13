import { useRef, useState } from 'react'
import type {
  ConnectionPhase,
  ConnectionViewState,
  DesktopModelCandidate,
  DisconnectReason
} from '../../shared/connection-contract'
import { SchemaExplorer } from './SchemaExplorer'
import { FeatureHome } from './FeatureHome'
import { ProviderSettingsDialog } from './ProviderSettingsDialog'
import { usePowerBiConnection } from './usePowerBiConnection'
import './phase2-shell.css'

const phaseLabels: Record<ConnectionPhase, string> = {
  idle: '准备连接',
  discovering: '正在查找 Power BI',
  no_models: '未发现模型',
  selection_required: '请选择模型',
  connecting: '正在连接',
  loading_schema: '正在读取架构',
  connected: '已连接',
  disconnected: '连接已断开',
  reconnecting: '正在重新连接',
  error: '连接失败'
}

function isBusy(phase: ConnectionPhase): boolean {
  return ['idle', 'discovering', 'connecting', 'loading_schema', 'reconnecting'].includes(phase)
}

function reasonCopy(reason: DisconnectReason | null): string {
  if (reason === 'model_closed') return '已连接的 Power BI Desktop 模型已关闭。'
  if (reason === 'mcp_stopped') return '本地 Power BI 连接服务已停止。'
  if (reason === 'connection_failed') return '未能建立 Power BI 连接。'
  if (reason === 'user') return '你已断开当前模型。'
  return '当前没有连接 Power BI Desktop 模型。'
}

function StatusBadge({ connection }: { readonly connection: ConnectionViewState }): React.JSX.Element {
  return (
    <div
      className={`connection-status phase-${connection.phase}`}
      role="status"
      aria-live="polite"
      aria-label="Power BI 连接状态"
    >
      <span className="status-dot" aria-hidden="true" />
      {phaseLabels[connection.phase]}
    </div>
  )
}

function LoadingState({ phase }: { readonly phase: ConnectionPhase }): React.JSX.Element {
  const loadingCopy =
    phase === 'loading_schema'
      ? '正在读取表、列、度量值和关系…'
      : phase === 'connecting'
        ? '正在建立安全的本地只读连接…'
        : '正在扫描本机已打开的 Power BI Desktop 模型…'

  return (
    <section className="center-state" aria-labelledby="loading-heading">
      <div className="large-spinner" aria-hidden="true" />
      <p className="section-kicker">阶段 1 · 本地模型连接</p>
      <h2 id="loading-heading">{phaseLabels[phase]}</h2>
      <p>{loadingCopy}</p>
    </section>
  )
}

function NoModelsState({ onRescan }: { readonly onRescan: () => void }): React.JSX.Element {
  return (
    <section className="center-state no-models" aria-labelledby="no-model-heading">
      <div className="state-icon" aria-hidden="true">
        P
      </div>
      <p className="section-kicker">未找到可用连接</p>
      <h2 id="no-model-heading">先打开一个 Power BI 模型</h2>
      <p>助手只会连接本机当前已打开的 Power BI Desktop 模型。</p>
      <ol className="connection-guide">
        <li><span>1</span><p><strong>打开 Power BI Desktop</strong>确认已安装并启动 Power BI Desktop。</p></li>
        <li><span>2</span><p><strong>打开 .pbix 文件</strong>等待报表和数据模型完全加载。</p></li>
        <li><span>3</span><p><strong>返回后重新扫描</strong>将自动发现已打开的模型。</p></li>
      </ol>
      <button type="button" className="primary-button" onClick={onRescan}>
        <span aria-hidden="true">↻</span>
        重新扫描
      </button>
    </section>
  )
}

function ModelSelection({
  candidates,
  onConnect,
  onRescan
}: {
  readonly candidates: readonly DesktopModelCandidate[]
  readonly onConnect: (candidate: DesktopModelCandidate) => void
  readonly onRescan: () => void
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('')
  const selected = candidates.find((candidate) => candidate.candidateId === selectedId)

  return (
    <section className="selection-state" aria-labelledby="selection-heading">
      <div className="selection-heading">
        <div>
          <p className="section-kicker">发现 {candidates.length} 个模型</p>
          <h2 id="selection-heading">选择要连接的模型</h2>
          <p>选择本次要查看的 Power BI Desktop 窗口。</p>
        </div>
        <button type="button" className="secondary-button" onClick={onRescan}>
          重新扫描
        </button>
      </div>
      <fieldset className="model-options">
        <legend className="visually-hidden">可用 Power BI 模型</legend>
        {candidates.map((candidate) => (
          <label className={`model-option ${selectedId === candidate.candidateId ? 'selected' : ''}`} key={candidate.candidateId}>
            <input
              type="radio"
              name="power-bi-model"
              value={candidate.candidateId}
              checked={selectedId === candidate.candidateId}
              onChange={() => setSelectedId(candidate.candidateId)}
            />
            <span className="model-option-icon" aria-hidden="true">P</span>
            <span className="model-option-copy">
              <strong>{candidate.displayName}</strong>
              <span>{candidate.modelName ?? '模型名称未返回'}</span>
              {candidate.disambiguator && <small>{candidate.disambiguator}</small>}
            </span>
            <span className="radio-mark" aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <div className="selection-actions">
        <p>连接仅用于读取模型元数据，阶段 1 不会修改模型。</p>
        <button
          type="button"
          className="primary-button"
          disabled={!selected}
          onClick={() => selected && onConnect(selected)}
        >
          连接所选模型
        </button>
      </div>
    </section>
  )
}

function FailureState({
  connection,
  onReconnect
}: {
  readonly connection: ConnectionViewState
  readonly onReconnect: () => void
}): React.JSX.Element {
  const isError = connection.phase === 'error'
  return (
    <section className="center-state failure-state" aria-labelledby="failure-heading">
      <div className="state-icon failure-icon" aria-hidden="true">!</div>
      <p className="section-kicker">Power BI 连接</p>
      <h2 id="failure-heading">{isError ? '连接时遇到问题' : '模型连接已断开'}</h2>
      <p>{connection.error?.message ?? reasonCopy(connection.disconnectReason)}</p>
      {connection.error?.code && <p className="error-code">错误代码：{connection.error.code}</p>}
      {(connection.error?.retryable ?? true) && (
        <button type="button" className="primary-button" onClick={onReconnect}>
          <span aria-hidden="true">↻</span>
          重新连接
        </button>
      )}
    </section>
  )
}

function CountBadge({ label, value }: { readonly label: string; readonly value: number }): React.JSX.Element {
  return (
    <div className="count-badge">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<'home' | 'schema'>('home')
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false)
  const providerSettingsButtonRef = useRef<HTMLButtonElement>(null)
  const {
    appInfo,
    connection,
    snapshot,
    schemaLoading,
    schemaError,
    discover,
    connect,
    disconnect,
    reconnect
  } = usePowerBiConnection()

  const active = connection.activeConnection
  const counts = active?.objectCounts
  const closeProviderSettings = (): void => {
    setProviderSettingsOpen(false)
    providerSettingsButtonRef.current?.focus()
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div>
            <p className="eyebrow">POWER BI DESKTOP</p>
            <h1>{appInfo.name}</h1>
          </div>
        </div>
        <div className="phase2-top-actions">
          {connection.phase === 'connected' && active && (
            <nav className="connected-navigation" aria-label="已连接模型页面">
              <button
                type="button"
                aria-current={activeView === 'home' ? 'page' : undefined}
                onClick={() => setActiveView('home')}
              >
                功能首页
              </button>
              <button
                type="button"
                aria-current={activeView === 'schema' ? 'page' : undefined}
                onClick={() => setActiveView('schema')}
              >
                模型架构
              </button>
            </nav>
          )}
          <button
            ref={providerSettingsButtonRef}
            type="button"
            className="provider-settings-button"
            aria-haspopup="dialog"
            aria-expanded={providerSettingsOpen}
            onClick={() => setProviderSettingsOpen(true)}
          >
            Provider 设置
          </button>
          <StatusBadge connection={connection} />
        </div>
      </header>

      {connection.phase === 'connected' && active ? (
        <>
          <section className="connected-banner" aria-labelledby="connected-model-name">
            <div className="connected-model">
              <span className="connected-check" aria-hidden="true">✓</span>
              <div>
                <p>当前连接模型</p>
                <h2 id="connected-model-name">{active.displayName}</h2>
                <span>{active.modelName}</span>
              </div>
            </div>
            {counts && (
              <div className="model-counts" aria-label="模型对象统计">
                <CountBadge label="表" value={counts.tables} />
                <CountBadge label="列" value={counts.columns} />
                <CountBadge label="度量值" value={counts.measures} />
                <CountBadge label="关系" value={counts.relationships} />
              </div>
            )}
            <div className="connected-actions">
              <button type="button" className="secondary-button" onClick={() => void discover()}>切换模型</button>
              <button type="button" className="text-button danger-button" onClick={() => void disconnect()}>断开连接</button>
            </div>
          </section>

          {activeView === 'home' ? (
            <FeatureHome />
          ) : (
            <>
              {schemaLoading && (
                <section className="schema-loading" role="status">
                  <div className="small-spinner" aria-hidden="true" />
                  <div><strong>正在加载模型架构</strong><p>读取表、列、度量值和关系…</p></div>
                </section>
              )}
              {schemaError && (
                <section className="inline-error" role="alert">
                  <div><strong>无法显示模型架构</strong><p>{schemaError}</p></div>
                  <button type="button" className="secondary-button" onClick={() => void reconnect()}>重新连接</button>
                </section>
              )}
              {snapshot && <SchemaExplorer key={snapshot.snapshotId} snapshot={snapshot} />}
            </>
          )}
        </>
      ) : isBusy(connection.phase) ? (
        <LoadingState phase={connection.phase} />
      ) : connection.phase === 'no_models' ? (
        <NoModelsState onRescan={() => void discover()} />
      ) : connection.phase === 'selection_required' ? (
        <ModelSelection
          key={connection.updatedAt}
          candidates={connection.candidates}
          onConnect={(candidate) => void connect(candidate)}
          onRescan={() => void discover()}
        />
      ) : (
        <FailureState connection={connection} onReconnect={() => void reconnect()} />
      )}

      <ProviderSettingsDialog open={providerSettingsOpen} onClose={closeProviderSettings} />

      <footer>
        <span>内部测试版</span>
        <span aria-hidden="true">·</span>
        <span>版本 {appInfo.version}</span>
        <span aria-hidden="true">·</span>
        <span>阶段 {appInfo.stage}</span>
        <span aria-hidden="true">·</span>
        <span>Power BI：{phaseLabels[connection.phase]}</span>
      </footer>
    </main>
  )
}
