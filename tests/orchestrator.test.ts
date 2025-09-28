import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { ImploidOrchestrator } from "../src/lib/orchestrator";
import { IssueState, ProcessStatus } from "../src/lib/models";

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
    codexPath: "codex",
    codexTimeout: 60,
    codexCheckInterval: 1,
    claudePath: "claude",
    claudeTimeout: 60,
    claudeCheckInterval: 1,
    get enabledProcessors() {
      return ["claude", "codex"];
    },
    isProcessorEnabled(name: string) {
      return this.enabledProcessors.includes(name);
    },
    getProcessorRepoPath(processorName: string, agentIndex: number, repoName?: string) {
      const repo = repoName ?? repos[0].name;
      const short = repo.split("/").pop() ?? repo;
      return join(basePath, processorName, `${short}_agent_${agentIndex}`);
    },
  } as const;
};

describe("ImploidOrchestrator", () => {
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

  const createStateManagerStub = () => {
    const store = new Map<string, IssueState>();
    return {
      initialize: mock(async () => {}),
      saveStates: mock(async () => {}),
      getActiveStatesByProcessor: mock(() => []),
      getActiveIssueNumbers: mock(() => {
        const numbers = new Set<number>();
        store.forEach((state) => {
          if (state.status === ProcessStatus.Running || state.status === ProcessStatus.NeedsInput) {
            numbers.add(state.issue_number);
          }
        });
        return Array.from(numbers);
      }),
      getAvailableAgentIndex: mock(() => 0),
      setState: mock((issue: number, processor: string, state: IssueState) => {
        store.set(`${issue}:${processor}`, state);
      }),
      getState: mock((issue: number, processor: string) => store.get(`${issue}:${processor}`)),
      removeState: mock((issue: number, processor: string) => {
        store.delete(`${issue}:${processor}`);
      }),
    };
  };

  const createProcessor = (name: string, displayName: string, runnerMock: any) => ({
    name,
    displayName,
    labels: {
      working: `${name}-working`,
      completed: `${name}-completed`,
      failed: `${name}-failed`,
    },
    runner: {
      processIssue: runnerMock,
    },
  });

  const createSingleProcessor = (runnerMock: any) => createProcessor("claude", "Claude", runnerMock);

  test("runs without processing when no issues are returned", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new ImploidOrchestrator(config as any);

    const orchestratorAny = orchestrator as any;
    orchestratorAny.githubClient.getReadyIssues = mock(async () => []);
    orchestratorAny.githubClient.updateIssueLabels = mock(async () => {});
    orchestratorAny.repoManager.ensureRepoClone = mock(async () => {
      throw new Error("should not clone when no issues");
    });

    const runnerMock = mock(async () => ({ status: ProcessStatus.Completed }));
    orchestratorAny.processors = [createSingleProcessor(runnerMock)];
    orchestratorAny.stateManager = createStateManagerStub();

    await orchestrator.run();

    expect(orchestratorAny.githubClient.getReadyIssues.mock.calls.length).toBe(1);
    expect(orchestratorAny.repoManager.ensureRepoClone.mock.calls.length).toBe(0);
    expect(runnerMock.mock.calls.length).toBe(0);
  });

  test("processes a new issue through completion", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new ImploidOrchestrator(config as any);
    const orchestratorAny = orchestrator as any;

    const stateManagerStub = createStateManagerStub();
    orchestratorAny.stateManager = stateManagerStub;

    orchestratorAny.githubClient = {
      getReadyIssues: mock(async () => [{ number: 101, title: "Add feature", labels: [] }]),
      updateIssueLabels: mock(async () => {}),
    };

    orchestratorAny.repoManager = {
      ensureRepoClone: mock(async (processor: string) => {
        expect(processor).toBe("claude");
        return resolve(tempDir, processor, "repo_agent_0");
      }),
      validateBranchReady: mock(async () => true),
    };

    const runnerMock = mock(async () => ({ status: ProcessStatus.Completed, sessionId: "session-123" }));
    orchestratorAny.processors = [createSingleProcessor(runnerMock)];

    const notifier = {
      notifyStart: mock(async () => {}),
      notifyComplete: mock(async () => {}),
      notifyNeedsInput: mock(async () => {}),
      notifyError: mock(async () => {}),
    };
    orchestratorAny.notifiers = [notifier];

    await orchestrator.run();

    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[0][1]).toEqual({
      add: ["claude-working"],
      remove: ["agent-ready", "claude-completed", "claude-failed"],
    });
    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[1][1]).toEqual({
      add: ["claude-completed"],
      remove: ["claude-working"],
    });

    expect(runnerMock.mock.calls.length).toBe(1);
    expect(stateManagerStub.setState.mock.calls[0][1]).toBe("claude");
    expect(stateManagerStub.removeState.mock.calls.length).toBe(1);
  });

  test("marks issue as failed when processor reports failure", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new ImploidOrchestrator(config as any);
    const orchestratorAny = orchestrator as any;

    const stateManagerStub = createStateManagerStub();
    orchestratorAny.stateManager = stateManagerStub;

    orchestratorAny.githubClient = {
      getReadyIssues: mock(async () => [{ number: 202, title: "Hot fix", labels: [] }]),
      updateIssueLabels: mock(async () => {}),
    };

    orchestratorAny.repoManager = {
      ensureRepoClone: mock(async () => resolve(tempDir, "claude", "repo_agent_0")),
      validateBranchReady: mock(async () => true),
    };

    orchestratorAny.processors = [
      createSingleProcessor(mock(async () => ({ status: ProcessStatus.Failed, sessionId: null }))),
    ];

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

    expect(orchestratorAny.githubClient.updateIssueLabels.mock.calls[1][1]).toEqual({
      add: ["claude-failed"],
      remove: ["claude-working", "agent-ready"],
    });
    expect(stateManagerStub.removeState.mock.calls.length).toBe(1);
  });

  test("schedules each issue once and runs all processors concurrently", async () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath);
    const orchestrator = new ImploidOrchestrator(config as any);
    const orchestratorAny = orchestrator as any;

    const stateManagerStub = createStateManagerStub();
    orchestratorAny.stateManager = stateManagerStub;

    const claudeRunner = mock(async () => ({ status: ProcessStatus.Completed }));
    const codexRunner = mock(async () => ({ status: ProcessStatus.Completed }));

    orchestratorAny.processors = [
      createProcessor("claude", "Claude", claudeRunner),
      createProcessor("codex", "Codex", codexRunner),
    ];

    orchestratorAny.githubClient = {
      getReadyIssues: mock(async () => [{ number: 303, title: "Dual run", labels: [] }]),
      updateIssueLabels: mock(async () => {}),
    };

    orchestratorAny.notifiers = [];

    await orchestrator.run();

    const processorsUpdated = new Set(stateManagerStub.setState.mock.calls.map(([, processor]) => processor));
    expect(Array.from(processorsUpdated).sort()).toEqual(["claude", "codex"]);
    expect(claudeRunner.mock.calls.length).toBe(1);
    expect(codexRunner.mock.calls.length).toBe(1);
    expect(claudeRunner.mock.calls[0][0]).toBe(303);
    expect(claudeRunner.mock.calls[0][1]).toBe(0);
    expect(codexRunner.mock.calls[0][0]).toBe(303);
    expect(codexRunner.mock.calls[0][1]).toBe(0);
    expect(stateManagerStub.getActiveIssueNumbers.mock.calls.length).toBeGreaterThan(0);
  });

  test("throws when no processors are enabled", () => {
    const baseRepoPath = resolve(tempDir, "repos");
    const config = createStubConfig(baseRepoPath) as any;
    Object.defineProperty(config, "enabledProcessors", {
      get: () => [],
    });

    expect(() => new ImploidOrchestrator(config)).toThrow(/No processors enabled/);
  });
});
