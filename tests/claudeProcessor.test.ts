import { describe, test, expect, beforeEach, mock } from "bun:test";
import { ProcessStatus, IssueState } from "../src/lib/models";
import { createIssueBranchName } from "../src/utils/branch";

type CommandResult = { code: number; stdout: string; stderr: string };
type SpawnResult = {
  process: { exited: Promise<number>; kill: () => void };
  stdout: ReadableStreamDefaultReader<Uint8Array>;
  stderr: ReadableStreamDefaultReader<Uint8Array>;
};

let runCommandImpl: (command: string[], options?: { cwd?: string }) => Promise<CommandResult>;
let spawnProcessImpl: (command: string[], options?: { cwd?: string }) => SpawnResult;

const runCommandMock = mock(async (command: string[], options?: { cwd?: string }) => {
  if (!runCommandImpl) {
    throw new Error("runCommand implementation not set");
  }
  return runCommandImpl(command, options);
});

const spawnProcessMock = mock((command: string[], options?: { cwd?: string }) => {
  if (!spawnProcessImpl) {
    throw new Error("spawnProcess implementation not set");
  }
  return spawnProcessImpl(command, options);
});

mock.module("../src/utils/process", () => ({
  runCommand: runCommandMock,
  spawnProcess: spawnProcessMock,
}));

const encoder = new TextEncoder();

function makeReader(lines: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const chunks = [...lines.map((line) => encoder.encode(line))];
  return {
    read: mock(async () => {
      if (chunks.length === 0) {
        return { value: undefined, done: true };
      }
      const value = chunks.shift();
      return { value, done: false };
    }),
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
    cancel: async () => {},
  } as ReadableStreamDefaultReader<Uint8Array>;
}

