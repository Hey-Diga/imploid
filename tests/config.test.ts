import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import readline from "readline/promises";

describe("Config.loadOrCreate", () => {
  let tempDir: string;
  let originalCwd: string;
  const originalCreateInterface = readline.createInterface;
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    readline.createInterface = originalCreateInterface as any;
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutTTY, configurable: true });
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
    const answers = [
      "ghp_wizard_token", // github token
      "1", // repo count
      "owner/sample-repo", // repo name
      "~/worktrees", // base path
      "2", // max concurrent
      "n", // telegram disabled
      "y", // slack enabled
      "xoxb-test-token", // slack token
      "C123456", // slack channel
      "", // claude path (accept default)
      "7200", // timeout
      "12", // check interval
    ];

    const fakeInterface = {
      question: mock(async () => answers.shift() ?? ""),
      close: mock(() => {}),
    };

    readline.createInterface = (() => fakeInterface) as any;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { Config } = await import("../src/lib/config");
    const config = await Config.loadOrCreate(configPath);

    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    expect(parsed.github.repos[0].name).toBe("owner/sample-repo");
    expect(config.githubRepos[0].base_repo_path).toBe(resolve(process.env.HOME ?? "", "worktrees"));
    expect(config.maxConcurrent).toBe(2);
    expect(config.slackBotToken).toBe("xoxb-test-token");
    expect(config.slackChannelId).toBe("C123456");
    expect(config.telegramBotToken).toBe("");
    expect(config.claudePath).toBe("claude");
    expect(config.claudeTimeout).toBe(7200);
    expect(config.claudeCheckInterval).toBe(12);
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

    const expectedBase = resolve(process.env.HOME ?? "", "legacy-path");
    expect(config.getRepoPath(2)).toBe(resolve(expectedBase, "legacy-repo_agent_2"));
  });

  test("throws descriptive error when configuration is missing in non-interactive mode", async () => {
    const configPath = join(tempDir, "missing.json");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const { Config } = await import("../src/lib/config");
    await expect(Config.loadOrCreate(configPath)).rejects.toThrow("Configuration file not found");
  });
});
