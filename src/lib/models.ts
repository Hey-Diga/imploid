export enum ProcessStatus {
  Pending = "pending",
  Running = "running",
  NeedsInput = "needs_input",
  Completed = "completed",
  Failed = "failed",
}

export enum InstanceStatus {
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Unknown = "unknown",
  Timeout = "timeout",
}

export interface IssueStateData {
  issue_number: number;
  status: ProcessStatus | string;
  session_id?: string | null;
  branch: string;
  start_time: string;
  agent_index?: number | null;
  repo_name?: string | null;
  end_time?: string | null;
  last_output?: string | null;
  error?: string | null;
}

export class IssueState implements IssueStateData {
  issue_number: number;
  status: ProcessStatus | string;
  session_id?: string | null;
  branch: string;
  start_time: string;
  agent_index?: number | null;
  repo_name?: string | null;
  end_time?: string | null;
  last_output?: string | null;
  error?: string | null;

  constructor(data: IssueStateData) {
    this.issue_number = data.issue_number;
    this.status = data.status;
    this.session_id = data.session_id;
    this.branch = data.branch;
    this.start_time = data.start_time;
    this.agent_index = data.agent_index;
    this.repo_name = data.repo_name;
    this.end_time = data.end_time;
    this.last_output = data.last_output;
    this.error = data.error;
  }

  static fromJSON(data: IssueStateData): IssueState {
    return new IssueState(data);
  }

  toJSON(): IssueStateData {
    const json: IssueStateData = {
      issue_number: this.issue_number,
      status: this.status,
      branch: this.branch,
      start_time: this.start_time,
    };

    if (this.session_id) json.session_id = this.session_id;
    if (this.agent_index !== undefined) json.agent_index = this.agent_index;
    if (this.repo_name) json.repo_name = this.repo_name;
    if (this.end_time) json.end_time = this.end_time;
    if (this.last_output) json.last_output = this.last_output;
    if (this.error) json.error = this.error;

    return json;
  }
}

export interface MessageData {
  role: string;
  content: string;
  timestamp: Date;
  session_id: string;
  type?: string;
}

export class Message implements MessageData {
  role: string;
  content: string;
  timestamp: Date;
  session_id: string;
  type: string;

  constructor({ role, content, timestamp, session_id, type = "message" }: MessageData) {
    this.role = role;
    this.content = content;
    this.timestamp = timestamp;
    this.session_id = session_id;
    this.type = type;
  }

  static fromJSONL(line: string): Message {
    const data = JSON.parse(line);
    const timestamp = new Date(data.timestamp ?? data.message?.timestamp ?? Date.now());
    const rawContent = data.message?.content;

    let content: string;
    if (Array.isArray(rawContent)) {
      content = rawContent
        .filter((block: any) => block && block.type === "text")
        .map((block: any) => block.text ?? "")
        .join(" ");
    } else {
      content = rawContent ?? "";
    }

    return new Message({
      role: data.message?.role ?? "assistant",
      content,
      timestamp,
      session_id: data.sessionId ?? data.session_id ?? "",
      type: data.type ?? "message",
    });
  }
}

export interface ClaudeInstanceData {
  issue_number: number;
  repo_path: string;
  branch: string;
  pid?: number;
  status?: InstanceStatus;
  start_time?: Date;
  end_time?: Date;
  runtime_seconds?: number;
  message_count?: number;
  last_activity?: Date;
  command_line?: string;
  session_id?: string | null;
  messages?: Message[];
}

export class ClaudeInstance implements ClaudeInstanceData {
  issue_number: number;
  repo_path: string;
  branch: string;
  pid?: number;
  status: InstanceStatus;
  start_time?: Date;
  end_time?: Date;
  runtime_seconds?: number;
  message_count: number;
  last_activity?: Date;
  command_line: string;
  session_id?: string | null;
  messages: Message[];

