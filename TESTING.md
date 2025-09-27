# Testing Strategy

This project runs on Bun with TypeScript, so we rely on Bun's built-in test runner (`bun test`) and its mocking utilities. Our approach focuses on fast, deterministic unit tests around the orchestration primitives, with room to layer on slower integration checks in the future.

## Goals
- Validate core logic without reaching external services (GitHub, Slack, Telegram, Claude CLI).
- Guard configuration and stateful workflows against regressions.
- Keep tests hermetic so they can run in CI without special credentials.

## Test Layers
- **Unit tests** (implemented now):
  - `Config.loadOrCreate` path handling, including the interactive wizard (stub readline & TTY).
  - `StateManager` persistence and agent slot allocation using temporary files.
  - `GitHubClient` request construction and label updates via mocked `fetch`.
  - `IssueOrchestrator` control flow when no issues are available, with GitHub/API calls mocked and state captured in a temporary workspace.
- **Integration tests** (future work): exercise repository cloning and Claude process control against disposable repositories or fixtures. Requires sandbox repo + CLI binaries, so tracked separately.

## Mocking & Fixtures
- Use `bun:test` `mock` utilities or manual monkey-patching to replace `fetch`, `readline.createInterface`, and Git helpers.
- Temporary directories (`fs.mkdtempSync`) isolate file-system side effects such as generated configs or `processing-state.json` files.
- When testing orchestrator logic, inject stub configs and patch prototype methods on `GitHubClient` to return canned data instead of hitting the network.

## Execution
- Install dependencies: `bun install`.
- Run the suite: `bun test`.
- Tests should pass on macOS/Linux CI runners with Bun ≥1.0.

## Future Enhancements
- Add smoke tests that spawn a fake repo dir and confirm `RepoManager` clone/pull orchestration (requires Git + test repos).
- Mock Claude CLI output stream to validate `ClaudeProcessor` state transitions without launching the real binary.
- Expand orchestrator coverage to ensure label updates and notifier interactions using stub notifiers that record payloads.
