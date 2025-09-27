import { runCommand } from "../../utils/process";
import { RepoManager } from "../repoManager";
import { SlackNotifier } from "../../notifiers/slackNotifier";
import { TelegramNotifier } from "../../notifiers/telegramNotifier";
import { createIssueBranchName } from "../../utils/branch";

export type ProcessorNotifier = SlackNotifier | TelegramNotifier;

export async function prepareIssueWorkspace(
  repoManager: RepoManager,
  processorName: string,
  issueNumber: number,
  agentIndex: number,
  repoName?: string,
  branchName?: string
): Promise<{ repoPath: string; branchName: string }> {
  const repoPath = await repoManager.ensureRepoClone(processorName, agentIndex, repoName);
  const effectiveBranchName = branchName ?? createIssueBranchName(issueNumber, processorName);

  const baseBranch = await repoManager.prepareDefaultBranch(repoPath);
  console.info(
    `[${processorName}] Preparing issue branch ${effectiveBranchName} from ${baseBranch} for agent ${agentIndex} at ${repoPath}`
  );

  const checkoutResult = await runCommand(["git", "checkout", "-B", effectiveBranchName], { cwd: repoPath });
  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to create branch ${effectiveBranchName}: ${checkoutResult.stderr}`);
  }

  const statusResult = await runCommand(["git", "status", "--porcelain"], { cwd: repoPath });
  if (statusResult.code !== 0) {
    throw new Error(`Failed to verify repository status: ${statusResult.stderr}`);
  }

  if (statusResult.stdout.trim().length) {
    throw new Error(`Repository is not clean after preparing branch ${effectiveBranchName}: ${statusResult.stdout.trim()}`);
  }

  return { repoPath, branchName: effectiveBranchName };
}

export async function broadcastProcessorError(
  notifiers: ProcessorNotifier[],
  issueNumber: number,
  message: string,
  lastOutput?: string,
  repoName?: string
): Promise<void> {
  await Promise.all(
    notifiers.map((notifier) =>
      notifier instanceof SlackNotifier
        ? notifier.notifyError(issueNumber, message, lastOutput, repoName)
        : notifier.notifyError(issueNumber, message, lastOutput)
    )
  ).catch((error) => console.error("Failed to send processor error notification", error));
}

export type IssueCommandBuilder = (issueNumber: number) => string;
