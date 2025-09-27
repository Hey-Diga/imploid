import { describe, test, expect, beforeEach, mock } from "bun:test";
import { ProcessStatus, IssueState } from "../src/lib/models";

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
      if (!chunks.length) {
        return { value: undefined, done: true };
      }
      return { value: chunks.shift(), done: false };
    }),
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
    cancel: async () => {},
  } as ReadableStreamDefaultReader<Uint8Array>;
}

describe("CodexProcessor", () => {
  beforeEach(() => {
    runCommandMock.mock.calls.length = 0;
    spawnProcessMock.mock.calls.length = 0;
    runCommandImpl = async () => ({ code: 0, stdout: "", stderr: "" });
    spawnProcessImpl = () => {
      throw new Error("spawnProcess implementation not provided for test");
    };
  });

  const makeConfig = () => ({
    codexPath: "/usr/local/bin/codex",
    codexTimeout: 60,
    codexCheckInterval: 0.05,
  });

  const makeStateManager = (issueNumber: number) => {
    const state = new IssueState({
      issue_number: issueNumber,
      processor_name: "codex",
      status: ProcessStatus.Running,
      branch: `issue-${issueNumber}-codex`,
      start_time: new Date().toISOString(),
    });
    const store = new Map<number, IssueState>([[issueNumber, state]]);
    return {
      getState: mock((id: number) => store.get(id)),
      setState: mock((id: number, next: IssueState) => {
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
      expect(processorName).toBe("codex");
      return repoPath;
    }),
    validateBranchReady: mock(async () => true),
  });

  test("runs codex CLI with expected arguments and completes", async () => {
    const { CodexProcessor } = await import("../src/lib/processors/codex");
    const stateManager = makeStateManager(42);
    const repoManager = makeRepoManager("/tmp/repo");
    const notifier = { notifyError: mock(async () => {}) };

    runCommandImpl = async (command) => {
      if (command[1] === "show-ref") {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (command[1] === "checkout" && command[2] === "-b") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "branch") {
        return { code: 0, stdout: "issue-42-codex\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    spawnProcessImpl = () => ({
      process: {
        exited: Promise.resolve(0),
        kill: () => {},
      },
      stdout: makeReader(["Codex output line\n"]),
      stderr: makeReader([]),
    });

    const processor = new CodexProcessor(makeConfig() as any, [notifier as any], repoManager as any);
    const result = await processor.processIssue(42, 0, stateManager as any);

    expect(result.status).toBe(ProcessStatus.Completed);
    const spawnArgs = spawnProcessMock.mock.calls[0][0];
    expect(spawnArgs[0]).toBe("/usr/local/bin/codex");
    expect(spawnArgs).toContain("--full-auto");
    expect(spawnArgs).toContain("--prompt");
    expect(notifier.notifyError.mock.calls.length).toBe(0);
  });

  test("reports failure and notifies on non-zero exit", async () => {
    const { CodexProcessor } = await import("../src/lib/processors/codex");
    const stateManager = makeStateManager(101);
    const repoManager = makeRepoManager("/tmp/repo");
    const notifier = { notifyError: mock(async () => {}) };

    runCommandImpl = async (command) => {
      if (command[1] === "show-ref") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "checkout" && command[2] === "issue-101-codex") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "branch") {
        return { code: 0, stdout: "issue-101-codex\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    spawnProcessImpl = () => ({
      process: {
        exited: Promise.resolve(2),
        kill: () => {},
      },
      stdout: makeReader(["error\n"]),
      stderr: makeReader(["failure\n"]),
    });

    const processor = new CodexProcessor(makeConfig() as any, [notifier as any], repoManager as any);
    const result = await processor.processIssue(101, 1, stateManager as any);

    expect(result.status).toBe(ProcessStatus.Failed);
    expect(notifier.notifyError.mock.calls.length).toBe(1);
    expect(notifier.notifyError.mock.calls[0][1]).toContain("failure");
  });

  test("kills codex process when timeout elapses", async () => {
    const { CodexProcessor } = await import("../src/lib/processors/codex");
    const stateManager = makeStateManager(11);
    const repoManager = makeRepoManager("/tmp/repo");
    const notifier = { notifyError: mock(async () => {}) };

    runCommandImpl = async (command) => {
      if (command[1] === "show-ref") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "checkout" && command[2] === "issue-11-codex") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command[1] === "branch") {
        return { code: 0, stdout: "issue-11-codex\n", stderr: "" };
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
      stdout: makeReader(["pending\n"]),
      stderr: makeReader([]),
    });

    const config = { codexPath: "codex", codexTimeout: 0.01, codexCheckInterval: 0.01 };
    const processor = new CodexProcessor(config as any, [notifier as any], repoManager as any);
    const result = await processor.processIssue(11, 0, stateManager as any);

    expect(result.status).toBe(ProcessStatus.Failed);
    expect(killed).toBe(true);
    expect(notifier.notifyError.mock.calls.length).toBe(1);
  });
});
