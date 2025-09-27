import { runCommand } from "../../utils/process";
import { RepoManager } from "../repoManager";
import { SlackNotifier } from "../../notifiers/slackNotifier";
import { TelegramNotifier } from "../../notifiers/telegramNotifier";

export type ProcessorNotifier = SlackNotifier | TelegramNotifier;

export async function prepareIssueWorkspace(
  repoManager: RepoManager,
  processorName: string,
  issueNumber: number,
  agentIndex: number,
  repoName?: string
): Promise<{ repoPath: string; branchName: string }> {
  const repoPath = await repoManager.ensureRepoClone(processorName, agentIndex, repoName);
  const branchName = `issue-${issueNumber}-${processorName}`;

  const baseBranch = await repoManager.prepareDefaultBranch(repoPath);
  console.info(
    `[${processorName}] Preparing issue branch ${branchName} from ${baseBranch} for agent ${agentIndex} at ${repoPath}`
  );

  const checkoutResult = await runCommand(["git", "checkout", "-B", branchName], { cwd: repoPath });
  if (checkoutResult.code !== 0) {
    throw new Error(`Failed to create branch ${branchName}: ${checkoutResult.stderr}`);
  }

  const statusResult = await runCommand(["git", "status", "--porcelain"], { cwd: repoPath });
  if (statusResult.code !== 0) {
    throw new Error(`Failed to verify repository status: ${statusResult.stderr}`);
  }

  if (statusResult.stdout.trim().length) {
    throw new Error(`Repository is not clean after preparing branch ${branchName}: ${statusResult.stdout.trim()}`);
  }

  return { repoPath, branchName };
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
