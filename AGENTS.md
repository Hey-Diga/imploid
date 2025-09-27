# Repository Guidelines

## Project Structure & Module Organization
The Python implementation lives in `python`. Core orchestration modules are under `python/lib` (e.g., `orchestrator.py`, `repo_manager.py`, `claude_processor.py`). CLI entry points (`run_orchestrator.py`, `issue_orchestrator.py`) sit alongside setup assets such as `config.example.json`, `setup.sh`, and integration manifests. Automated tests reside in `python/tests`, while targeted manual scripts (`test_slack_links.py`, `test_slack_manual.py`) support Slack integration checks. Runtime state files like `~/.issue-orchestrator/processing-state.json` and the optional `venv/` directory stay out of version control but matter for local runs.

## Build, Test, and Development Commands
Run `./setup.sh` to seed a virtualenv, install requirements, and prepare ignored paths. Execute the orchestrator with `./venv/bin/python run_orchestrator.py` for the primary workflow or `./venv/bin/python -m lib.orchestrator` when importing as a package. Monitor active Claude sessions via `./venv/bin/python claude_monitor.py monitor`, or inspect a single issue with `./venv/bin/python claude_monitor.py status --issue 123`. Run the full test suite using `./venv/bin/pytest tests/`; add `--cov=lib` if you need coverage details.

## Coding Style & Naming Conventions
Follow standard Python 3 conventions: four-space indentation, `snake_case` for functions and modules, and `PascalCase` for classes (see `lib.models.ProcessStatus`). Favor type hints and dataclasses where existing modules do. Keep new modules under `python/lib`, exporting them in `python/lib/__init__.py` only when needed for public APIs. Configuration templates belong next to `config.example.json`.

## Testing Guidelines
Use pytest with `pytest-asyncio` for async orchestrator flows. Name new tests `test_<feature>.py` and place them under `python/tests`. Prefer focused async test coroutines marked with `@pytest.mark.asyncio`. Validate concurrency and repo state logic with fixtures before shipping features. For quick iterations, run `./venv/bin/pytest tests/test_repo_manager.py -k clone`.

## Commit & Pull Request Guidelines
Write concise, present-tense commit messages (e.g., "Add repo manager cleanup") similar to the existing `first python version` history. Reference GitHub issues in the body (`Fixes #123`) and note configuration changes explicitly. Pull requests should summarize behavior changes, list manual test commands, and attach screenshots or logs for Slack/Telegram flows when they change.

## Security & Configuration Tips
Duplicate `config.example.json` to `config.json`, populate tokens locally, and avoid committing secrets. Telegram and Slack tokens should be sourced from environment variables or `.env` files excluded from git. When testing against GitHub, ensure personal access tokens carry the minimal scopes needed for issue triage.
