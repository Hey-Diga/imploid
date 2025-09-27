import { Config } from "../config";
import { RepoManager } from "../repoManager";
import { ProcessStatus } from "../models";
import { StateManager } from "../stateManager";
import { spawnProcess } from "../../utils/process";

import { buildIssuePrompt } from "./prompt";
import { ProcessorNotifier, prepareIssueWorkspace, broadcastProcessorError } from "./shared";

export type CodexNotifier = ProcessorNotifier;

const PROCESSOR_NAME = "codex";

export class CodexProcessor {
  private readonly config: Config;
  private readonly notifiers: ProcessorNotifier[];
  private readonly repoManager: RepoManager;

  constructor(config: Config, notifiers: ProcessorNotifier[], repoManager: RepoManager) {
    this.config = config;
    this.notifiers = notifiers;
    this.repoManager = repoManager;
  }

  async processIssue(
    issueNumber: number,
    agentIndex: number,
    stateManager: StateManager,
    repoName?: string
  ): Promise<{ status: ProcessStatus; sessionId?: string | null }> {
    const { repoPath } = await prepareIssueWorkspace(this.repoManager, PROCESSOR_NAME, issueNumber, agentIndex, repoName);

    const commandPrompt = buildIssuePrompt(issueNumber);

    const codexArgs = [
      this.config.codexPath,
      "exec",
      "--full-auto",
      "--dangerously-bypass-approvals-and-sandbox",
      commandPrompt,
    ];

    const { process, stdout, stderr } = spawnProcess(codexArgs, { cwd: repoPath });
    const decoder = new TextDecoder();

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let lastOutput = "";

    const readStdout = async () => {
      while (true) {
        const { value, done } = await stdout.read();
        if (done) break;
        stdoutBuffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (!line) continue;
          lastOutput = line;
        }
      }
    };

    const readStderr = async () => {
      while (true) {
        const { value, done } = await stderr.read();
        if (done) break;
        stderrBuffer += decoder.decode(value, { stream: true });
      }
    };

    const stdoutTask = readStdout();
    const stderrTask = readStderr();

    const start = Date.now();
    const timeoutMs = this.config.codexTimeout * 1000;
    const checkInterval = this.config.codexCheckInterval * 1000;

    let exitCode: number | null = null;
    while (exitCode === null) {
      const exited = await Promise.race([
        process.exited,
        new Promise<number | null>((resolve) => setTimeout(() => resolve(null), checkInterval)),
      ]);

      if (typeof exited === "number") {
        exitCode = exited;
        break;
      }

      if (Date.now() - start > timeoutMs) {
        process.kill();
        await broadcastProcessorError(
          this.notifiers,
          issueNumber,
          `Codex process timed out after ${this.config.codexTimeout} seconds`,
          lastOutput,
          repoName
        );
        await Promise.all([stdoutTask, stderrTask]);
        return { status: ProcessStatus.Failed, sessionId: null };
      }
    }

    await Promise.all([stdoutTask, stderrTask]);

    if (exitCode === 0) {
      return { status: ProcessStatus.Completed, sessionId: null };
    }

    await broadcastProcessorError(
      this.notifiers,
      issueNumber,
      stderrBuffer || "Unknown error",
      lastOutput,
      repoName
    );

    return { status: ProcessStatus.Failed, sessionId: null };
  }
}
