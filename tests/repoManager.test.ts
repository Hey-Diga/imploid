import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";

type CommandResult = { code: number; stdout: string; stderr: string };

let runCommandImpl: (command: string[], options?: { cwd?: string }) => Promise<CommandResult>;

const runCommandMock = mock(async (command: string[], options?: { cwd?: string }) => {
  if (!runCommandImpl) {
    throw new Error("runCommand implementation not set");
  }
  return runCommandImpl(command, options);
});

mock.module("../src/utils/process", () => ({
  runCommand: runCommandMock,
  spawnProcess: mock(() => {
    throw new Error("spawnProcess should not be used in RepoManager tests");
  }),
}));

describe("RepoManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "repo-manager-"));
    runCommandMock.mock.calls.length = 0;
    runCommandImpl = async () => ({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createStubConfig = (repoName = "owner/repo") => ({
    githubRepo: repoName,
    getProcessorRepoPath(processorName: string, agentIndex: number, targetRepo?: string) {
      const actualRepo = targetRepo ?? repoName;
      const short = actualRepo.split("/").pop() ?? actualRepo;
      return join(tempDir, processorName, `${short}_agent_${agentIndex}`);
    },
  });

  test("ensureRepoClone clones repository when missing and runs setup", async () => {
    const { RepoManager } = await import("../src/lib/repoManager");
    const commands: Array<{ command: string[]; cwd?: string }> = [];

    runCommandImpl = async (command, options) => {
      commands.push({ command, cwd: options?.cwd });
      const key = command.join(" ");
      if (key === "git status --porcelain") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (key === "git checkout main") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (key === "git branch --show-current") {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const manager = new RepoManager(createStubConfig() as any);
    const repoPath = await manager.ensureRepoClone("claude", 0);

    expect(repoPath).toBe(join(tempDir, "claude", "repo_agent_0"));
    expect(commands[0]).toEqual({
      command: ["git", "clone", "git@github.com:owner/repo.git", "repo_agent_0"],
      cwd: dirname(repoPath),
    });

    const executed = commands.map((entry) => entry.command.join(" "));
    expect(executed).toContain("git status --porcelain");
    expect(executed).toContain("git checkout main");
    expect(executed).toContain("git branch --show-current");
    expect(executed).toContain("chmod +x setup.sh");
    expect(executed).toContain("./setup.sh");
  });

  test("ensureRepoClone pulls latest changes when clone already exists", async () => {
    const { RepoManager } = await import("../src/lib/repoManager");
    const commands: Array<{ command: string[]; cwd?: string }> = [];

    const repoPath = join(tempDir, "codex", "repo_agent_1");
    mkdirSync(repoPath, { recursive: true });

    runCommandImpl = async (command, options) => {
      commands.push({ command, cwd: options?.cwd });
      const key = command.join(" ");
      if (key === "git status --porcelain") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (key === "git checkout main") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (key === "git branch --show-current") {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const manager = new RepoManager(createStubConfig() as any);
    await manager.ensureRepoClone("codex", 1);

    const executed = commands.map((entry) => entry.command.join(" "));
    expect(executed.filter((cmd) => cmd === "git checkout main").length).toBeGreaterThanOrEqual(2);
    expect(executed).toContain("git fetch origin");
    expect(executed).toContain("git pull origin main");
    expect(executed).toContain("git status --porcelain");
  });

  test("validateBranchReady enforces branch existence and cleanliness", async () => {
    const { RepoManager } = await import("../src/lib/repoManager");
    const manager = new RepoManager(createStubConfig() as any);

    runCommandImpl = async (command) => {
      const key = command.join(" ");
      if (key.startsWith("git show-ref")) {
        return { code: 1, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    expect(await manager.validateBranchReady(tempDir, "feature")).toBe(false);

    let statusCallCount = 0;
    runCommandImpl = async (command) => {
      const key = command.join(" ");
      if (key.startsWith("git show-ref")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (key === "git branch --show-current") {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      if (key === "git status --porcelain") {
        statusCallCount += 1;
        return { code: 0, stdout: " M file.txt\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    expect(await manager.validateBranchReady(tempDir, "main")).toBe(true);
    expect(statusCallCount).toBe(1);
  });
});
