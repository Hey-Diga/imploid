import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateManager } from "../src/lib/stateManager";
import { IssueState, ProcessStatus } from "../src/lib/models";

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

  const createState = (issue: number, agent: number) =>
    new IssueState({
      issue_number: issue,
      status: ProcessStatus.Running,
      branch: `issue-${issue}`,
      start_time: new Date().toISOString(),
      agent_index: agent,
    });

  test("persists and reloads states", async () => {
    const manager = new StateManager(statePath);
    await manager.initialize();

    manager.setState(1, createState(1, 0));
    manager.setState(2, createState(2, 1));
    await manager.saveStates();

    const reloaded = new StateManager(statePath);
    await reloaded.initialize();

    expect(reloaded.getState(1)?.branch).toBe("issue-1");
    expect(reloaded.getState(2)?.agent_index).toBe(1);
    expect(reloaded.getActiveIssues()).toEqual([1, 2]);
  });

  test("tracks available agent indices", async () => {
    const manager = new StateManager(statePath);
    await manager.initialize();

    manager.setState(10, createState(10, 0));
    manager.setState(11, createState(11, 2));

    expect(manager.getAvailableAgentIndex(4)).toBe(1);

    manager.removeState(10);
    expect(manager.getAvailableAgentIndex(2)).toBe(0);
  });
});
