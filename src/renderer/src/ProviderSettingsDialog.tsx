import { useEffect, useRef, useState } from 'react'
import type { ProviderCapabilities } from '../../shared/provider-contract'
import {
  useProviderSettings,
  type ProviderDraftField,
  type ProviderSettingsState,
  type ProviderTestPhase
} from './useProviderSettings'
import './provider-settings.css'

export interface ProviderSettingsDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

const phaseLabels: Record<ProviderTestPhase, string> = {
  idle: '尚未测试',
  starting: '正在启动测试',
  started: '测试请求已启动',
  retry_wait: '等待重试',
  streaming: '正在接收流式响应',
  cancelling: '正在取消',
  cancelled: '测试已取消',
  completed: '连接测试通过',
  failed: '连接测试失败'
}

function capabilityLabel(value: boolean | null): string {
  if (value === null) return '检测中'
  return value ? '支持' : '不支持'
}

function TestPanel({ settings }: { readonly settings: ProviderSettingsState }): React.JSX.Element {
  const { test } = settings
  const retrySeconds = test.waitMs === null ? null : Math.max(1, Math.ceil(test.waitMs / 1000))
  const completedCapabilities: ProviderCapabilities | null =
    test.phase === 'completed'
      ? {
          supportsStreaming: test.capabilities.streaming === true,
          supportsJsonMode: test.capabilities.jsonMode === true
        }
      : null

  return (
    <section className="provider-test-panel" aria-labelledby="provider-test-heading">
      <div className="provider-test-heading">
        <div>
          <h3 id="provider-test-heading">连接测试</h3>
          <p>只发送内置固定测试文本，不会发送 Power BI Schema、DAX 或业务数据。</p>
        </div>
        <span className={`provider-test-state phase-${test.phase}`} role="status" aria-live="polite">
          {phaseLabels[test.phase]}
        </span>
      </div>

      {test.phase === 'retry_wait' && (
        <p className="provider-retry-copy" role="status">
          第 {test.attempt} 次请求暂未成功，约 {retrySeconds} 秒后重试。
        </p>
      )}

      {(test.phase !== 'idle' || completedCapabilities) && (
        <div className="provider-capabilities" aria-label="Provider 能力检测">
          <span>流式输出：{capabilityLabel(test.capabilities.streaming)}</span>
          <span>JSON Mode：{capabilityLabel(test.capabilities.jsonMode)}</span>
        </div>
      )}

      {test.output && (
        <pre className="provider-test-output" tabIndex={0} aria-label="固定测试文本响应">
          {test.output}
        </pre>
      )}

      {test.error && (
        <div className="provider-test-error" role="alert">
          <strong>{test.error.message}</strong>
          <span>错误代码：{test.error.code}</span>
          {test.error.retryable && <small>可以检查配置后重新测试。</small>}
        </div>
      )}

      <div className="provider-test-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={!settings.canStartTest}
        >
          {test.phase === 'completed' || test.phase === 'failed' || test.phase === 'cancelled'
            ? '重新测试'
            : '测试连接'}
        </button>
        {(settings.canCancelTest || test.phase === 'cancelling') && (
          <button
            type="button"
            className="secondary-button"
            disabled={test.phase === 'cancelling'}
            onClick={() => void settings.cancelTest()}
          >
            {test.phase === 'cancelling' ? '正在取消…' : '取消测试'}
          </button>
        )}
        {test.phase === 'completed' && (
          <span className="provider-test-success" role="status">
            测试回执有效，现在可以保存配置。
          </span>
        )}
      </div>
    </section>
  )
}

