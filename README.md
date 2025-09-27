# Imploid

Modern GitHub issue triage and automation orchestrator built with Bun. The tool polls selected repositories for issues marked as **ready-for-claude**, provisions clean worktrees, and hands them off to automated agents powered by either the Claude CLI or OpenAI Codex CLI. Notifications and state management keep humans in the loop while agents batch through the backlog.

## Highlights

- **Single binary CLI** – `imploid` handles orchestration, configuration, and version reporting.
- **Guided configuration** – prompts fetch repositories from GitHub, apply consistent defaults, and persist everything under `~/.imploid`.
- **Pluggable processors** – shared prompt pipeline with concrete runners for Claude and Codex.
- **Robust state tracking** – JSON state file prevents duplicate processing, enforces concurrency limits, and survives restarts.
- **Notifier integrations** – optional Slack and Telegram messages for start, completion, failure, or required input.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) ≥ 1.2
- Git CLI and `gh` authenticated with repo access
- Optional: Claude CLI and/or OpenAI Codex CLI installed in `$PATH`
- GitHub personal access token with `repo` scope

### Installation

```bash
git clone <repo>
cd imploid
bun install
```

### Configure

```bash
bunx imploid --config
```

The wizard will:

1. Ask for a GitHub token (tap Enter to reuse the saved token on subsequent runs).
2. List organizations, then repositories, letting you multi-select with checkboxes.
3. Fix the working directories to `~/.imploid/config.json` and `~/.imploid/repos`.
4. Configure concurrency, optional Slack/Telegram credentials, and autodetected CLI paths for Claude/Codex.

Configuration can be rerun anytime; the wizard pre-fills existing values while keeping directories consistent.

## Usage

```bash
# Run orchestrator using defaults
bunx imploid

# Show help or version
bunx imploid --help
bunx imploid --version

# Edit configuration explicitly
bunx imploid --config
# or
bunx imploid --config ~/.imploid/config.json
```

### Runtime Flow

1. **State Load** – `~/.imploid/processing-state.json` is read to resume in-flight issues.
2. **Repository Polling** – each configured repo is queried for issues labeled `ready-for-claude`.
3. **Scheduling** – up to `max_concurrent` issues run at once. When a slot opens, the orchestrator reserves agent slots for every processor and launches them together on the same issue.
4. **Processing** –
   - The `RepoManager` fetches/clones worktrees beneath `~/.imploid/repos/<processor>/<repo>_agent_<index>` so each processor operates in its own sandbox.
   - The shared prompt from `src/lib/processors/prompt.ts` guides both Claude and Codex CLI runners.
   - Processors stream output, persist session metadata, enforce timeouts, and update state.
   - Branches are created as `issue-<number>-<processor>` so all processors can work the same issue concurrently without colliding.
5. **Notifications & Labels** – Slack/Telegram notifiers reflect status changes, while GitHub labels transition from `ready-for-claude` → `claude-working` → `claude-completed`/`claude-failed`.

### Processors

- **Claude**: executes the Claude CLI (`claude --dangerously-skip-permissions …`) with streaming JSON output. Session IDs are captured for follow-up.
- **Codex**: runs the OpenAI Codex CLI (`codex --full-auto …`) using the identical prompt. Designed for environments where Claude is unavailable.

At the heart of both processors is `buildIssuePrompt` (`src/lib/processors/prompt.ts`), a curated workflow script that instructs agents to fetch context, analyse discussions, iterate on implementation, and report status. Because the same prompt is reused, behavior stays consistent regardless of which CLI is active. Shared utilities in `src/lib/processors/shared.ts` encapsulate Git branch preparation and notifier error handling so the processors remain focused on command execution.

## Project Structure

```
src/
  lib/
    config.ts          # Configuration load/save + interactive wizard
    orchestrator.ts    # Main orchestrator loop
    repoManager.ts     # Git worktree management
    stateManager.ts    # JSON state persistence
    processors/
      prompt.ts        # Shared issue prompt builder
      shared.ts        # Common helpers for command runners
      claude.ts        # Claude CLI processor
      codex.ts         # Codex CLI processor
tests/
  *.test.ts           # Bun test suite mirrors the src modules
bin/
  imploid  # CLI entry point (Bun script)
```

## Testing

```bash
bun test
```

- Unit tests mock CLI invocations, repository operations, and Inquirer prompts.
- Configuration tests simulate both initial creation and edits with Codex/Claude defaults.

## Troubleshooting

- **Missing CLI binaries**: ensure `claude` or `codex` are installed and discoverable via `which`. The wizard displays the detected paths; override them during configuration if necessary.
- **Permission issues on repos**: the orchestrator expects SSH access (`git@github.com`). Verify you can clone the repo manually with the same user.
- **Slack/Telegram notifications not arriving**: double check tokens and channel/chat IDs in `~/.imploid/config.json`. Rerun the wizard with `--config` to update credentials.
- **Stuck state**: delete `~/.imploid/processing-state.json` only if you are certain no automated work is in flight. Otherwise use the state manager to resolve issues first.

## Contributing

1. Fork the repository and create a branch (e.g., `feature/codex-retries`).
2. Make changes with Bun formatting conventions and keep code comments succinct.
3. Run `bun test` and manually exercise `bunx imploid --config` if changes touch the wizard.
4. Submit a pull request referencing any related issues.

## License

Project contributions should follow the repository’s `LICENSE`. If none exists, add one before distributing binaries or accepting external contributions.
