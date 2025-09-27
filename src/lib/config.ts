import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import inquirer from "inquirer";

export interface GitHubRepoConfig {
  name: string;
  base_repo_path: string;
}

export interface RawConfig {
  github: {
    token: string;
    repos?: GitHubRepoConfig[];
    repo?: string;
    base_repo_path?: string;
    repo_path?: string;
    max_concurrent?: number;
  };
  telegram?: {
    bot_token?: string;
    chat_id?: string;
  };
  slack?: {
    bot_token?: string;
    channel_id?: string;
  };
  claude: {
    timeout_seconds?: number;
    check_interval?: number;
    path?: string;
  };
}

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_TIMEOUT_SECONDS = 3600;
const DEFAULT_CHECK_INTERVAL = 5;
const DEFAULT_CLAUDE_BIN = "claude";

function expandHomePath(input: string): string {
  if (input.startsWith("~/")) {
    return resolve(process.env.HOME ?? "", input.slice(2));
  }
  return input;
}

function resolveConfigPath(configPath: string): string {
  const expanded = expandHomePath(configPath);
  if (expanded.startsWith("/")) {
    return expanded;
  }
  const __filename = fileURLToPath(import.meta.url);
  const libDir = dirname(__filename);
  return resolve(libDir, "..", expanded);
}

interface GitHubRepoSummary {
  full_name: string;
}

async function fetchAvailableRepos(token: string): Promise<GitHubRepoSummary[]> {
  const results: GitHubRepoSummary[] = [];
  let page = 1;

  while (page <= 5) {
    const response = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ full_name?: string }>;
    const pageRepos = payload.filter((repo) => typeof repo.full_name === "string").map((repo) => ({
      full_name: repo.full_name as string,
    }));

    results.push(...pageRepos);

    if (pageRepos.length < 100) {
      break;
    }
    page += 1;
  }

  return results;
}

