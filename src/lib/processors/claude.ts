import { Config } from "../config";
import { RepoManager } from "../repoManager";
import { ProcessStatus } from "../models";
import { StateManager } from "../stateManager";
import { spawnProcess } from "../../utils/process";
import { createIssueBranchName } from "../../utils/branch";

import { buildProcessorPrompt } from "./prompt";
import { ProcessorNotifier, prepareIssueWorkspace, broadcastProcessorError } from "./shared";

export type Notifier = ProcessorNotifier;

const PROCESSOR_NAME = "claude";

export class ClaudeProcessor {
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
    const existingState = stateManager.getState(issueNumber, PROCESSOR_NAME);
    const branchName = existingState?.branch ?? createIssueBranchName(issueNumber, PROCESSOR_NAME);
    const { repoPath } = await prepareIssueWorkspace(
      this.repoManager,
      PROCESSOR_NAME,
      issueNumber,
      agentIndex,
      repoName,
      branchName
    );

    const commandPrompt = await buildProcessorPrompt(PROCESSOR_NAME, issueNumber, {
      promptPath: this.config.claudePromptPath,
    });

    const claudeArgs = [
      this.config.claudePath,
      "--dangerously-skip-permissions",
      "-p",
      commandPrompt,
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    const { process, stdout, stderr } = spawnProcess(claudeArgs, { cwd: repoPath });
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let sessionId: string | null = null;
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
          try {
            const data = JSON.parse(line);
            if (!sessionId && (data.session_id || data.sessionId)) {
              sessionId = data.session_id ?? data.sessionId;
              const state = stateManager.getState(issueNumber, PROCESSOR_NAME);
              if (state) {
                state.session_id = sessionId;
                stateManager.setState(issueNumber, PROCESSOR_NAME, state);
                await stateManager.saveStates();
              }
            }
          } catch (error) {
            console.debug("Unable to parse Claude output", error);
          }
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
    const timeoutMs = this.config.claudeTimeout * 1000;
    const checkInterval = this.config.claudeCheckInterval * 1000;

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
        await broadcastProcessorError(this.notifiers, issueNumber, `Process timed out after ${this.config.claudeTimeout} seconds`, lastOutput, repoName);
        await Promise.all([stdoutTask, stderrTask]);
        return { status: ProcessStatus.Failed, sessionId };
      }
    }

    await Promise.all([stdoutTask, stderrTask]);

    if (exitCode === 0) {
      return { status: ProcessStatus.Completed, sessionId };
    }

    await broadcastProcessorError(
      this.notifiers,
      issueNumber,
      stderrBuffer || "Unknown error",
      lastOutput,
      repoName
    );

    return { status: ProcessStatus.Failed, sessionId };
  }
}
