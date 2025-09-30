import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
let capturedPrompts: string[] = [];

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

describe("Prompt Integration Tests", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "prompt-integration-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    capturedPrompts = [];
    runCommandMock.mock.calls.length = 0;
    spawnProcessMock.mock.calls.length = 0;
    runCommandImpl = async () => ({ code: 0, stdout: "", stderr: "" });
    spawnProcessImpl = () => {
      throw new Error("spawnProcess implementation not provided for test");
    };
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  const makeConfig = (overrides: Partial<Record<string, unknown>> = {}) => ({
    claudePath: "claude",
    claudeTimeout: 120,
    claudeCheckInterval: 0.05,
    claudePromptPath: undefined,
    codexPath: "codex",
    codexTimeout: 120,
    codexCheckInterval: 0.05,
    codexPromptPath: undefined,
    ...overrides,
  });

  const makeStateManager = (issueNumber: number, processorName: string) => {
    const branch = createIssueBranchName(
      issueNumber,
      processorName,
      new Date(Date.UTC(2024, 0, 1, 0, 0, issueNumber % 60))
    );
    const state = new IssueState({
      issue_number: issueNumber,
      processor_name: processorName,
      status: ProcessStatus.Running,
      branch,
      start_time: new Date().toISOString(),
    });
    const store = new Map<number, IssueState>([[issueNumber, state]]);
    return {
      branch,
      getState: mock(() => state),
      setState: mock(() => {}),
      saveStates: mock(async () => {}),
    };
  };

  const makeRepoManager = () => ({
    ensureRepoClone: mock(async () => "/fake/repo/path"),
    prepareDefaultBranch: mock(async () => "main"),
    checkoutBranch: mock(async () => {}),
    createBranch: mock(async () => {}),
    getRepoPath: mock(() => "/fake/repo/path"),
  });

  describe("Claude processor with custom prompt", () => {
    test("uses custom prompt when configured", async () => {
      const { ClaudeProcessor } = await import("../src/lib/processors/claude");

      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customPrompt = "# Custom Claude Prompt ${issueNumber}\nDo something special!";
      writeFileSync(join(userPromptsDir, "custom-claude.md"), customPrompt, "utf8");

      const config = makeConfig({ claudePromptPath: "custom-claude" });
      const stateManager = makeStateManager(42, "claude");
      const repoManager = makeRepoManager();

      spawnProcessImpl = (command: string[]) => {
        capturedPrompts.push(command[3]);
        return {
          process: { exited: Promise.resolve(0), kill: () => {} },
          stdout: makeReader(['{"session_id":"test-session"}\n']),
          stderr: makeReader([]),
        };
      };

      const processor = new ClaudeProcessor(config as any, [], repoManager as any);
      await processor.processIssue(42, 0, stateManager as any);

      expect(capturedPrompts.length).toBe(1);
      expect(capturedPrompts[0]).toBe("# Custom Claude Prompt 42\nDo something special!");
    });

    test("uses default prompt when no custom path configured", async () => {
      const { ClaudeProcessor } = await import("../src/lib/processors/claude");

      const config = makeConfig();
      const stateManager = makeStateManager(99, "claude");
      const repoManager = makeRepoManager();

      spawnProcessImpl = (command: string[]) => {
        capturedPrompts.push(command[3]);
        return {
          process: { exited: Promise.resolve(0), kill: () => {} },
          stdout: makeReader(['{"session_id":"test-session"}\n']),
          stderr: makeReader([]),
        };
      };

      const processor = new ClaudeProcessor(config as any, [], repoManager as any);
      await processor.processIssue(99, 0, stateManager as any);

      expect(capturedPrompts.length).toBe(1);
      expect(capturedPrompts[0]).toContain("# GitHub Issue Workflow for Issue 99");
      expect(capturedPrompts[0]).toContain("## Setup Phase");
    });

    test("user override takes precedence over source default", async () => {
      const { ClaudeProcessor } = await import("../src/lib/processors/claude");

      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const userOverride = "# User Override ${issueNumber}\nCustom instructions";
      writeFileSync(join(userPromptsDir, "claude-default.md"), userOverride, "utf8");

      const config = makeConfig();
      const stateManager = makeStateManager(123, "claude");
      const repoManager = makeRepoManager();

      spawnProcessImpl = (command: string[]) => {
        capturedPrompts.push(command[3]);
        return {
          process: { exited: Promise.resolve(0), kill: () => {} },
          stdout: makeReader(['{"session_id":"test-session"}\n']),
          stderr: makeReader([]),
        };
      };

      const processor = new ClaudeProcessor(config as any, [], repoManager as any);
      await processor.processIssue(123, 0, stateManager as any);

      expect(capturedPrompts.length).toBe(1);
      expect(capturedPrompts[0]).toBe("# User Override 123\nCustom instructions");
    });
  });

  describe("Codex processor with custom prompt", () => {
    test("uses custom prompt when configured", async () => {
      const { CodexProcessor } = await import("../src/lib/processors/codex");

      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customPrompt = "# Custom Codex Prompt ${issueNumber}\nCodex instructions!";
      writeFileSync(join(userPromptsDir, "custom-codex.md"), customPrompt, "utf8");

      const config = makeConfig({ codexPromptPath: "custom-codex" });
      const stateManager = makeStateManager(88, "codex");
      const repoManager = makeRepoManager();

      spawnProcessImpl = (command: string[]) => {
        capturedPrompts.push(command[3]);
        return {
          process: { exited: Promise.resolve(0), kill: () => {} },
          stdout: makeReader([]),
          stderr: makeReader([]),
        };
      };

      const processor = new CodexProcessor(config as any, [], repoManager as any);
      await processor.processIssue(88, 0, stateManager as any);

      expect(capturedPrompts.length).toBe(1);
      expect(capturedPrompts[0]).toBe("# Custom Codex Prompt 88\nCodex instructions!");
    });

    test("uses default prompt when no custom path configured", async () => {
      const { CodexProcessor } = await import("../src/lib/processors/codex");

      const config = makeConfig();
      const stateManager = makeStateManager(55, "codex");
      const repoManager = makeRepoManager();

      spawnProcessImpl = (command: string[]) => {
        capturedPrompts.push(command[3]);
        return {
          process: { exited: Promise.resolve(0), kill: () => {} },
          stdout: makeReader([]),
          stderr: makeReader([]),
        };
      };

      const processor = new CodexProcessor(config as any, [], repoManager as any);
      await processor.processIssue(55, 0, stateManager as any);

      expect(capturedPrompts.length).toBe(1);
      expect(capturedPrompts[0]).toContain("# GitHub Issue Workflow for Issue 55");
      expect(capturedPrompts[0]).toContain("## 3. Implementation Phase");
    });
  });

  describe("Error handling", () => {
    test("fails gracefully when custom prompt file missing", async () => {
      const { ClaudeProcessor } = await import("../src/lib/processors/claude");

      const config = makeConfig({ claudePromptPath: "nonexistent" });
      const stateManager = makeStateManager(1, "claude");
      const repoManager = makeRepoManager();

      const processor = new ClaudeProcessor(config as any, [], repoManager as any);

      await expect(processor.processIssue(1, 0, stateManager as any)).rejects.toThrow(
        /Failed to load custom prompt/
      );
    });
  });
});