describe("ClaudeProcessor", () => {
  beforeEach(() => {
    runCommandMock.mock.calls.length = 0;
    spawnProcessMock.mock.calls.length = 0;
    runCommandImpl = async () => ({ code: 0, stdout: "", stderr: "" });
    spawnProcessImpl = () => {
      throw new Error("spawnProcess implementation not provided for test");
    };
  });

  const makeConfig = (overrides: Partial<Record<string, unknown>> = {}) => ({
    claudePath: "claude",
    claudeTimeout: 120,
    claudeCheckInterval: 0.05,
    claudePromptPath: undefined,
    ...overrides,
  });

  const makeStateManager = (issueNumber: number) => {
    const branch = createIssueBranchName(issueNumber, "claude", new Date(Date.UTC(2024, 0, 1, 0, 0, issueNumber % 60)));
    const state = new IssueState({
      issue_number: issueNumber,
      processor_name: "claude",
      status: ProcessStatus.Running,
      branch,
      start_time: new Date().toISOString(),
    });
    const store = new Map<number, IssueState>([[issueNumber, state]]);
    return {
      branch,
      getState: mock((id: number) => store.get(id)),
      setState: mock((id: number, _processor: string, next: IssueState) => {
        store.set(id, next);
      }),
      saveStates: mock(async () => {}),
      removeState: mock((id: number) => {
        store.delete(id);
      }),
      store,
    };
  };

  const makeRepoManager = (repoPath: string) => ({
    ensureRepoClone: mock(async (processorName: string) => {
      expect(processorName).toBe("claude");
      return repoPath;
    }),
    prepareDefaultBranch: mock(async () => "main"),
    validateBranchReady: mock(async () => true),
  });

  test("processIssue creates branch and captures session id on success", async () => {
    const { ClaudeProcessor } = await import("../src/lib/processors/claude");
    const issueNumber = 321;
    const repoPath = "/tmp/repo";
    const stateManager = makeStateManager(issueNumber);
    const { branch } = stateManager;
    const repoManager = makeRepoManager(repoPath);
    const notifier = { notifyError: mock(async () => {}) };

    const commands: string[] = [];
    runCommandImpl = async (command) => {
      commands.push(command.join(" "));
      if (command[1] === "checkout" && command[2] === "-B") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "status") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    spawnProcessImpl = () => ({
      process: {
        exited: Promise.resolve(0),
        kill: () => {
          throw new Error("kill should not be called on success");
        },
      },
      stdout: makeReader([`{"session_id":"sess-${issueNumber}"}\n`]),
      stderr: makeReader([]),
    });

    const processor = new ClaudeProcessor(makeConfig(), [notifier as any], repoManager as any);
    const result = await processor.processIssue(issueNumber, 0, stateManager as any, "owner/repo");

    expect(result).toEqual({ status: ProcessStatus.Completed, sessionId: `sess-${issueNumber}` });
    expect(repoManager.prepareDefaultBranch.mock.calls[0][0]).toBe(repoPath);
    expect(commands).toContain(`git checkout -B ${branch}`);
    expect(commands).toContain("git status --porcelain");
    expect(repoManager.ensureRepoClone.mock.calls[0][0]).toBe("claude");
    expect(repoManager.ensureRepoClone.mock.calls[0][1]).toBe(0);
    expect(repoManager.ensureRepoClone.mock.calls[0][2]).toBe("owner/repo");
    expect(spawnProcessMock.mock.calls[0][0][0]).toBe("claude");
    expect(stateManager.store.get(issueNumber)?.session_id).toBe(`sess-${issueNumber}`);
    expect(notifier.notifyError.mock.calls.length).toBe(0);
  });

  test("processIssue reports failure and notifies on non-zero exit", async () => {
    const { ClaudeProcessor } = await import("../src/lib/processors/claude");
    const issueNumber = 99;
    const stateManager = makeStateManager(issueNumber);
    const repoManager = makeRepoManager("/tmp/repo");
    const notifier = { notifyError: mock(async () => {}) };

    runCommandImpl = async (command) => {
      if (command[1] === "checkout" && command[2] === "-B") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "status") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    spawnProcessImpl = () => ({
      process: {
        exited: Promise.resolve(2),
        kill: () => {},
      },
      stdout: makeReader([`{"session_id":"fail-${issueNumber}"}\n`]),
      stderr: makeReader(["something broke\n"]),
    });

    const processor = new ClaudeProcessor(makeConfig(), [notifier as any], repoManager as any);
    const result = await processor.processIssue(issueNumber, 1, stateManager as any);

    expect(result.status).toBe(ProcessStatus.Failed);
    expect(result.sessionId).toBe(`fail-${issueNumber}`);
    expect(notifier.notifyError.mock.calls.length).toBe(1);
    expect(notifier.notifyError.mock.calls[0][1]).toContain("something broke");
    expect(stateManager.store.get(issueNumber)?.session_id).toBe(`fail-${issueNumber}`);
  });

  test("processIssue kills timed out claude runs", async () => {
    const { ClaudeProcessor } = await import("../src/lib/processors/claude");
    const issueNumber = 7;
    const stateManager = makeStateManager(issueNumber);
    const repoManager = makeRepoManager("/tmp/repo");
    const notifier = { notifyError: mock(async () => {}) };

    runCommandImpl = async (command) => {
      if (command[1] === "checkout" && command[2] === "-B") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "status") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    let killed = false;
    spawnProcessImpl = () => ({
      process: {
        exited: new Promise<number>(() => {}),
        kill: () => {
          killed = true;
        },
      },
      stdout: makeReader([`{"session_id":"timeout-${issueNumber}"}\n`]),
      stderr: makeReader(["timed out\n"]),
    });

    const processor = new ClaudeProcessor(
      makeConfig({ claudeTimeout: 0.02, claudeCheckInterval: 0.01 }),
      [notifier as any],
      repoManager as any
    );
    const result = await processor.processIssue(issueNumber, 2, stateManager as any);

    expect(result.status).toBe(ProcessStatus.Failed);
    expect(killed).toBe(true);
    expect(notifier.notifyError.mock.calls.length).toBe(1);
    expect(stateManager.store.get(issueNumber)?.session_id).toBe(`timeout-${issueNumber}`);
  });
});
