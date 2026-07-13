# 阶段 0 验收记录

| 项目 | 内容 |
|---|---|
| 阶段 | 0——项目基线与开发文档 |
| 版本 | 0.1.0 |
| 开发完成日期 | 2026-07-13 |
| 当前状态 | 验收通过 |
| 验收日期 | 2026-07-13 |
| 验收依据 | 项目负责人已启动阶段 0 应用并明确授权进入阶段 1 |
| 技术基线 | `docs/TECHNICAL_DEVELOPMENT.md` 1.0 |

## 1. 本阶段交付

- 已初始化本地 Git，当前未配置远程仓库。
- 已建立 Electron 43、React 19、TypeScript 6 与 Electron Vite 5 工程。
- 已锁定 npm 直接和传递依赖，生成 `package-lock.json`。
- 已建立 Electron Main、Preload、React Renderer 与 Shared Contract 分层。
- 已建立类型化只读 IPC；Renderer 未获得 Node.js 权限。
- 已建立 lint、typecheck、单元测试、集成测试、生产构建、烟雾测试和打包命令。
- 已生成可运行的未安装应用目录 `release/win-unpacked`，仅用于阶段 0 打包验证。
- 最小窗口显示应用名称、版本 `0.1.0`、阶段 `0` 和 Power BI“未连接”状态。

## 2. 范围边界检查

本阶段未实现以下后续阶段能力：

- Power BI Desktop 或语义模型连接。
- Power BI Modeling MCP 集成。
- 大模型 Provider 配置或 API 调用。
- 需求完整性判断。
- DAX、计算列或计算表生成。
- 模型诊断、模型评估或模型写回。

## 3. 自动验证结果

| 验证项 | 命令 | 结果 |
|---|---|---|
| ESLint | `npm run lint` | 通过，0 警告 |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元测试 | `npm run test:unit` | 2 个测试通过 |
| 集成测试 | `npm run test:integration` | 2 个测试通过 |
| 完整质量门禁 | `npm run quality` | 通过 |
| 生产构建 | `npm run build` | 通过 |
| Electron 启动 | `npm run smoke` | 通过，Renderer 返回 `SMOKE_OK` |
| 未安装目录打包 | `npm run package:dir` | 通过 |
| 生产依赖审计 | `npm audit --omit=dev` | 0 个已知漏洞 |

Electron 43.1.0 Windows x64 运行时因开发环境无法访问官方二进制源，改从国内镜像下载；
下载文件的 SHA256 为
`a07dc1e3d5e589593d37e3b19d1b373e02bb58270e2eb0d6633eee0198ad09f0`，与 Electron npm
包内置的官方校验值一致。打包命令固定使用本地已校验运行时，避免重复联网下载。

## 4. 人工验收步骤

在项目根目录执行：

```powershell
npm run dev
```

请检查：

- [x] 应用窗口能够正常打开，无空白页或错误弹窗。
- [x] 标题显示“Power BI 智能助手”。
- [x] 页面显示“阶段 0”和“本地工程基线已就绪”。
- [x] 右上角及页脚均显示 Power BI“未连接”。
- [x] 页脚版本显示 `0.1.0`。
- [x] 确认阶段划分、功能范围和非目标与技术开发文档一致。

验证结束后关闭窗口即可。

## 5. 阶段门禁

阶段 0 的工程交付、自动验证和项目负责人验收已经完成，可以创建阶段验收标签并进入阶段
1。阶段 1 仍须遵守“只连接和读取，不调用大模型、不修改模型”的范围边界。
