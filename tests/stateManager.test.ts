import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateManager } from "../src/lib/stateManager";
import { IssueState, ProcessStatus } from "../src/lib/models";
import { createIssueBranchName } from "../src/utils/branch";

describe("StateManager", () => {
  let tempDir: string;
  let statePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "state-manager-"));
    statePath = join(tempDir, "state.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const issueBranch = (issue: number, processor: string) =>
    createIssueBranchName(issue, processor, new Date(Date.UTC(2024, 0, 1, 0, 0, issue % 60)));

  const createState = (issue: number, processor: string, agent: number) =>
    new IssueState({
      issue_number: issue,
      processor_name: processor,
      status: ProcessStatus.Running,
      branch: issueBranch(issue, processor),
      start_time: new Date().toISOString(),
      agent_index: agent,
    });

  test("persists and reloads states per processor", async () => {
    const manager = new StateManager(statePath);
    await manager.initialize();

    manager.setState(1, "claude", createState(1, "claude", 0));
    manager.setState(1, "codex", createState(1, "codex", 1));
    await manager.saveStates();

    const reloaded = new StateManager(statePath);
    await reloaded.initialize();

    expect(reloaded.getState(1, "claude")?.branch).toBe(issueBranch(1, "claude"));
    expect(reloaded.getState(1, "codex")?.agent_index).toBe(1);
    expect(reloaded.getActiveIssueNumbersByProcessor("claude")).toEqual([1]);
    expect(reloaded.getActiveIssueNumbersByProcessor("codex")).toEqual([1]);
  });

  test("tracks available agent indices per processor", async () => {
    const manager = new StateManager(statePath);
    await manager.initialize();

    manager.setState(10, "claude", createState(10, "claude", 0));
    manager.setState(11, "claude", createState(11, "claude", 2));
    manager.setState(10, "codex", createState(10, "codex", 0));

    expect(manager.getAvailableAgentIndex("claude", 4)).toBe(1);
    expect(manager.getAvailableAgentIndex("codex", 2)).toBe(1);

    manager.removeState(10, "claude");
    expect(manager.getAvailableAgentIndex("claude", 2)).toBe(0);
  });

  test("treats legacy status strings as active and filters by processor", async () => {
    const manager = new StateManager(statePath);
    await manager.initialize();

    const legacy = (issue: number, processor: string, status: ProcessStatus | string, agent: number) =>
      new IssueState({
        issue_number: issue,
        processor_name: processor,
        status,
        branch: issueBranch(issue, processor),
        start_time: new Date().toISOString(),
        agent_index: agent,
      });

    manager.setState(1, "claude", legacy(1, "claude", "running", 0));
    manager.setState(2, "claude", legacy(2, "claude", ProcessStatus.NeedsInput, 0));
    manager.setState(3, "claude", legacy(3, "claude", ProcessStatus.Completed, 0));
    manager.setState(4, "codex", legacy(4, "codex", "needs_input", 1));

    expect(manager.getActiveIssueNumbersByProcessor("claude").sort()).toEqual([1, 2]);
    expect(manager.getAgentIssues("codex", 1)).toEqual([4]);
  });
});
