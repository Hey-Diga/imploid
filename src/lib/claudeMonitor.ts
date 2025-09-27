import { readFile } from "fs/promises";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { spawnSync } from "child_process";
import { ClaudeInstance, InstanceStatus, Message, MonitorReport } from "./models";

interface OrchestratorStateEntry {
  status: string;
  branch?: string;
  agent_index?: number;
  repo_name?: string;
  session_id?: string;
  start_time?: string;
  end_time?: string;
  last_output?: string;
}

export class ClaudeMonitor {
  private readonly repoPath: string;
  private readonly outputFormat: "text" | "json";
  private readonly claudeProjectsDir: string;
  private readonly stateFile: string;

  constructor(repoPath: string, outputFormat: "text" | "json" = "text") {
    this.repoPath = resolve(repoPath);
    this.outputFormat = outputFormat;
    const claudeHome = resolve(process.env.HOME ?? "", ".claude");
    this.claudeProjectsDir = join(claudeHome, "projects");
    this.stateFile = join(dirname(__dirname), "..", "processing-state.json");
  }

  private async readOrchestratorState(): Promise<Map<number, OrchestratorStateEntry>> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, OrchestratorStateEntry>;
      return new Map<number, OrchestratorStateEntry>(
        Object.entries(parsed).map(([key, value]) => [Number(key), value])
      );
    } catch {
      return new Map();
    }
  }

  private encodeProjectPath(path: string): string {
    return path.replace(/[\\/:.]/g, "-");
  }

  private readJsonlMessages(projectDir: string, sessionId?: string): Message[] {
    if (!existsSync(projectDir)) return [];
    const files = readdirSync(projectDir).filter((file) => file.endsWith(".jsonl"));
    const messages: Message[] = [];

    for (const file of files) {
      if (sessionId && !file.includes(sessionId)) continue;
      const content = readFileSync(join(projectDir, file), "utf8");
      const lines = content.split(/
+/).filter(Boolean);
      for (const line of lines) {
        try {
          messages.push(Message.fromJSONL(line));
        } catch {
          continue;
        }
      }
    }

    return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private getProcessInfo(repoPath: string): { pid: number; cmdline: string } | null {
    const result = spawnSync("ps", ["aux"], { encoding: "utf8" });
    if (result.status !== 0) return null;

    for (const line of result.stdout.split("\n")) {
      if (line.toLowerCase().includes("claude") && line.includes(repoPath)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 1) {
          return {
            pid: Number(parts[1]),
            cmdline: line,
          };
        }
      }
    }

    return null;
  }

  async getActiveInstances(): Promise<ClaudeInstance[]> {
    const state = await this.readOrchestratorState();
    const instances: ClaudeInstance[] = [];

    for (const [issueNumber, entry] of state.entries()) {
      if (!entry || (entry.status !== "running" && entry.status !== "needs_input")) {
        continue;
      }

      const repoName = entry.repo_name ?? this.repoPath.split("/").pop() ?? "";
      const repoPath = entry.agent_index !== undefined
        ? resolve(this.repoPath, "..", `${repoName.split("/").pop()}_agent_${entry.agent_index}`)
        : this.repoPath;

      const info = this.getProcessInfo(repoPath);
      if (!info) continue;

      const instance = new ClaudeInstance({
        issue_number: issueNumber,
        repo_path: repoPath,
        branch: entry.branch ?? `issue-${issueNumber}`,
        pid: info.pid,
        status: InstanceStatus.Running,
        command_line: info.cmdline,
        session_id: entry.session_id ?? null,
      });

      const projectDir = join(this.claudeProjectsDir, this.encodeProjectPath(repoPath));
      const messages = this.readJsonlMessages(projectDir, entry.session_id);
      if (messages.length) {
        instance.messages = messages;
        instance.message_count = messages.length;
        instance.last_activity = messages[messages.length - 1].timestamp;
      }

      instances.push(instance);
    }

    return instances;
  }

  async getConversationHistory(issueNumber: number, sessionId?: string): Promise<Message[]> {
    const state = await this.readOrchestratorState();
    const entry = state.get(issueNumber);
    const repoPath = entry?.agent_index !== undefined
      ? resolve(this.repoPath, "..", `${(entry.repo_name ?? this.repoPath).split("/").pop()}_agent_${entry.agent_index}`)
      : this.repoPath;

    const projectDir = join(this.claudeProjectsDir, this.encodeProjectPath(repoPath));
    return this.readJsonlMessages(projectDir, sessionId ?? entry?.session_id ?? undefined);
  }

  async getInstanceStatus(issueNumber: number): Promise<ClaudeInstance | null> {
    const state = await this.readOrchestratorState();
    const entry = state.get(issueNumber);
    if (!entry) return null;

    const repoName = entry.repo_name ?? this.repoPath.split("/").pop() ?? "";
    const repoPath = entry.agent_index !== undefined
      ? resolve(this.repoPath, "..", `${repoName.split("/").pop()}_agent_${entry.agent_index}`)
      : this.repoPath;

    const info = this.getProcessInfo(repoPath);
    const instance = new ClaudeInstance({
      issue_number: issueNumber,
      repo_path: repoPath,
      branch: entry.branch ?? `issue-${issueNumber}`,
      status: InstanceStatus.Unknown,
      pid: info?.pid,
      command_line: info?.cmdline ?? "",
      session_id: entry.session_id ?? null,
    });

    const messages = await this.getConversationHistory(issueNumber);
    if (messages.length) {
      instance.messages = messages;
      instance.message_count = messages.length;
      instance.last_activity = messages[messages.length - 1].timestamp;
    }

    if (info) {
      instance.status = InstanceStatus.Running;
    } else if (entry.status === "completed") {
      instance.status = InstanceStatus.Completed;
    } else if (entry.status === "failed") {
      instance.status = InstanceStatus.Failed;
    }

    return instance;
  }

  async monitorAll(): Promise<MonitorReport> {
    const report = new MonitorReport();
    report.active_instances = await this.getActiveInstances();
    report.total_instances = report.active_instances.length;

    return report;
  }

  formatOutput(data: MonitorReport | ClaudeInstance | Message[] | null): string {
    if (data === null) {
      return "No data available";
    }

    if (Array.isArray(data) && data.length && data[0] instanceof Message) {
      return data
        .map((msg) => `[${msg.timestamp.toISOString()}] ${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n");
    }

    if (data instanceof MonitorReport) {
      return data.toText();
    }

    if (data instanceof ClaudeInstance) {
      const lines: string[] = [];
      lines.push(`Issue #${data.issue_number}`);
      lines.push(`Status: ${data.status}`);
      lines.push(`Repo Path: ${data.repo_path}`);
      if (data.pid) lines.push(`PID: ${data.pid}`);
      if (data.message_count) lines.push(`Messages: ${data.message_count}`);
      if (data.last_activity) lines.push(`Last Activity: ${data.last_activity.toISOString()}`);
      return lines.join("\n");
    }

    return JSON.stringify(data, null, 2);
  }
}

export async function monitorCli(args: {
  command?: string;
  repo?: string;
  issue?: number;
  format?: "text" | "json";
}) {
  const monitor = new ClaudeMonitor(args.repo ?? ".", args.format ?? "text");

  if (!args.command) {
    const active = await monitor.getActiveInstances();
    if (active.length) {
      console.log("Active Claude Code instances:");
      for (const instance of active) {
        console.log(monitor.formatOutput(instance));
        console.log("");
      }
    } else {
      console.log("No active instances.");
    }
    return;
  }

  if (args.command === "status") {
    if (args.issue) {
      const instance = await monitor.getInstanceStatus(args.issue);
      console.log(monitor.formatOutput(instance));
    } else {
      const instances = await monitor.getActiveInstances();
      for (const instance of instances) {
        console.log(monitor.formatOutput(instance));
        console.log("");
      }
    }
  } else if (args.command === "history") {
    if (!args.issue) {
      console.error("--issue required for history command");
      return;
    }
    const messages = await monitor.getConversationHistory(args.issue);
    console.log(monitor.formatOutput(messages));
  } else if (args.command === "monitor") {
    const report = await monitor.monitorAll();
    console.log(monitor.formatOutput(report));
  }
}
