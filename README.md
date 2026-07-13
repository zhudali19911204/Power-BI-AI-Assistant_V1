# Power BI 智能助手

Windows 本地 Electron 应用，用于连接 Power BI Desktop 语义模型并提供受控的 DAX
生成、诊断与模型评估能力。

当前开发状态：**阶段 1——Power BI 连接与 Schema 浏览（开发完成，待真实模型验收）**。

阶段 1 可以发现本机已打开的 Power BI Desktop 模型，以严格只读方式连接并浏览表、列、
度量值和关系。只有一个模型时自动连接，多个模型时由用户选择；模型关闭、切换或 MCP
连接中断后，旧快照会立即失效。

## 环境要求

- Windows 10/11 x64
- Node.js 22.12 或更高版本
- npm 10 或更高版本
- Power BI Desktop x64（需要浏览真实模型时）

## 启动阶段 1 应用

1. 在 Power BI Desktop 中打开一个 PBIX 文件。也可以暂不打开，用于验证“未发现模型”状态。
2. 在项目目录执行：

```powershell
npm install
npm run dev
```

应用启动后会自动扫描模型。若同时打开多个模型，请在应用中选择要连接的模型。

> 阶段 1 不调用大模型、不执行 DAX 查询，也不会创建、更新或删除任何模型对象。

## 阶段 1 手工检查

1. 未打开 PBIX 时，确认应用显示打开模型的引导。
2. 打开一个 PBIX 并重新扫描，确认应用自动连接并显示 Schema。
3. 抽查表、列、数据类型、度量值表达式和关系是否与 Power BI Desktop 一致。
4. 同时打开两个 PBIX，确认应用要求选择且可以切换。
5. 关闭当前连接的 PBIX，确认旧 Schema 在健康检查窗口内被清空，并可重新连接。

只打开一个待验收 PBIX 时，可以额外执行严格只读的真实模型结构检查：

```powershell
npm run test:live-model
```

详细结果与待验收项见 [`docs/STAGE_1_ACCEPTANCE.md`](docs/STAGE_1_ACCEPTANCE.md)。

## 开发命令

```powershell
npm run quality
```

其他命令：

| 命令 | 用途 |
|---|---|
| `npm run lint` | ESLint 静态检查 |
| `npm run typecheck` | 主进程、预加载和渲染进程类型检查 |
| `npm run test:unit` | 单元测试 |
| `npm run test:integration` | 安全边界与 MCP 只读契约集成测试 |
| `npm run test:live-model` | 对当前唯一打开的 PBIX 执行只读 Schema 完整性检查 |
| `npm run smoke` | 构建并执行 Electron 最小启动检查 |
| `npm run package:dir` | 回归打包基线；当前不会包含 MCP 二进制 |
| `npm run dist` | NSIS 基线；许可门禁通过前不得作为阶段 1 交付物分发 |

## 开发边界

- 技术基线以 [`docs/TECHNICAL_DEVELOPMENT.md`](docs/TECHNICAL_DEVELOPMENT.md) 为准。
- 每个阶段完成后必须停止，经过人工验收后才能进入下一阶段。
- 阶段 1 仅包含 Power BI 只读连接、Schema 快照和浏览，不包含 Provider 配置、LLM、
  需求完整性判断、DAX 生成、诊断、模型评估或写回。

## MCP 预览许可

项目精确锁定 `@microsoft/powerbi-modeling-mcp-win32-x64@0.5.0-beta.11`，仅用于本机内部
开发和测试。该预览组件当前不进入应用安装包；取得 Microsoft 另行授权或完成组织法务确认
前，不得分享、发布、分发或转让包含该组件的构建产物。
