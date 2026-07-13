# Power BI 智能助手

Windows 本地 Electron 应用，用于连接 Power BI Desktop 语义模型并提供受控的 DAX
生成、诊断与模型评估能力。

当前开发状态：**阶段 0——项目基线**。本阶段不会连接 Power BI，也不会调用大模型。

## 环境要求

- Windows 10/11 x64
- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 常用命令

```powershell
npm install
npm run dev
```

质量检查：

```powershell
npm run quality
```

其他命令：

| 命令 | 用途 |
|---|---|
| `npm run lint` | ESLint 静态检查 |
| `npm run typecheck` | 主进程、预加载和渲染进程类型检查 |
| `npm run test:unit` | 单元测试 |
| `npm run test:integration` | 安全边界集成测试 |
| `npm run smoke` | 构建并执行 Electron 最小启动检查 |
| `npm run package:dir` | 生成未安装的 Windows 应用目录 |
| `npm run dist` | 生成 NSIS x64 安装包；按计划从阶段 5 开始交付 |

## 开发边界

- 技术基线以 [`docs/TECHNICAL_DEVELOPMENT.md`](docs/TECHNICAL_DEVELOPMENT.md) 为准。
- 每个阶段完成后必须停止，经过人工验收后才能进入下一阶段。
- 阶段 0 不包含 Power BI、MCP、LLM、DAX 生成或模型写回功能。
