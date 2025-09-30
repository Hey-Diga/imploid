import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
const spawnSyncMock = mock((cmd?: string[]) => {
  if (cmd && Array.isArray(cmd) && cmd[0] === "which" && cmd[1] === "codex") {
    return { status: 0, stdout: "/usr/local/bin/codex\n", stderr: "" };
  }
  if (cmd && Array.isArray(cmd) && cmd[0] === "which" && cmd[1] === "claude") {
    return { status: 0, stdout: "/usr/local/bin/claude\n", stderr: "" };
  }
  return { status: 0, stdout: "", stderr: "" };
});

let promptResponses: Array<Record<string, unknown>> = [];

const createPromptImplementation = () =>
  async (questions: any) => {
    const qArray = Array.isArray(questions) ? questions : [questions];
    const response = promptResponses.shift() ?? {};
    const result: Record<string, unknown> = {};
    for (const question of qArray) {
      const key = question.name as string;
      if (Object.prototype.hasOwnProperty.call(response, key)) {
        result[key] = (response as any)[key];
      } else {
        result[key] = undefined;
      }
    }
    return result;
  };

const promptMock = mock(createPromptImplementation());

mock.module("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

mock.module("inquirer", () => ({
  default: {
    prompt: promptMock,
  },
}));

describe("Config.loadOrCreate", () => {
  let tempDir: string;
  let originalCwd: string;
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    promptResponses = [];
    promptMock.mockReset();
    promptMock.mockImplementation(createPromptImplementation());

    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(() => ({ status: 0, stdout: "/usr/local/bin/claude\n", stderr: "" }));
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTTY, configurable: true });
    global.fetch = originalFetch;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("loads existing config file", async () => {
    const configPath = join(tempDir, "config.json");
    const payload = {
      github: {
        token: "ghp_existing",
        repos: [
          {
            name: "owner/repo",
            base_repo_path: "/tmp/repos",
          },
        ],
        max_concurrent: 4,
      },
      claude: {
        timeout_seconds: 500,
        check_interval: 10,
        path: "claude",
      },
    };
    writeFileSync(configPath, JSON.stringify(payload, null, 2));

    const { Config } = await import("../src/lib/config");
    const config = await Config.loadOrCreate(configPath);

    expect(config.githubToken).toBe("ghp_existing");
    expect(config.githubRepos).toHaveLength(1);
    expect(config.githubRepos[0].name).toBe("owner/repo");
    expect(config.maxConcurrent).toBe(4);
    expect(config.claudeTimeout).toBe(500);
    expect(config.claudeCheckInterval).toBe(10);
  });

  test("runs interactive wizard when config is missing", async () => {
    const configPath = join(tempDir, "config.json");
    promptResponses.push(
      { githubToken: "ghp_wizard_token" },
      { organization: "__personal__" },
      { repositories: ["owner/sample-repo"] },
      { maxConcurrent: "2" },
      { configureTelegram: false },
      { configureSlack: true },
      { slackBotToken: "xoxb-test-token" },
      { slackChannelId: "C123456" },
      { enabledProcessors: ["claude", "codex"] },
      { claudePath: "/usr/local/bin/claude" },
      { claudeTimeout: "7200" },
      { claudeCheckInterval: "12" },
      { claudePromptPath: "" },
      { codexPath: "/usr/local/bin/codex" },
      { codexTimeout: "7200" },
      { codexCheckInterval: "12" },
      { codexPromptPath: "" }
    );

    global.fetch = mock(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/user/orgs")) {
        return new Response(JSON.stringify([{ login: "owner" }]), { status: 200 });
      }
      if (url.includes("/user/repos")) {
        return new Response(
          JSON.stringify([
            { full_name: "owner/sample-repo" },
            { full_name: "owner/second-repo" },
          ]),
          { status: 200 }
        );
      }
      return new Response("[]", { status: 200 });
    }) as any;

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { Config } = await import("../src/lib/config");
    const config = await Config.loadOrCreate(configPath);

    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    expect(parsed.github.repos[0].name).toBe("owner/sample-repo");
    expect(config.githubRepos[0].base_repo_path).toBe(resolve(process.env.HOME ?? "", ".imploid/repos"));
    expect(config.maxConcurrent).toBe(2);
    expect(config.slackBotToken).toBe("xoxb-test-token");
    expect(config.slackChannelId).toBe("C123456");
    expect(config.telegramBotToken).toBe("");
    expect(config.claudePath).toBe("/usr/local/bin/claude");
    expect(config.claudeTimeout).toBe(7200);
    expect(config.claudeCheckInterval).toBe(12);
    expect(config.claudePromptPath).toBeUndefined();
    expect(config.enabledProcessors).toEqual(["claude", "codex"]);
    expect(config.codexPromptPath).toBeUndefined();
  });

  test("allows updating existing configuration interactively", async () => {
    const configPath = join(tempDir, "config.json");
    const existingPayload = {
      github: {
        token: "ghp_existing",
        repos: [
          {
            name: "owner/sample-repo",
            base_repo_path: "~/.imploid/repos",
          },
        ],
        max_concurrent: 4,
      },
      telegram: {
        bot_token: "old-telegram",
        chat_id: "old-chat",
      },
      slack: {
        bot_token: "old-slack",
        channel_id: "old-channel",
      },
      claude: {
        path: "/usr/local/bin/claude",
        timeout_seconds: 500,
        check_interval: 10,
        prompt_path: "claude-existing",
      },
      codex: {
        path: "/usr/local/bin/codex",
        timeout_seconds: 600,
        check_interval: 12,
        prompt_path: "codex-existing",
      },
    };
    writeFileSync(configPath, JSON.stringify(existingPayload, null, 2));

    promptResponses.push(
      { githubToken: "ghp_updated" },
      { organization: "__personal__" },
      { repositories: ["owner/sample-repo", "__manual__"] },
      { repo: "owner/extra-repo" },
      { repo: "" },
      { maxConcurrent: "5" },
      { configureTelegram: true },
      { telegramBotToken: "new-telegram" },
      { telegramChatId: "new-chat" },
      { configureSlack: false },
      { enabledProcessors: ["claude", "codex"] },
      { claudePath: "/opt/claude" },
      { claudeTimeout: "3600" },
      { claudeCheckInterval: "15" },
      { claudePromptPath: "claude-updated" },
      { codexPath: "/usr/local/bin/codex" },
      { codexTimeout: "1800" },
      { codexCheckInterval: "20" },
      { codexPromptPath: "codex-updated" }
    );

    global.fetch = mock(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/user/orgs")) {
        return new Response(JSON.stringify([{ login: "owner" }]), { status: 200 });
      }
      if (url.includes("/user/repos")) {
        return new Response(JSON.stringify([{ full_name: "owner/sample-repo" }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }) as any;

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { configureInteractive } = await import("../src/lib/config");
    const config = await configureInteractive(configPath);

    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.githubToken).toBe("ghp_updated");
    const expectedBase = resolve(process.env.HOME ?? "", ".imploid/repos");
    expect(parsed.github.repos).toEqual([
      {
        name: "owner/sample-repo",
        base_repo_path: expectedBase,
      },
      {
        name: "owner/extra-repo",
        base_repo_path: expectedBase,
      },
    ]);
    expect(config.maxConcurrent).toBe(5);
    expect(config.telegramBotToken).toBe("new-telegram");
    expect(config.telegramChatId).toBe("new-chat");
    expect(config.slackBotToken).toBe("");
    expect(config.claudePath).toBe("/opt/claude");
    expect(config.claudeTimeout).toBe(3600);
    expect(config.claudeCheckInterval).toBe(15);
    expect(config.claudePromptPath).toBe("claude-updated");
    expect(config.codexPath).toBe("/usr/local/bin/codex");
    expect(config.codexTimeout).toBe(1800);
    expect(config.codexCheckInterval).toBe(20);
    expect(config.codexPromptPath).toBe("codex-updated");
    expect(config.enabledProcessors).toEqual(["claude", "codex"]);
  });

  test("derives repository list from legacy single repo fields", async () => {
    const configPath = join(tempDir, "config.json");
    const payload = {
      github: {
        token: "ghp_single",
        repo: "owner/legacy-repo",
        base_repo_path: "~/legacy-path",
      },
      claude: {
        timeout_seconds: 1000,
        check_interval: 20,
        path: "claude",
      },
    };
    writeFileSync(configPath, JSON.stringify(payload, null, 2));

    const { Config } = await import("../src/lib/config");
    const config = await Config.loadOrCreate(configPath);

    expect(config.githubRepos).toHaveLength(1);
    expect(config.githubRepos[0].name).toBe("owner/legacy-repo");
    expect(config.baseRepoPath).toBe("~/legacy-path");
    expect(config.maxConcurrent).toBe(3);

    const expectedBase = resolve(process.env.HOME ?? "", ".imploid/repos");
    expect(config.getProcessorRepoPath("claude", 2, "owner/legacy-repo")).toBe(
      resolve(expectedBase, "claude", "legacy-repo_agent_2")
    );
  });

  test("throws descriptive error when configuration is missing in non-interactive mode", async () => {
    const configPath = join(tempDir, "missing.json");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const { Config } = await import("../src/lib/config");
    await expect(Config.loadOrCreate(configPath)).rejects.toThrow("Configuration file not found");
  });
});
