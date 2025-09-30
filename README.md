# Imploid 🤖

Imploid automates GitHub issue triage by watching for issues marked `agent-ready`, preparing clean worktrees, and delegating them to Claude or Codex command-line agents. The CLI focuses on a fast setup experience so you can keep your backlog moving with minimal ceremony.

> Looking for source layout or contribution details? See the [developer guide](README.dev.md).

> ⚠️ **Security notice**: Imploid launches the Claude and Codex CLIs with `--dangerously-skip-sandbox`/`--dangerously-skip-permissions` so they can operate unattended. Only run Imploid in environments where you trust the agents and the repositories they modify.

Imploid automates the **Implement** phase defined in the [heydiga dotclaude workflow](https://github.com/Hey-Diga/dotclaude). The agents follow the same structured steps:

1. Gather context from the issue thread and repository.
2. Plan the implementation, outlining the proposed changes.
3. Modify code, run checks, and iterate until the plan is complete.
4. Summarize the work, outstanding tasks, and validation results.

Review the [heydiga dotclaude documentation](https://github.com/Hey-Diga/dotclaude) for the full end-to-end flow, including upstream phases like triage and question answering. Go to [Install HeyDiga Claude Commands](#install-heydiga-claude-commands) to install the required Claude command files into the current repository.

## What You Can Do 💡

- Quickly configure repositories, agent settings, and notifier credentials with an interactive wizard.
- Run the orchestrator to pull new `agent-ready` issues, spawn agent sessions, and keep labels in sync.
- Refresh Claude command templates locally so agent prompts stay current.
- Receive optional Slack or Telegram notifications as issues progress.
- Toggle Claude and Codex processors globally or override them per run.

## Requirements ✅

- [Bun](https://bun.sh/) 1.2 or newer (for `bunx`) **or** Node.js 18+ (for `npx`)
- Git CLI with access to your target repositories
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
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
6. Choose which processors (Claude, Codex) should run by default.

The wizard can be rerun at any time. Existing values are pre-filled so updates are quick.

## Daily Usage 🔁

```bash
# Run the orchestrator with your saved configuration
bunx imploid@latest
# or
npx imploid@latest

# Run in foreground mode with continuous monitoring (polls every 60 seconds)
bunx imploid@latest --foreground
# or
npx imploid@latest --foreground

# Show inline help or version information
bunx imploid@latest --help
npx imploid@latest --version

# Re-run the interactive configuration wizard
bunx imploid@latest --config

# Limit this run to specific processors
bunx imploid@latest --processors claude
```

Imploid will read `~/.imploid/processing-state.json`, poll the configured repositories for `agent-ready` issues, and launch the enabled processors in parallel while respecting your concurrency limits.

### Foreground Mode

The `--foreground` flag runs Imploid continuously, checking for new issues every 60 seconds:

- **Easy monitoring**: See real-time status updates in your terminal
- **No cron needed**: Runs continuously without external scheduling
- **Lock protection**: Prevents multiple instances from running simultaneously
- **Graceful shutdown**: Press Ctrl+C to stop cleanly

Note: Only one instance (foreground or one-shot) can run at a time. The lock file at `~/.imploid/imploid.lock` ensures this.

## Install HeyDiga Claude Commands 🧩

To use the [HeyDiga agent coding flow](https://github.com/Hey-Diga/dotclaude) end to end, install the required Claude command files into the current repository with the `--install-commands` option:

```bash
bunx imploid@latest --install-commands
# or
npx imploid@latest --install-commands
```

Running `--install-commands` refreshes `.claude/commands` with the latest templates from [`Hey-Diga/dotclaude`](https://github.com/Hey-Diga/dotclaude) making easier to follow the workflow.

## Optional Local Install 📦

Install once if you prefer to call `imploid` without `bunx`/`npx`:

```bash
npm install -g imploid
# or with Bun
bun add -g imploid
```

Then run:

```bash
imploid --config            # interactive setup
imploid                     # run orchestrator
imploid --foreground        # run in continuous monitoring mode
imploid --install-commands  # refresh Claude command templates
imploid --processors claude # run only the Claude processor
```

## Scheduling Options 🕒

### Option 1: Foreground Mode (Recommended)

Run Imploid in a terminal or screen/tmux session:

```bash
bunx imploid@latest --foreground
# or
npx imploid@latest --foreground
```

This continuously monitors for issues every 60 seconds without needing cron.

### Option 2: Cron Job

To run Imploid automatically every 5 minutes, add the following lines to your crontab:

```bash
SHELL=/bin/bash
HOME=/home/YOUR_USERNAME
PATH=${HOME}/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * bunx imploid@latest >> ${HOME}/.imploid/cron.log 2>&1
```

Note: Cron jobs won't run if foreground mode is active due to lock protection.

## Troubleshooting 🛠️

- **Missing CLI binaries**: ensure `claude` or `codex` are installed and available via `which`. Re-run the configuration wizard to update their paths.
- **Permission issues**: Imploid expects SSH access (`git@github.com`). Verify you can manually clone each repository.
- **Claude commands missing**: run `bunx imploid@latest --install-commands` (or `npx imploid@latest --install-commands`) inside the target repository to repopulate `.claude/commands`.
- **No processors enabled**: rerun `bunx imploid@latest --config` to toggle defaults or pass `--processors claude` (or `codex`) when launching Imploid.
- **Slack/Telegram notifications not arriving**: confirm tokens and channel/chat IDs in `~/.imploid/config.json` and rerun `--config` if needed.
- **Stuck state**: only delete `~/.imploid/processing-state.json` if you are sure no automated work is running; otherwise resolve outstanding issues first.

## Need More Details? 📚

Developers and contributors can find architecture notes, project structure, and testing guidance in the [developer guide](README.dev.md).
