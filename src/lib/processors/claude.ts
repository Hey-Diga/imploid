import { Config } from "../config";
import { RepoManager } from "../repoManager";
import { ProcessStatus } from "../models";
import { StateManager } from "../stateManager";
import { runCommand, spawnProcess } from "../../utils/process";
import { SlackNotifier } from "../../notifiers/slackNotifier";
import { TelegramNotifier } from "../../notifiers/telegramNotifier";

import { buildIssuePrompt } from "./prompt";

export type Notifier = SlackNotifier | TelegramNotifier;

export class ClaudeProcessor {
  private readonly config: Config;
  private readonly notifiers: Notifier[];
  private readonly repoManager: RepoManager;

  constructor(config: Config, notifiers: Notifier[], repoManager: RepoManager) {
    this.config = config;
    this.notifiers = notifiers;
    this.repoManager = repoManager;
  }

  private async sendError(issueNumber: number, message: string, lastOutput?: string, repoName?: string) {
    await Promise.all(
      this.notifiers.map((notifier) =>
        notifier instanceof SlackNotifier
          ? notifier.notifyError(issueNumber, message, lastOutput, repoName)
          : notifier.notifyError(issueNumber, message, lastOutput)
      )
    ).catch((error) => console.error("Failed to send error notification", error));
  }

  async processIssue(
    issueNumber: number,
    agentIndex: number,
    stateManager: StateManager,
    repoName?: string
  ): Promise<{ status: ProcessStatus; sessionId?: string | null }> {
    const repoPath = await this.repoManager.ensureRepoClone(agentIndex, repoName);
    const branchName = `issue-${issueNumber}`;

    const branchCheck = await runCommand(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd: repoPath,
    });
    if (branchCheck.code === 0) {
      const checkout = await runCommand(["git", "checkout", branchName], { cwd: repoPath });
      if (checkout.code !== 0) {
        throw new Error(`Failed to checkout branch: ${checkout.stderr}`);
      }
    } else {
      const create = await runCommand(["git", "checkout", "-b", branchName], { cwd: repoPath });
      if (create.code !== 0) {
        throw new Error(`Failed to create branch: ${create.stderr}`);
      }
    }

    const currentBranch = await runCommand(["git", "branch", "--show-current"], { cwd: repoPath });
    if (currentBranch.code !== 0) {
      throw new Error(`Failed to get current branch: ${currentBranch.stderr}`);
    }

    if (currentBranch.stdout.trim() !== branchName) {
      throw new Error(`Expected to be on branch ${branchName}, but currently on ${currentBranch.stdout.trim()}`);
    }

    const ready = await this.repoManager.validateBranchReady(repoPath, branchName);
    if (!ready) {
      throw new Error(`Branch ${branchName} is not ready for processing`);
    }

    const commandPrompt = buildIssuePrompt(issueNumber);

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
              const state = stateManager.getState(issueNumber);
              if (state) {
                state.session_id = sessionId;
                stateManager.setState(issueNumber, state);
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
        await this.sendError(issueNumber, `Process timed out after ${this.config.claudeTimeout} seconds`, lastOutput, repoName);
        await Promise.all([stdoutTask, stderrTask]);
        return { status: ProcessStatus.Failed, sessionId };
      }
    }

    await Promise.all([stdoutTask, stderrTask]);

    if (exitCode === 0) {
      return { status: ProcessStatus.Completed, sessionId };
    }

    await this.sendError(
      issueNumber,
      stderrBuffer || "Unknown error",
      lastOutput,
      repoName
    );

    return { status: ProcessStatus.Failed, sessionId };
  }
}
