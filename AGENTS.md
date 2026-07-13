# Repository Guidelines

## Project Structure & Module Organization

This is a Windows Electron, React, and TypeScript application. `src/main/` owns trusted operations: Power BI MCP access, Provider calls, secure storage, IPC, and window security. `src/preload/` exposes the narrow renderer API; `src/renderer/` contains React UI and CSS; `src/shared/` contains cross-process contracts. Tests live in `tests/unit/`, `tests/integration/`, and `tests/manual/`. Documentation is under `docs/`; build helpers are under `scripts/`. Treat `out/`, `release/`, and `coverage/` as generated output.

## Build, Test, and Development Commands

- `npm ci`: install the exact locked dependency set.
- `npm run dev`: build Main/Preload and launch the Vite-backed Electron app.
- `npm run quality`: run ESLint, both TypeScript checks, and all automated tests.
- `npm run test:unit` / `npm run test:integration`: run one test tier with Vitest.
- `npm run smoke`: production-build the app and verify that the renderer mounts.
- `npm run test:live-model`: perform the manual, read-only check against one open PBIX.
- `npm run dist`: run quality gates and create the Windows NSIS build.

## Coding Style & Naming Conventions

Use UTF-8, LF line endings, two-space indentation, and a final newline. Follow existing TypeScript style: single quotes, no semicolons, strict types, and `readonly` contracts where practical. React components use `PascalCase` (`ProviderSettingsDialog.tsx`); hooks use `useCamelCase`; utilities use descriptive kebab-case filenames. Keep cross-process payloads in `src/shared/` and never give Renderer direct filesystem, secret, MCP, or Provider-network access.

## Testing Guidelines

Unit tests use Vitest with jsdom and follow `tests/unit/*.test.ts(x)`. Node integration tests follow `tests/integration/*.integration.test.ts`. Add regression tests for every behavior or security-boundary change. `npm run test:coverage` creates the V8 report; no fixed percentage gate currently exists. Manual Power BI tests must remain read-only.

## Commit & Pull Request Guidelines

History uses concise Conventional Commit-style subjects such as `feat: complete stage 1 Power BI schema browser` and `docs: record stage 1 acceptance`. Keep commits stage-focused. PRs should describe scope, stage boundaries, verification commands, and linked issues; include screenshots for UI changes. Update `docs/STAGE_<N>_ACCEPTANCE.md` for stage deliverables, but do not mark a stage approved before manual acceptance.

## Security & Configuration

Never commit API keys, decrypted secrets, PBIX business data, raw Provider responses, or sensitive screenshots/logs. Preserve DPAPI-backed storage, sender validation, URL/DNS restrictions, CSP, and read-only MCP policies. Do not distribute the preview MCP binary without the required authorization.
