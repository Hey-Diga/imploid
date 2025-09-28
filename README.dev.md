# Imploid Developer Guide

This guide covers the source layout, development workflow, and testing strategy for contributors.

## Architecture Overview

- **CLI entry point**: `bin/imploid` parses flags (`--config`, `--install-commands`, `--version`) and routes into the orchestrator or configuration helpers.
- **Core orchestration**: `src/lib/orchestrator.ts` coordinates repository polling, processor scheduling, and state tracking.
- **Processors**: `src/lib/processors/claude.ts` and `src/lib/processors/codex.ts` execute the respective CLIs using the shared prompt in `src/lib/processors/prompt.ts`.
- **State & repos**: `src/lib/stateManager.ts` persists progress under `~/.imploid`, while `src/lib/repoManager.ts` manages per-processor worktrees.
- **Claude commands installer**: `src/lib/claudeCommandsInstaller.ts` mirrors the public `Hey-Diga/dotclaude` commands into `.claude/commands` when the CLI is invoked with `--install-commands`.

## Project Structure

```
src/
  lib/
    claudeCommandsInstaller.ts  # Pulls command templates from Hey-Diga/dotclaude
    config.ts               # Configuration persistence and interactive wizard
    orchestrator.ts         # Main orchestrator loop
    repoManager.ts          # Git worktree management
    stateManager.ts         # Issue/process state tracking
    processors/
      claude.ts             # Claude CLI runner
      codex.ts              # Codex CLI runner
      prompt.ts             # Shared issue prompt
      shared.ts             # Common helpers for processors
bin/
  imploid                   # Bun CLI entry point
tests/
  *.test.ts                 # Bun test suite mirrors src modules
```

## Local Setup

```bash
bun install
```

- Bun 1.2+ is required.
- Configuration, state, and repo clones live under `~/.imploid`.

## Key Commands

```bash
bunx imploid --config    # Interactive configuration wizard
bunx imploid             # Run orchestrator using saved config
bunx imploid --install-commands  # Refresh .claude/commands in the current repo
bun test                 # Run the full Bun test suite
bun test tests/<file>    # Target a specific test file
```

## Coding Standards

- TypeScript with four-space indentation.
- `camelCase` for functions and variables; `PascalCase` for classes and enums.
- Prefer explicit return types and shared utilities in `src/lib`.
- Keep CLI-facing exports surfaced through `src/lib/index.ts` when needed.

## Testing Guidance

- Use Bun’s test runner (`bun test`).
- Name new specs `<feature>.test.ts` under `tests/`.
- Mock shell/process utilities when executing external commands.
- Verify concurrency and repo state changes with targeted fixtures.

## Contributing Workflow

1. Branch from `main` (e.g., `feature/install-commands-flag`).
2. Implement changes and update tests/documentation.
3. Run `bun test` and, if relevant, manual flows like `bunx imploid --config` or `bunx imploid --install-commands`.
4. Follow repository commit guidelines (present tense, reference issues in the body) before submitting a pull request.
