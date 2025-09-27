# Repository Guidelines

## Project Structure & Module Organization
The Bun/TypeScript implementation lives in `src`. Core orchestration modules are under `src/lib` (e.g., `orchestrator.ts`, `repoManager.ts`, `processors/claude.ts`, `processors/codex.ts`). Shared utilities and notifiers sit in sibling folders under `src/lib`, while the compiled CLI entry point lives in `bin/imploid`. Automated tests mirror this layout under `tests`, using Bun’s test runner. Runtime state files like `~/.imploid/processing-state.json` remain out of version control but are essential for local runs.

## Build, Test, and Development Commands
Install dependencies with `bun install`. Execute the orchestrator using `bunx imploid` or run individual modules via `bun run src/...` when debugging. Monitor processor activity with the Bun scripts under `bin/` as needed. Run the full test suite using `bun test`; target specific files with `bun test tests/orchestrator.test.ts` or filter using `-t`.

## Coding Style & Naming Conventions
Follow the existing TypeScript conventions: four-space indentation, `camelCase` for functions/variables, and `PascalCase` for classes/enums (see `src/lib/models.ts`). Prefer explicit return types and leverage shared utilities instead of introducing duplicate logic. Keep new modules under `src/lib`, exporting through `src/lib/index.ts` only when they are part of the public CLI surface. Configuration templates should stay alongside `README.md` and `config` documentation.

## Testing Guidelines
Use Bun’s built-in test runner. Name new specs `<feature>.test.ts` and place them under `tests`. Keep tests focused, mocking shell/process utilities where helpful. Validate concurrency and repo state logic with targeted fixtures before shipping features. For quick iterations, run commands like `bun test tests/repoManager.test.ts -t "pulls latest changes"`.

## Commit & Pull Request Guidelines
Write concise, present-tense commit messages (e.g., "Add repo manager cleanup") and reference GitHub issues in the body (`Fixes #123`). Call out configuration or state-file changes explicitly. Pull requests should summarize behavior changes, list manual test commands, and attach screenshots or logs for Slack/Telegram flows when they change.

## Security & Configuration Tips
Duplicate `config.example.json` to `config.json`, populate tokens locally, and avoid committing secrets. Telegram and Slack tokens should be sourced from environment variables or `.env` files excluded from git. When testing against GitHub, ensure personal access tokens carry the minimal scopes needed for issue triage.
