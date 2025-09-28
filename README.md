# Imploid 🚀

Imploid automates GitHub issue triage by watching for issues marked `agent-ready`, preparing clean worktrees, and delegating them to Claude or Codex command-line agents. The CLI focuses on a fast setup experience so you can keep your backlog moving with minimal ceremony.

> Looking for source layout or contribution details? See the [developer guide](README.dev.md).

> ⚠️ **Security notice**: Imploid launches the Claude and Codex CLIs with `--dangerously-skip-sandbox`/`--dangerously-skip-permissions` so they can operate unattended. Only run Imploid in environments where you trust the agents and the repositories they modify.

## What You Can Do 💡

- Quickly configure repositories, agent settings, and notifier credentials with an interactive wizard.
- Run the orchestrator to pull new `agent-ready` issues, spawn agent sessions, and keep labels in sync.
- Refresh Claude command templates locally so agent prompts stay current.
- Receive optional Slack or Telegram notifications as issues progress.

## Requirements ✅

- [Bun](https://bun.sh/) 1.2 or newer (for `bunx`) **or** Node.js 18+ (for `npx`)
- Git CLI with access to your target repositories
- Optional: Claude CLI and/or OpenAI Codex CLI on your `PATH`
- GitHub personal access token with `repo` scope for issue management

## Quick Start (no install) ⚡

Use your preferred package runner to execute the published CLI directly from npm:

```bash
# Configure Imploid for the first time
bunx imploid@latest --config
# or
npx imploid@latest --config
```

During setup you will:

1. Enter or reuse a GitHub token.
2. Choose organizations and repositories to monitor.
3. Confirm the storage directories under `~/.imploid`.
4. Set concurrency limits and optional Slack/Telegram credentials.
5. Point Imploid at your local Claude and/or Codex CLI binaries.

The wizard can be rerun at any time. Existing values are pre-filled so updates are quick.

## Optional Local Install 📦

Install once if you prefer to call `imploid` without `bunx`/`npx`:

```bash
npm install -g imploid
# or with Bun
bun add -g imploid
```

Then run:

```bash
imploid --config   # interactive setup
imploid            # run orchestrator
imploid --setup    # refresh Claude command templates
```

## Daily Usage 🔁

```bash
# Run the orchestrator with your saved configuration
bunx imploid@latest
# or
npx imploid@latest

# Show inline help or version information
bunx imploid@latest --help
npx imploid@latest --version
```

Imploid will read `~/.imploid/processing-state.json`, poll the configured repositories for `agent-ready` issues, and launch the enabled processors in parallel while respecting your concurrency limits.

## Update Claude Command Templates 🧩

If you rely on the Claude CLI, refresh the local `.claude/commands` directory in your repository before kicking off new sessions:

```bash
bunx imploid@latest --setup
# or
npx imploid@latest --setup
```

This command replaces `.claude/commands` with the latest templates from `Hey-Diga/dotclaude`.

## Troubleshooting 🛠️

- **Missing CLI binaries**: ensure `claude` or `codex` are installed and available via `which`. Re-run the configuration wizard to update their paths.
- **Permission issues**: Imploid expects SSH access (`git@github.com`). Verify you can manually clone each repository.
- **Claude commands missing**: run `bunx imploid@latest --setup` (or `npx imploid@latest --setup`) inside the target repository to repopulate `.claude/commands`.
- **Slack/Telegram notifications not arriving**: confirm tokens and channel/chat IDs in `~/.imploid/config.json` and rerun `--config` if needed.
- **Stuck state**: only delete `~/.imploid/processing-state.json` if you are sure no automated work is running; otherwise resolve outstanding issues first.

## Need More Details? 📚

Developers and contributors can find architecture notes, project structure, and testing guidance in the [developer guide](README.dev.md).
