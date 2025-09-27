import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { IssueOrchestrator } from "../src/lib/orchestrator";

const createStubConfig = (basePath: string) => {
  const repos = [
    {
      name: "owner/repo",
      base_repo_path: basePath,
    },
  ];

  return {
    githubToken: "ghp_stub",
    get githubRepos() {
      return repos;
    },
    get githubRepo() {
      return repos[0].name;
    },
    get baseRepoPath() {
      return repos[0].base_repo_path;
    },
    get repoPath() {
      return "";
    },
    get maxConcurrent() {
      return 2;
    },
    get telegramBotToken() {
      return "";
    },
    get telegramChatId() {
      return "";
    },
    get slackBotToken() {
      return "";
    },
    get slackChannelId() {
      return "";
    },
    get claudeTimeout() {
      return 3600;
    },
    get claudeCheckInterval() {
      return 5;
    },
    get claudePath() {
      return "claude";
    },
    getRepoConfig(name: string) {
      return repos.find((repo) => repo.name === name);
    },
    getRepoPath(agentIndex: number, repoName?: string) {
      const repo = repoName ? repos.find((r) => r.name === repoName)! : repos[0];
      return join(repo.base_repo_path, `${repo.name.split("/").pop()}_agent_${agentIndex}`);
    },
  } as const;
};

describe("IssueOrchestrator", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orchestrator-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("runs without processing when no issues are returned", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new IssueOrchestrator(config as any);

    const orchestratorAny = orchestrator as any;
    orchestratorAny.githubClient.getReadyIssues = mock(async () => []);
    orchestratorAny.githubClient.updateIssueLabels = mock(async () => {});
    orchestratorAny.repoManager.ensureRepoClone = mock(async () => {
      throw new Error("should not clone when no issues");
    });
    orchestratorAny.processor.processIssue = mock(async () => {
      throw new Error("should not process when no issues");
    });

    await orchestrator.run();

    expect(orchestratorAny.githubClient.getReadyIssues.mock.calls.length).toBe(1);
    expect(orchestratorAny.repoManager.ensureRepoClone.mock.calls.length).toBe(0);
  });
});
