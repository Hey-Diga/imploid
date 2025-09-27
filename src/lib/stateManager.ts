import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { IssueState, ProcessStatus } from "./models";

function resolveStatePath(stateFile: string): string {
  if (stateFile.startsWith("/")) {
    return stateFile;
  }
  return resolve(process.cwd(), stateFile);
}

export class StateManager {
  private readonly stateFile: string;
  private states: Map<number, IssueState> = new Map();

  constructor(stateFile = "processing-state.json") {
    this.stateFile = resolveStatePath(stateFile);
  }

  async initialize(): Promise<void> {
    try {
      const content = await readFile(this.stateFile, "utf8");
      const raw = JSON.parse(content) as Record<string, any>;
      for (const [key, value] of Object.entries(raw)) {
        const issueNumber = Number(key);
        if (!Number.isNaN(issueNumber)) {
          this.states.set(issueNumber, IssueState.fromJSON({
            issue_number: issueNumber,
            ...value,
          }));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to load state file", error);
      }
    }
  }

  getState(issueNumber: number): IssueState | undefined {
    return this.states.get(issueNumber);
  }

  setState(issueNumber: number, state: IssueState): void {
    this.states.set(issueNumber, state);
  }

  removeState(issueNumber: number): void {
    this.states.delete(issueNumber);
  }

  async saveStates(): Promise<void> {
    const json: Record<string, any> = {};
    for (const [issueNumber, state] of this.states.entries()) {
      json[String(issueNumber)] = state.toJSON();
    }

    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(json, null, 2), "utf8");
  }

  getActiveIssues(): number[] {
    return Array.from(this.states.entries())
      .filter(([, state]) =>
        state.status === ProcessStatus.Running || state.status === ProcessStatus.NeedsInput || state.status === "running" || state.status === "needs_input"
      )
      .map(([issueNumber]) => issueNumber);
  }

  getAvailableAgentIndex(maxConcurrent: number): number | undefined {
    const usedAgents = new Set<number>();
    for (const state of this.states.values()) {
      const isActive =
        state.status === ProcessStatus.Running ||
        state.status === ProcessStatus.NeedsInput ||
        state.status === "running" ||
        state.status === "needs_input";
      if (isActive && state.agent_index !== undefined && state.agent_index !== null) {
        usedAgents.add(state.agent_index);
      }
    }

    for (let i = 0; i < maxConcurrent; i += 1) {
      if (!usedAgents.has(i)) {
        return i;
      }
    }

    return undefined;
  }

  getAgentIssues(agentIndex: number): number[] {
    return Array.from(this.states.entries())
      .filter(([, state]) => state.agent_index === agentIndex)
      .filter(([, state]) =>
        state.status === ProcessStatus.Running || state.status === ProcessStatus.NeedsInput || state.status === "running" || state.status === "needs_input"
      )
      .map(([issueNumber]) => issueNumber);
  }

  getStateFilePath(): string {
    return this.stateFile;
  }
}
