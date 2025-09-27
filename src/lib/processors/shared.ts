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
