import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/app-contract'

const initialInfo: AppInfo = {
  name: 'Power BI 智能助手',
  version: '读取中',
  stage: 0,
  connectionStatus: 'disconnected'
}

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo>(initialInfo)

  useEffect(() => {
    let isMounted = true

    void window.powerBiAssistant.getAppInfo().then((info) => {
      if (isMounted) {
        setAppInfo(info)
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <div>
            <p className="eyebrow">POWER BI DESKTOP</p>
            <h1>{appInfo.name}</h1>
          </div>
        </div>

        <div className="connection-status" role="status" aria-label="Power BI 连接状态">
          <span className="status-dot" aria-hidden="true" />
          未连接
        </div>
      </header>

      <section className="hero" aria-labelledby="stage-title">
        <div className="stage-label">阶段 {appInfo.stage}</div>
        <h2 id="stage-title">本地工程基线已就绪</h2>
        <p>
          当前版本用于验证桌面应用、开发工具链和安全边界。Power BI 模型连接将在阶段 1
          开始实现。
        </p>

        <div className="readiness-card">
          <div>
            <span className="readiness-icon" aria-hidden="true">
              ✓
            </span>
          </div>
          <div>
            <h3>开发环境正常</h3>
            <p>Electron、React、TypeScript 与测试工具已完成基础配置。</p>
          </div>
        </div>
      </section>

      <footer>
        <span>内部测试版</span>
        <span aria-hidden="true">·</span>
        <span>版本 {appInfo.version}</span>
        <span aria-hidden="true">·</span>
        <span>Power BI：未连接</span>
      </footer>
    </main>
  )
}