  constructor(data: ClaudeInstanceData) {
    this.issue_number = data.issue_number;
    this.repo_path = data.repo_path;
    this.branch = data.branch;
    this.pid = data.pid;
    this.status = data.status ?? InstanceStatus.Unknown;
    this.start_time = data.start_time;
    this.end_time = data.end_time;
    this.runtime_seconds = data.runtime_seconds;
    this.message_count = data.message_count ?? 0;
    this.last_activity = data.last_activity;
    this.command_line = data.command_line ?? "";
    this.session_id = data.session_id ?? null;
    this.messages = data.messages ?? [];
  }
}

export interface MonitorReportData {
  active_instances?: ClaudeInstance[];
  completed_instances?: ClaudeInstance[];
  total_instances?: number;
  timestamp?: Date;
}

export class MonitorReport implements MonitorReportData {
  active_instances: ClaudeInstance[] = [];
  completed_instances: ClaudeInstance[] = [];
  total_instances = 0;
  timestamp: Date = new Date();

  constructor(data?: MonitorReportData) {
    if (data) {
      this.active_instances = data.active_instances ?? [];
      this.completed_instances = data.completed_instances ?? [];
      this.total_instances = data.total_instances ?? this.total_instances;
      this.timestamp = data.timestamp ?? new Date();
    }
  }

  toJSON() {
    return {
      timestamp: this.timestamp.toISOString(),
      total_instances: this.total_instances,
      active_count: this.active_instances.length,
      completed_count: this.completed_instances.length,
      active_instances: this.active_instances.map((inst) => ({
        issue_number: inst.issue_number,
        repo_path: inst.repo_path,
        branch: inst.branch,
        pid: inst.pid,
        status: inst.status,
        runtime_seconds: inst.runtime_seconds,
        message_count: inst.message_count,
        last_activity: inst.last_activity?.toISOString() ?? null,
        session_id: inst.session_id,
      })),
      completed_instances: this.completed_instances.map((inst) => ({
        issue_number: inst.issue_number,
        repo_path: inst.repo_path,
        branch: inst.branch,
        status: inst.status,
        runtime_seconds: inst.runtime_seconds,
        message_count: inst.message_count,
        session_id: inst.session_id,
      })),
    };
  }

  toText(): string {
    const lines: string[] = [];
    lines.push("Claude Code Instance Monitor Report");
    lines.push(`Generated: ${this.timestamp.toISOString()}`);
    lines.push("=".repeat(60));
    lines.push(`Total Instances: ${this.total_instances}`);
    lines.push(`Active: ${this.active_instances.length}`);
    lines.push(`Completed: ${this.completed_instances.length}`);
    lines.push("");

    if (this.active_instances.length) {
      lines.push("ACTIVE INSTANCES:");
      lines.push("-".repeat(40));
      for (const inst of this.active_instances) {
        const runtime = inst.runtime_seconds ? `${inst.runtime_seconds.toFixed(1)}s` : "N/A";
        lines.push(`  Issue #${inst.issue_number}:`);
        lines.push(`    PID: ${inst.pid ?? "N/A"}`);
        lines.push(`    Status: ${inst.status}`);
        lines.push(`    Runtime: ${runtime}`);
        lines.push(`    Messages: ${inst.message_count}`);
        if (inst.last_activity) {
          lines.push(`    Last Activity: ${inst.last_activity.toISOString()}`);
        }
        lines.push("");
      }
    }

    if (this.completed_instances.length) {
      lines.push("COMPLETED INSTANCES:");
      lines.push("-".repeat(40));
      for (const inst of this.completed_instances) {
        const runtime = inst.runtime_seconds ? `${inst.runtime_seconds.toFixed(1)}s` : "N/A";
        lines.push(`  Issue #${inst.issue_number}:`);
        lines.push(`    Status: ${inst.status}`);
        lines.push(`    Runtime: ${runtime}`);
        lines.push(`    Messages: ${inst.message_count}`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }
}