function ProviderDialogContent({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const settings = useProviderSettings()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current
    closeButtonRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  const setField = (field: ProviderDraftField, value: string): void => {
    settings.updateDraft(field, value)
  }

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="provider-dialog-backdrop">
      <div
        ref={dialogRef}
        className="provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
        aria-describedby="provider-dialog-description"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="provider-dialog-header">
          <div>
            <p className="section-kicker">阶段 2 · 本地安全配置</p>
            <h2 id="provider-dialog-title">Provider 设置</h2>
            <p id="provider-dialog-description">
              配置 OpenAI-compatible chat/completions 接口并完成固定文本连接测试。
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="provider-dialog-close"
            aria-label="关闭 Provider 设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="provider-dialog-layout">
          <aside className="provider-profile-sidebar" aria-label="Provider 配置列表">
            <div className="provider-profile-sidebar-heading">
              <strong>已保存配置</strong>
              <button type="button" onClick={() => {
                setConfirmDelete(false)
                settings.createProfile()
              }}>
                ＋ 新建
              </button>
            </div>

            {settings.profileOperation === 'loading' ? (
              <p className="provider-profile-empty" role="status">正在读取配置…</p>
            ) : settings.profiles.length === 0 ? (
              <p className="provider-profile-empty">尚未保存 Provider 配置。</p>
            ) : (
              <div className="provider-profile-list">
                {settings.profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={settings.selectedProfile?.id === profile.id ? 'selected' : ''}
                    aria-pressed={settings.selectedProfile?.id === profile.id}
                    onClick={() => {
                      setConfirmDelete(false)
                      settings.selectProfile(profile.id)
                    }}
                  >
                    <span>
                      <strong>{profile.displayName}</strong>
                      <small>{profile.model}</small>
                    </span>
                    {profile.isActive && <em>当前</em>}
                  </button>
                ))}
              </div>
            )}

            {settings.selectedProfile && (
              <div className="provider-profile-management">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    settings.selectedProfile.isActive || settings.profileOperation !== 'idle'
                  }
                  onClick={() => void settings.activateSelectedProfile()}
                >
                  {settings.selectedProfile.isActive ? '当前配置' : '设为当前'}
                </button>
                {!confirmDelete ? (
                  <button
                    type="button"
                    className="text-button danger-button"
                    disabled={settings.profileOperation !== 'idle'}
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除配置
                  </button>
                ) : (
                  <div className="provider-delete-confirm" role="alert">
                    <span>确认删除？</span>
                    <button type="button" onClick={() => void settings.deleteSelectedProfile()}>
                      确认
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
                  </div>
                )}
              </div>
            )}
          </aside>

          <form
            className="provider-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void settings.startTest()
            }}
          >
            <div className="provider-form-title">
              <div>
                <h3>{settings.selectedProfile ? '编辑 Provider' : '新建 Provider'}</h3>
                <p>保存前必须完成当前草稿的连接和能力测试。</p>
              </div>
              {settings.selectedProfile?.isActive && <span>当前使用</span>}
            </div>

            {settings.formError && (
              <div className="provider-form-error" role="alert">
                <strong>{settings.formError.message}</strong>
                <span>错误代码：{settings.formError.code}</span>
              </div>
            )}
            {settings.notice && <p className="provider-form-notice" role="status">{settings.notice}</p>}

            <div className="provider-fields">
              <label>
                <span>配置名称</span>
                <input
                  type="text"
                  value={settings.draft.displayName}
                  maxLength={80}
                  required
                  aria-invalid={Boolean(settings.fieldErrors.displayName)}
                  aria-describedby={settings.fieldErrors.displayName ? 'provider-name-error' : undefined}
                  onChange={(event) => setField('displayName', event.target.value)}
                />
                {settings.fieldErrors.displayName && <small id="provider-name-error">{settings.fieldErrors.displayName}</small>}
              </label>

              <label className="provider-wide-field">
                <span>Chat Completions 地址</span>
                <input
                  type="url"
                  value={settings.draft.chatCompletionsUrl}
                  placeholder="https://provider.example.com/v1/chat/completions"
                  required
                  spellCheck={false}
                  aria-invalid={Boolean(settings.fieldErrors.chatCompletionsUrl)}
                  aria-describedby={settings.fieldErrors.chatCompletionsUrl ? 'provider-url-error' : 'provider-url-hint'}
                  onChange={(event) => setField('chatCompletionsUrl', event.target.value)}
                />
                <small id={settings.fieldErrors.chatCompletionsUrl ? 'provider-url-error' : 'provider-url-hint'}>
                  {settings.fieldErrors.chatCompletionsUrl ?? '仅允许 HTTPS；HTTP 只允许 localhost 和回环地址。'}
                </small>
              </label>

              <label>
                <span>模型名称</span>
                <input
                  type="text"
                  value={settings.draft.model}
                  maxLength={200}
                  required
                  spellCheck={false}
                  aria-invalid={Boolean(settings.fieldErrors.model)}
                  aria-describedby={settings.fieldErrors.model ? 'provider-model-error' : undefined}
                  onChange={(event) => setField('model', event.target.value)}
                />
                {settings.fieldErrors.model && <small id="provider-model-error">{settings.fieldErrors.model}</small>}
              </label>

              <label>
                <span>最大上下文 Token</span>
                <input
                  type="number"
                  min="1024"
                  max="10000000"
                  step="1"
                  value={settings.draft.maxContextTokens}
                  required
                  aria-invalid={Boolean(settings.fieldErrors.maxContextTokens)}
                  aria-describedby={settings.fieldErrors.maxContextTokens ? 'provider-context-error' : undefined}
                  onChange={(event) => setField('maxContextTokens', event.target.value)}
                />
                {settings.fieldErrors.maxContextTokens && <small id="provider-context-error">{settings.fieldErrors.maxContextTokens}</small>}
              </label>

              <label className="provider-wide-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={settings.draft.apiKey}
                  autoComplete="new-password"
                  required={!settings.selectedProfile}
                  placeholder={settings.selectedProfile ? '留空则继续使用已安全保存的密钥' : '输入 API Key'}
                  aria-invalid={Boolean(settings.fieldErrors.apiKey)}
                  aria-describedby={settings.fieldErrors.apiKey ? 'provider-key-error' : 'provider-key-hint'}
                  onChange={(event) => setField('apiKey', event.target.value)}
                />
                <small id={settings.fieldErrors.apiKey ? 'provider-key-error' : 'provider-key-hint'}>
                  {settings.fieldErrors.apiKey ?? (settings.selectedProfile
                    ? '密钥已安全保存且不会回填；留空时由 Main 进程复用。'
                    : '密钥只发送到本地 Main 进程，不写入 Renderer 存储。')}
                </small>
              </label>
            </div>

            <TestPanel settings={settings} />

            <footer className="provider-form-footer">
              <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
              <button
                type="button"
                className="primary-button"
                disabled={!settings.canSave || settings.profileOperation !== 'idle'}
                onClick={() => void settings.saveTestedProfile()}
              >
                {settings.profileOperation === 'saving' ? '正在保存…' : '保存并设为当前'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  )
}

export function ProviderSettingsDialog({
  open,
  onClose
}: ProviderSettingsDialogProps): React.JSX.Element | null {
  return open ? <ProviderDialogContent onClose={onClose} /> : null
}