async function fetchUserOrganizations(token: string): Promise<string[]> {
  const organizations: string[] = [];
  let page = 1;

  while (page <= 5) {
    const response = await fetch(`https://api.github.com/user/orgs?per_page=100&page=${page}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ login?: string }>;
    const pageOrgs = payload
      .map((org) => org.login)
      .filter((login): login is string => typeof login === "string" && login.length > 0);

    organizations.push(...pageOrgs);

    if (pageOrgs.length < 100) {
      break;
    }
    page += 1;
  }

  return Array.from(new Set(organizations));
}

async function fetchOrgRepos(token: string, organization: string): Promise<GitHubRepoSummary[]> {
  const results: GitHubRepoSummary[] = [];
  let page = 1;

  while (page <= 5) {
    const response = await fetch(
      `https://api.github.com/orgs/${organization}/repos?per_page=100&page=${page}&type=all`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ full_name?: string }>;
    const pageRepos = payload.filter((repo) => typeof repo.full_name === "string").map((repo) => ({
      full_name: repo.full_name as string,
    }));

    results.push(...pageRepos);

    if (pageRepos.length < 100) {
      break;
    }
    page += 1;
  }

  return results;
}

async function promptManualRepositories(requireAtLeastOne: boolean): Promise<string[]> {
  const repositories: string[] = [];

  while (true) {
    const message = repositories.length
      ? "Add another repository (owner/repo) [leave blank to finish]"
      : "Repository full name (owner/repo)";

    const { repo } = await inquirer.prompt<{ repo: string }>([
      {
        type: "input",
        name: "repo",
        message,
        filter: (value: string) => value.trim(),
      },
    ]);

    if (!repo) {
      if (repositories.length || !requireAtLeastOne) {
        break;
      }
      console.log("Please enter at least one repository.");
      continue;
    }

    if (!/^[^/]+\/[^/]+$/.test(repo)) {
      console.log("Please enter repositories using the owner/name format.");
      continue;
    }

    if (!repositories.includes(repo)) {
      repositories.push(repo);
    }
  }

  return repositories;
}

const PERSONAL_REPOS = "__personal__";
const MANUAL_REPO_CHOICE = "__manual__";

async function interactiveConfigure(configPath: string, existing?: RawConfig): Promise<RawConfig> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        "Please create it from config.example.json manually when running without an interactive terminal."
    );
  }

  const modeLabel = existing ? "update" : "create";
  console.log(`\nLet's ${modeLabel} your configuration.`);

  const existingToken = existing?.github?.token ?? "";
  const { githubToken: tokenAnswer } = await inquirer.prompt<{ githubToken: string }>([
    {
      type: "password",
      name: "githubToken",
      message: existing
        ? "GitHub personal access token (leave blank to keep current)"
        : "GitHub personal access token (with repo scope)",
      mask: "*",
      default: existingToken || undefined,
      validate: (value: string) =>
        value.trim().length || existingToken ? true : "Token is required.",
      filter: (value: string) => value.trim(),
    },
  ]);

  const githubToken = tokenAnswer.trim().length ? tokenAnswer.trim() : existingToken;
  if (!githubToken) {
    throw new Error("GitHub personal access token is required.");
  }

  let organizations: string[] = [];
  try {
    organizations = await fetchUserOrganizations(githubToken);
  } catch (error) {
    console.warn("Failed to fetch GitHub organizations:", error);
  }

  const existingRepos = existing?.github?.repos ?? [];
  const existingRepoNames = existingRepos.map((repo) => repo.name);
  const organizationChoices = [
    { name: "Personal repositories", value: PERSONAL_REPOS },
    ...organizations.map((org) => ({ name: org, value: org })),
  ];

  const defaultOwner = existingRepoNames.length ? existingRepoNames[0].split("/")[0] : PERSONAL_REPOS;
  const organizationDefault = organizationChoices.some((choice) => choice.value === defaultOwner)
    ? defaultOwner
    : PERSONAL_REPOS;

  const { organization } = await inquirer.prompt<{ organization: string }>([
    {
      type: "list",
      name: "organization",
      message: "Select organization",
      choices: organizationChoices,
      default: organizationDefault,
    },
  ]);

  let availableRepos: GitHubRepoSummary[] = [];
  try {
    availableRepos =
      organization === PERSONAL_REPOS
        ? await fetchAvailableRepos(githubToken)
        : await fetchOrgRepos(githubToken, organization);
  } catch (error) {
    console.warn("Failed to fetch repositories automatically:", error);
  }

  let selectedRepositories: string[] = [];
  const manualRepositories: string[] = [];

  if (availableRepos.length) {
    const availableRepoSet = new Set(availableRepos.map((repo) => repo.full_name));
    const existingRepoSet = new Set(existingRepoNames);

    const repoChoices = availableRepos.map((repo) => ({
      name: repo.full_name,
      value: repo.full_name,
      checked: existingRepoSet.has(repo.full_name),
    }));

    const manualExisting = existingRepoNames.filter((name) => !availableRepoSet.has(name));
    for (const name of manualExisting) {
      repoChoices.push({
        name: `${name} (from current config)`,
        value: name,
        checked: true,
      });
    }

    repoChoices.push({ name: "Enter repository manually", value: MANUAL_REPO_CHOICE });

    const { repositories } = await inquirer.prompt<{ repositories: string[] }>([
      {
        type: "checkbox",
        name: "repositories",
        message: "Select repositories to monitor",
        choices: repoChoices,
        loop: false,
        pageSize: Math.min(repoChoices.length, 12),
        validate: (value: string[]) => (value.length ? true : "Select at least one repository."),
      },
    ]);

    const manualSelected = repositories.includes(MANUAL_REPO_CHOICE);
    selectedRepositories = repositories.filter((repo) => repo !== MANUAL_REPO_CHOICE);

    if (manualSelected) {
      manualRepositories.push(...(await promptManualRepositories(false)));
    }

    if (!selectedRepositories.length && !manualRepositories.length) {
      console.log("Please choose at least one repository.");
      manualRepositories.push(...(await promptManualRepositories(true)));
    }
  } else {
    if (existingRepoNames.length) {
      console.log("Could not list repositories automatically. Keeping existing entries.");
      selectedRepositories = [...existingRepoNames];
      manualRepositories.push(...(await promptManualRepositories(false)));
    } else {
      console.log("Could not list repositories automatically. Enter full names manually.");
      manualRepositories.push(...(await promptManualRepositories(true)));
    }
  }

  const uniqueRepos = Array.from(new Set([...selectedRepositories, ...manualRepositories]));
  if (!uniqueRepos.length) {
    throw new Error("At least one repository must be configured.");
  }

  const existingBaseDir = existingRepos[0]?.base_repo_path ?? "~/.issue-orchestrator/repos";
  const { baseDir } = await inquirer.prompt<{ baseDir: string }>([
    {
      type: "input",
      name: "baseDir",
      message: "Base directory for agent worktrees",
      default: existingBaseDir,
      filter: (value: string) => value.trim(),
      validate: (value: string) => (value.trim().length ? true : "Base directory is required."),
    },
  ]);
  const baseRepoPath = expandHomePath(baseDir);

  const repos: GitHubRepoConfig[] = uniqueRepos.map((name) => ({
    name,
    base_repo_path: baseRepoPath,
  }));

  const existingMaxConcurrent = existing?.github?.max_concurrent ?? DEFAULT_MAX_CONCURRENT;
  const { maxConcurrent } = await inquirer.prompt<{ maxConcurrent: string }>([
    {
      type: "input",
      name: "maxConcurrent",
      message: "Maximum concurrent issues to process",
      default: String(existingMaxConcurrent),
      validate: (value: string) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) || parsed <= 0 ? "Please enter a positive number." : true;
      },
    },
  ]);
  const maxConcurrentValue = Math.max(1, Math.round(Number(maxConcurrent)));

  const { configureTelegram } = await inquirer.prompt<{ configureTelegram: boolean }>([
    {
      type: "confirm",
      name: "configureTelegram",
      message: "Configure Telegram notifications?",
      default: Boolean(existing?.telegram),
    },
  ]);

  let telegramConfig: RawConfig["telegram"] | undefined;
  if (configureTelegram) {
    const { telegramBotToken } = await inquirer.prompt<{ telegramBotToken: string }>([
      {
        type: "password",
        name: "telegramBotToken",
        message: "Telegram bot token",
        mask: "*",
        default: existing?.telegram?.bot_token ?? undefined,
        validate: (value: string) =>
          value.trim().length || existing?.telegram?.bot_token ? true : "Token is required.",
        filter: (value: string) => value.trim(),
      },
    ]);
    const { telegramChatId } = await inquirer.prompt<{ telegramChatId: string }>([
      {
        type: "input",
        name: "telegramChatId",
        message: "Telegram chat ID",
        default: existing?.telegram?.chat_id ?? undefined,
        validate: (value: string) =>
          value.trim().length || existing?.telegram?.chat_id ? true : "Chat ID is required.",
        filter: (value: string) => value.trim(),
      },
    ]);
    const resolvedTelegramToken = telegramBotToken || existing?.telegram?.bot_token || "";
    const resolvedTelegramChatId = telegramChatId || existing?.telegram?.chat_id || "";
    telegramConfig = { bot_token: resolvedTelegramToken, chat_id: resolvedTelegramChatId };
  }

  const { configureSlack } = await inquirer.prompt<{ configureSlack: boolean }>([
    {
      type: "confirm",
      name: "configureSlack",
      message: "Configure Slack notifications?",
      default: Boolean(existing?.slack),
    },
  ]);

  let slackConfig: RawConfig["slack"] | undefined;
  if (configureSlack) {
    const { slackBotToken } = await inquirer.prompt<{ slackBotToken: string }>([
      {
        type: "password",
        name: "slackBotToken",
        message: "Slack bot token",
        mask: "*",
        default: existing?.slack?.bot_token ?? undefined,
        validate: (value: string) =>
          value.trim().length || existing?.slack?.bot_token ? true : "Token is required.",
        filter: (value: string) => value.trim(),
      },
    ]);
    const { slackChannelId } = await inquirer.prompt<{ slackChannelId: string }>([
      {
        type: "input",
        name: "slackChannelId",
        message: "Slack channel ID",
        default: existing?.slack?.channel_id ?? undefined,
        validate: (value: string) =>
          value.trim().length || existing?.slack?.channel_id ? true : "Channel ID is required.",
        filter: (value: string) => value.trim(),
      },
    ]);
    const resolvedSlackToken = slackBotToken || existing?.slack?.bot_token || "";
    const resolvedSlackChannel = slackChannelId || existing?.slack?.channel_id || "";
    slackConfig = { bot_token: resolvedSlackToken, channel_id: resolvedSlackChannel };
  }

  const whichClaude = spawnSync("which", ["claude"], { encoding: "utf8" });
  const detectedClaude = whichClaude.status === 0 ? whichClaude.stdout.trim() : "";
  const claudeDefault = existing?.claude?.path ?? (detectedClaude || DEFAULT_CLAUDE_BIN);

  const { claudePath } = await inquirer.prompt<{ claudePath: string }>([
    {
      type: "input",
      name: "claudePath",
      message: "Claude CLI path",
      default: claudeDefault,
      filter: (value: string) => value.trim(),
      validate: (value: string) => (value.trim().length ? true : "Claude path is required."),
    },
  ]);
  const resolvedClaudePath = expandHomePath(claudePath || claudeDefault);

  const existingTimeout = existing?.claude?.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
  const { claudeTimeout } = await inquirer.prompt<{ claudeTimeout: string }>([
    {
      type: "input",
      name: "claudeTimeout",
      message: "Claude run timeout in seconds",
      default: String(existingTimeout),
      validate: (value: string) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) || parsed <= 0 ? "Please enter a positive number." : true;
      },
    },
  ]);
  const claudeTimeoutValue = Math.max(1, Math.round(Number(claudeTimeout)));

  const existingInterval = existing?.claude?.check_interval ?? DEFAULT_CHECK_INTERVAL;
  const { claudeCheckInterval } = await inquirer.prompt<{ claudeCheckInterval: string }>([
    {
      type: "input",
      name: "claudeCheckInterval",
      message: "Claude status check interval (seconds)",
      default: String(existingInterval),
      validate: (value: string) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) || parsed <= 0 ? "Please enter a positive number." : true;
      },
    },
  ]);
  const claudeCheckIntervalValue = Math.max(1, Math.round(Number(claudeCheckInterval)));

  const config: RawConfig = {
    github: {
      token: githubToken,
      repos,
      max_concurrent: maxConcurrentValue,
    },
    claude: {
      path: resolvedClaudePath,
      timeout_seconds: claudeTimeoutValue,
      check_interval: claudeCheckIntervalValue,
    },
  };

  if (telegramConfig) {
    config.telegram = telegramConfig;
  }
  if (slackConfig) {
    config.slack = slackConfig;
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`\nConfiguration saved to ${configPath}.\n`);
  return config;
}

