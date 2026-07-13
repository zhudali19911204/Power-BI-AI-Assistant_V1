# Power BI 智能助手

Windows 本地 Electron 应用，用于连接 Power BI Desktop 语义模型并提供受控的 DAX
生成、诊断与模型评估能力。

当前开发状态：**阶段 2——功能首页与 Provider 配置（开发版，待真实 Provider 验收）**。

阶段 2 在阶段 1 的只读 Power BI 连接与 Schema 浏览基础上，增加固定的五功能首页和
OpenAI-compatible Provider 配置。API Key 仅由 Electron Main 使用 Windows 安全存储加密；
保存前必须通过鉴权、流式响应和 JSON Mode 能力探测，测试可取消。

> 阶段 2 只向 Provider 发送应用内置的固定连接测试文本，不发送 Power BI Schema、对象名称、
> DAX 或用户业务需求。五个功能入口目前只显示后续阶段边界，不启动业务处理。

## 环境要求

- Windows 10/11 x64
- Node.js 22.12 或更高版本
- npm 10 或更高版本
- Power BI Desktop x64（需要浏览真实模型时）

## 启动阶段 2 应用

在项目目录执行：

```powershell
npm install
npm run dev
```

应用启动后会自动扫描 Power BI 模型；Provider 设置不依赖 Power BI，可以直接打开。
若同时打开多个 PBIX，请先选择模型；连接后可以在“功能首页”和“模型架构”之间切换。

## 阶段 2 手工检查

1. 点击顶部“Provider 设置”，选择“新建 Provider”。
2. 填写显示名称、完整的 `chat/completions` HTTPS 地址、模型名、最大上下文和 API Key。
   地址不能包含查询参数；本机开发服务可以使用 `http://localhost`、`127.0.0.1` 或 `[::1]`。
3. 点击“测试连接”，确认能够看到流式固定文本、流式能力和 JSON Mode 探测结果；测试期间
   “取消测试”应立即可用。
4. 只有测试成功后才能保存。保存后再次编辑时，API Key 输入框应保持为空并显示已安全保存。
5. 分别使用两个国产 OpenAI-compatible Provider 重复测试和保存，检查 401/403、429/5xx
   或错误地址时只显示安全的中文错误，不显示密钥或原始响应。
6. 打开一个 PBIX，确认首页恰好显示五个固定功能；点击卡片只显示阶段边界，不调用 Provider。

真实 Provider 验收结果记录在
[`docs/STAGE_2_ACCEPTANCE.md`](docs/STAGE_2_ACCEPTANCE.md)。不要把 API Key 写入命令行、
环境变量、测试夹具、截图或日志。

## 阶段 1 回归检查

1. 未打开 PBIX 时，确认应用显示打开模型的引导。
2. 打开一个 PBIX 并重新扫描，确认应用自动连接并显示 Schema。
3. 抽查表、列、数据类型、度量值表达式和关系是否与 Power BI Desktop 一致。
4. 同时打开两个 PBIX，确认应用要求选择且可以切换。
5. 关闭当前连接的 PBIX，确认旧 Schema 在健康检查窗口内被清空，并可重新连接。

只打开一个待验收 PBIX 时，可以额外执行严格只读的真实模型结构检查：

```powershell
npm run test:live-model
```

阶段 1 的已验收结果见 [`docs/STAGE_1_ACCEPTANCE.md`](docs/STAGE_1_ACCEPTANCE.md)。

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
| `npm run test:integration` | 安全边界、Provider 协议与 MCP 只读契约集成测试 |
| `npm run test:live-model` | 对当前唯一打开的 PBIX 执行只读 Schema 完整性检查 |
| `npm run smoke` | 构建并执行 Electron 最小启动检查 |
| `npm run package:dir` | 回归打包基线；当前不会包含 MCP 二进制 |
| `npm run dist` | NSIS 基线；许可门禁通过前不得作为阶段 1 交付物分发 |

## 开发边界

- 技术基线以 [`docs/TECHNICAL_DEVELOPMENT.md`](docs/TECHNICAL_DEVELOPMENT.md) 为准。
- 每个阶段完成后必须停止，经过人工验收后才能进入下一阶段。
- 阶段 2 仅增加固定功能路由与 Provider 配置/连接测试；不包含需求完整性判断、DAX 生成、
  诊断执行、模型评估执行或任何模型写回。
- Provider 测试请求体由 Main 内置，不接受 Renderer 传入任意提示词或 Power BI 内容。

## MCP 预览许可

项目精确锁定 `@microsoft/powerbi-modeling-mcp-win32-x64@0.5.0-beta.11`，仅用于本机内部
开发和测试。该预览组件当前不进入应用安装包；取得 Microsoft 另行授权或完成组织法务确认
前，不得分享、发布、分发或转让包含该组件的构建产物。
