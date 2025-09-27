import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { IssueOrchestrator } from "../src/lib/orchestrator";
import { ProcessStatus, IssueState } from "../src/lib/models";

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

  test("processes a new issue through completion", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new IssueOrchestrator(config as any);
    const orchestratorAny = orchestrator as any;

    const stateStore = new Map<number, IssueState>();
    let latestState: IssueState | undefined;

    orchestratorAny.stateManager = {
      initialize: mock(async () => {}),
      saveStates: mock(async () => {}),
      getActiveIssues: mock(() => []),
      getAvailableAgentIndex: mock(() => 0),
      setState: mock((issue: number, state: IssueState) => {
        latestState = state;
        stateStore.set(issue, state);
      }),
      getState: mock((issue: number) => stateStore.get(issue)),
      removeState: mock((issue: number) => {
        stateStore.delete(issue);
      }),
    };

    orchestratorAny.githubClient = {
      getReadyIssues: mock(async () => [{ number: 101, title: "Add feature", labels: [] }]),
      updateIssueLabels: mock(async () => {}),
    };

    orchestratorAny.repoManager = { ensureRepoClone: mock(async () => resolve(tempDir, "repo")) };

    orchestratorAny.processor = {
      processIssue: mock(async () => ({ status: ProcessStatus.Completed, sessionId: "session-123" })),
    };

    const notifications: Array<{ kind: string; args: unknown[] }> = [];
    const notifier = {
      notifyStart: mock(async (...args: unknown[]) => {
        notifications.push({ kind: "start", args });
      }),
      notifyComplete: mock(async (...args: unknown[]) => {
        notifications.push({ kind: "complete", args });
      }),
      notifyNeedsInput: mock(async () => {}),
      notifyError: mock(async () => {}),
    };
    orchestratorAny.notifiers = [notifier];

    await orchestrator.run();

    expect(orchestratorAny.githubClient.getReadyIssues.mock.calls.length).toBe(1);
    expect(orchestratorAny.processor.processIssue.mock.calls[0][0]).toBe(101);

    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls.length).toBe(2);
    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[0][1]).toEqual({
      add: ["claude-working"],
      remove: ["ready-for-claude"],
    });
    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[1][1]).toEqual({
      add: ["claude-completed"],
      remove: ["claude-working"],
    });

    expect(latestState?.status).toBe(ProcessStatus.Completed);
    expect(latestState?.session_id).toBe("session-123");
    expect(notifier.notifyStart.mock.calls.length).toBe(1);
    expect(notifier.notifyComplete.mock.calls.length).toBe(1);
    expect(notifications.map((n) => n.kind)).toEqual(["start", "complete"]);
    expect(stateStore.size).toBe(0);
  });

  test("marks issue as failed when processor reports failure", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new IssueOrchestrator(config as any);
    const orchestratorAny = orchestrator as any;

    const stateStore = new Map<number, IssueState>();
    let latestState: IssueState | undefined;

    orchestratorAny.stateManager = {
      initialize: mock(async () => {}),
      saveStates: mock(async () => {}),
      getActiveIssues: mock(() => []),
      getAvailableAgentIndex: mock(() => 0),
      setState: mock((issue: number, state: IssueState) => {
        latestState = state;
        stateStore.set(issue, state);
      }),
      getState: mock((issue: number) => stateStore.get(issue)),
      removeState: mock((issue: number) => {
        stateStore.delete(issue);
      }),
    };

    orchestratorAny.githubClient = {
      getReadyIssues: mock(async () => [{ number: 202, title: "Hot fix", labels: [] }]),
      updateIssueLabels: mock(async () => {}),
    };

    orchestratorAny.repoManager = { ensureRepoClone: mock(async () => resolve(tempDir, "repo")) };

    orchestratorAny.processor = {
      processIssue: mock(async () => ({ status: ProcessStatus.Failed, sessionId: null })),
    };

    const notifier = {
      notifyStart: mock(async () => {}),
      notifyComplete: mock(async () => {
        throw new Error("should not notify completion on failure");
      }),
      notifyNeedsInput: mock(async () => {}),
      notifyError: mock(async () => {}),
    };
    orchestratorAny.notifiers = [notifier];

    await orchestrator.run();

    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls.length).toBe(2);
    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[1][1]).toEqual({
      add: ["claude-failed"],
      remove: ["claude-working", "ready-for-claude"],
    });
    expect(latestState?.status).toBe(ProcessStatus.Failed);
    expect(stateStore.size).toBe(0);
    expect(notifier.notifyStart.mock.calls.length).toBe(1);
    expect(notifier.notifyComplete.mock.calls.length).toBe(0);
  });
});
