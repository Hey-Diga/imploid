import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

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

async function runSetupWizard(configPath: string): Promise<RawConfig> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        "Please create it from config.example.json manually when running without an interactive terminal."
    );
  }

  console.log("\nConfiguration file not found. Let's create one together.");
  console.log("Press Enter to accept the suggestion shown in brackets.\n");

  const rl = readline.createInterface({ input, output });

  const ask = async (question: string, defaultValue?: string): Promise<string> => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer.length ? answer : defaultValue ?? "";
  };

  const askRequired = async (question: string, defaultValue?: string): Promise<string> => {
    while (true) {
      const answer = await ask(question, defaultValue);
      if (answer.trim().length) {
        return answer.trim();
      }
      console.log("This field is required.");
    }
  };

  const askYesNo = async (question: string, defaultValue = false): Promise<boolean> => {
    const yesValues = new Set(["y", "yes"]);
    const noValues = new Set(["n", "no"]);
    const defaultLabel = defaultValue ? "Y/n" : "y/N";

    while (true) {
      const answer = (await ask(`${question} (${defaultLabel})`)).toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      if (yesValues.has(answer)) {
        return true;
      }
      if (noValues.has(answer)) {
        return false;
      }
      console.log("Please answer with 'y' or 'n'.");
    }
  };

  const askNumber = async (question: string, defaultValue: number): Promise<number> => {
    while (true) {
      const answer = await ask(question, String(defaultValue));
      const parsed = Number(answer);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
      console.log("Please enter a positive number.");
    }
  };

  try {
    const githubToken = await askRequired("GitHub personal access token (with repo scope)");
    const repoCount = Math.max(1, Math.round(await askNumber("How many GitHub repositories should be monitored?", 1)));

    const repos: GitHubRepoConfig[] = [];
    for (let i = 0; i < repoCount; i += 1) {
      console.log(`\nRepository ${i + 1} of ${repoCount}`);
      const name = await askRequired("  Repository full name (owner/repo)");
      const basePathInput = await ask(
        "  Base path where orchestrator can create agent clones",
        "~/issue-orchestrator-worktrees"
      );
      repos.push({
        name,
        base_repo_path: expandHomePath(basePathInput),
      });
    }

    const maxConcurrent = Math.max(1, Math.round(await askNumber("Maximum concurrent issues to process", DEFAULT_MAX_CONCURRENT)));

    const useTelegram = await askYesNo("Configure Telegram notifications?", false);
    let telegramConfig: RawConfig["telegram"] | undefined;
    if (useTelegram) {
      const botToken = await askRequired("Telegram bot token");
      const chatId = await askRequired("Telegram chat ID");
      telegramConfig = { bot_token: botToken, chat_id: chatId };
    }

    const useSlack = await askYesNo("Configure Slack notifications?", false);
    let slackConfig: RawConfig["slack"] | undefined;
    if (useSlack) {
      const botToken = await askRequired("Slack bot token");
      const channelId = await askRequired("Slack channel ID");
      slackConfig = { bot_token: botToken, channel_id: channelId };
    }

    const claudePathInput = await ask("Claude CLI path", DEFAULT_CLAUDE_BIN);
    const claudePath = claudePathInput ? expandHomePath(claudePathInput) : DEFAULT_CLAUDE_BIN;
    const claudeTimeout = Math.max(1, Math.round(await askNumber("Claude run timeout in seconds", DEFAULT_TIMEOUT_SECONDS)));
    const claudeCheckInterval = Math.max(1, Math.round(await askNumber("Claude status check interval (seconds)", DEFAULT_CHECK_INTERVAL)));

    const config: RawConfig = {
      github: {
        token: githubToken,
        repos,
        max_concurrent: maxConcurrent,
      },
      claude: {
        path: claudePath,
        timeout_seconds: claudeTimeout,
        check_interval: claudeCheckInterval,
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

    console.log(`\nCreated configuration at ${configPath}.\n`);
    return config;
  } finally {
    rl.close();
  }
}

async function loadRawConfig(configPath: string): Promise<RawConfig> {
  try {
    const content = await readFile(configPath, "utf8");
    const parsed = JSON.parse(content) as RawConfig;
    if (!parsed.github || !parsed.claude) {
      throw new Error("Missing required config sections: github, claude");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const created = await runSetupWizard(configPath);
      return created;
    }
    throw error;
  }
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
