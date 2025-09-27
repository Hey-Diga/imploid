import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { IssueState, ProcessStatus } from "./models";

const ACTIVE_STATUSES = new Set<ProcessStatus | string>([
  ProcessStatus.Running,
  ProcessStatus.NeedsInput,
  "running",
  "needs_input",
]);

const DEFAULT_STATE_FILE = (() => {
  const homeDir = process.env.HOME;
  if (homeDir && homeDir.length) {
    return resolve(homeDir, ".issue-orchestrator", "processing-state.json");
  }
  return resolve(process.cwd(), "processing-state.json");
})();

function expandHomePath(path: string): string {
  if (path.startsWith("~/")) {
    const homeDir = process.env.HOME ?? "";
    if (!homeDir) {
      return path.slice(2);
    }
    return resolve(homeDir, path.slice(2));
  }
  return path;
}

function resolveStatePath(stateFile: string): string {
  const expanded = expandHomePath(stateFile);
  if (expanded.startsWith("/")) {
    return expanded;
  }
  return resolve(process.cwd(), expanded);
}

function makeStateKey(issueNumber: number, processorName: string): string {
  return `${issueNumber}:${processorName}`;
}

function parseStateKey(key: string, fallbackProcessor = "claude"): { issueNumber: number; processorName: string } {
  if (key.includes(":")) {
    const [rawIssue, rawProcessor] = key.split(":", 2);
    const issueNumber = Number(rawIssue);
    const processorName = rawProcessor || fallbackProcessor;
    return { issueNumber, processorName };
  }
  return { issueNumber: Number(key), processorName: fallbackProcessor };
}

function isActive(state: IssueState): boolean {
  return ACTIVE_STATUSES.has(state.status);
}

export class StateManager {
  private readonly stateFile: string;
  private states: Map<string, IssueState> = new Map();

  constructor(stateFile = DEFAULT_STATE_FILE) {
    this.stateFile = resolveStatePath(stateFile);
  }

  async initialize(): Promise<void> {
    try {
      const content = await readFile(this.stateFile, "utf8");
      const raw = JSON.parse(content) as Record<string, any>;
      for (const [key, value] of Object.entries(raw)) {
        const inferredProcessor = typeof value?.processor_name === "string" ? value.processor_name : "claude";
        const { issueNumber, processorName } = parseStateKey(key, inferredProcessor);
        if (Number.isNaN(issueNumber)) {
          continue;
        }
        const state = IssueState.fromJSON({
          issue_number: issueNumber,
          processor_name: processorName,
          ...value,
        });
        state.processor_name = processorName;
        this.states.set(makeStateKey(issueNumber, processorName), state);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to load state file", error);
      }
    }
  }

  getState(issueNumber: number, processorName: string): IssueState | undefined {
    return this.states.get(makeStateKey(issueNumber, processorName));
  }

  setState(issueNumber: number, processorName: string, state: IssueState): void {
    state.processor_name = processorName;
    this.states.set(makeStateKey(issueNumber, processorName), state);
  }

  removeState(issueNumber: number, processorName: string): void {
    this.states.delete(makeStateKey(issueNumber, processorName));
  }

  async saveStates(): Promise<void> {
    const json: Record<string, any> = {};
    for (const [key, state] of this.states.entries()) {
      json[key] = state.toJSON();
    }

    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(json, null, 2), "utf8");
  }

  getActiveStates(): IssueState[] {
    return Array.from(this.states.values()).filter(isActive);
  }

  getActiveStatesByProcessor(processorName: string): IssueState[] {
    return this.getActiveStates().filter((state) => state.processor_name === processorName);
  }

  getActiveIssueNumbersByProcessor(processorName: string): number[] {
    const numbers = new Set<number>();
    for (const state of this.getActiveStatesByProcessor(processorName)) {
      numbers.add(state.issue_number);
    }
    return Array.from(numbers);
  }

  getAvailableAgentIndex(processorName: string, maxConcurrent: number): number | undefined {
    const usedAgents = new Set<number>();
    for (const state of this.getActiveStatesByProcessor(processorName)) {
      if (state.agent_index !== undefined && state.agent_index !== null) {
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

  getAgentIssues(processorName: string, agentIndex: number): number[] {
    return this.getActiveStatesByProcessor(processorName)
      .filter((state) => state.agent_index === agentIndex)
      .map((state) => state.issue_number);
  }

  getStateFilePath(): string {
    return this.stateFile;
  }
}