async function readRawConfigIfExists(configPath: string): Promise<RawConfig | undefined> {
  try {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as RawConfig;
    if (!parsed.github || !parsed.claude) {
      throw new Error("Missing required config sections: github, claude");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function loadRawConfig(configPath: string): Promise<RawConfig> {
  const existing = await readRawConfigIfExists(configPath);
  if (existing) {
    return existing;
  }
  return interactiveConfigure(configPath);
}

export class Config {
  private constructor(private readonly configPath: string, private readonly config: RawConfig) {}

  static async loadOrCreate(configPath = "config.json"): Promise<Config> {
    const resolved = resolveConfigPath(configPath);
    const raw = await loadRawConfig(resolved);
    return new Config(resolved, raw);
  }

  get githubToken(): string {
    return this.config.github.token;
  }

  get githubRepos(): GitHubRepoConfig[] {
    if (this.config.github.repos && this.config.github.repos.length) {
      return this.config.github.repos;
    }
    if (this.config.github.repo && this.config.github.base_repo_path) {
      return [
        {
          name: this.config.github.repo,
          base_repo_path: this.config.github.base_repo_path,
        },
      ];
    }
    return [];
  }

  get githubRepo(): string {
    return this.githubRepos[0]?.name ?? "";
  }

  get baseRepoPath(): string {
    return this.githubRepos[0]?.base_repo_path ?? "";
  }

  get repoPath(): string {
    return this.config.github.repo_path ?? "";
  }

  getRepoConfig(repoName: string): GitHubRepoConfig | undefined {
    return this.githubRepos.find((repo) => repo.name === repoName);
  }

  getRepoPath(agentIndex: number, repoName?: string): string {
    const selectedRepo = repoName ? this.getRepoConfig(repoName) : this.githubRepos[0];
    if (!selectedRepo) {
      throw new Error(`Repository ${repoName ?? "<default>"} not found in configuration`);
    }

    const basePath = resolve(expandHomePath(selectedRepo.base_repo_path));
    const repoShortName = selectedRepo.name.split("/").pop() ?? selectedRepo.name;
    return resolve(basePath, `${repoShortName}_agent_${agentIndex}`);
  }

  get maxConcurrent(): number {
    return this.config.github.max_concurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  get telegramBotToken(): string {
    return this.config.telegram?.bot_token ?? "";
  }

  get telegramChatId(): string {
    return this.config.telegram?.chat_id ?? "";
  }

  get slackBotToken(): string {
    return this.config.slack?.bot_token ?? "";
  }

  get slackChannelId(): string {
    return this.config.slack?.channel_id ?? "";
  }

  get claudeTimeout(): number {
    return this.config.claude.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
  }

  get claudeCheckInterval(): number {
    return this.config.claude.check_interval ?? DEFAULT_CHECK_INTERVAL;
  }

  get claudePath(): string {
    return this.config.claude.path ?? DEFAULT_CLAUDE_BIN;
  }
}

export async function configureInteractive(configPath = "config.json"): Promise<Config> {
  const resolved = resolveConfigPath(configPath);
  const existing = await readRawConfigIfExists(resolved);
  const updated = await interactiveConfigure(resolved, existing);
  return new Config(resolved, updated);
}
