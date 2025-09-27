import { mkdir, stat } from "fs/promises";
import { dirname, basename } from "path";
import { Config } from "./config";
import { runCommand } from "../utils/process";

export class RepoManager {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async ensureRepoClone(agentIndex: number, repoName?: string): Promise<string> {
    const repoPath = this.config.getRepoPath(agentIndex, repoName);

    const exists = await stat(repoPath).then(() => true).catch(() => false);

    if (exists) {
      console.info(`Pulling latest changes for agent ${agentIndex} at ${repoPath}`);
      await this.pullLatest(repoPath);
    } else {
      console.info(`Cloning repository for agent ${agentIndex} to ${repoPath}`);
      await this.cloneRepo(repoPath, repoName ?? this.config.githubRepo);
    }

    await this.ensureCleanState(repoPath);
    await this.runSetup(repoPath);

    return repoPath;
  }

  private async cloneRepo(repoPath: string, repoName: string): Promise<void> {
    const parent = dirname(repoPath);
    await mkdir(parent, { recursive: true });
    const targetDirName = basename(repoPath);

    const result = await runCommand([
      "git",
      "clone",
      `git@github.com:${repoName}.git`,
      targetDirName,
    ], { cwd: parent || undefined });
    if (result.code !== 0) {
      throw new Error(`Failed to clone repository: ${result.stderr}`);
    }
  }

  async pullLatest(repoPath: string): Promise<void> {
    const checkout = await runCommand(["git", "checkout", "main"], { cwd: repoPath });
    if (checkout.code !== 0) {
      throw new Error(`Failed to checkout main branch: ${checkout.stderr}`);
    }

    const fetchResult = await runCommand(["git", "fetch", "origin"], { cwd: repoPath });
    if (fetchResult.code !== 0) {
      throw new Error(`Failed to fetch latest changes: ${fetchResult.stderr}`);
    }

    const pullResult = await runCommand(["git", "pull", "origin", "main"], { cwd: repoPath });
    if (pullResult.code !== 0) {
      throw new Error(`Failed to pull latest changes: ${pullResult.stderr}`);
    }
  }

  private async runSetup(repoPath: string): Promise<void> {
    const chmodResult = await runCommand(["chmod", "+x", "setup.sh"], { cwd: repoPath }).catch(() => ({ code: 0, stdout: "", stderr: "" }));
    if (chmodResult.code !== 0) {
      console.warn(`Failed to make setup.sh executable: ${chmodResult.stderr}`);
    }

    const result = await runCommand(["./setup.sh"], { cwd: repoPath }).catch((error) => ({ code: 1, stdout: "", stderr: String(error) }));
    if (result.code !== 0) {
      console.warn(`setup.sh failed: ${result.stderr}`);
    }
  }

  async ensureCleanState(repoPath: string): Promise<void> {
    const status = await runCommand(["git", "status", "--porcelain"], { cwd: repoPath });
    if (status.code !== 0) {
      throw new Error(`Failed to check git status: ${status.stderr}`);
    }
    if (status.stdout.trim().length) {
      console.warn(`Repository has uncommitted changes: ${status.stdout.trim()}`);
    }

    const branch = await runCommand(["git", "branch", "--show-current"], { cwd: repoPath });
    if (branch.code !== 0) {
      throw new Error(`Failed to get current branch: ${branch.stderr}`);
    }

    const current = branch.stdout.trim();
    if (!current) {
      let checkout = await runCommand(["git", "checkout", "main"], { cwd: repoPath });
      if (checkout.code !== 0) {
        checkout = await runCommand(["git", "checkout", "master"], { cwd: repoPath });
        if (checkout.code !== 0) {
          throw new Error("Failed to checkout main or master branch");
        }
        console.info("Switched to master branch (legacy)");
      } else {
        console.info("Switched to main branch");
      }
    }
  }

  async validateBranchReady(repoPath: string, branchName: string): Promise<boolean> {
    const exists = await runCommand(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd: repoPath });
    if (exists.code !== 0) {
      console.error(`Branch ${branchName} does not exist`);
      return false;
    }

    const current = await runCommand(["git", "branch", "--show-current"], { cwd: repoPath });
    if (current.code !== 0) {
      console.error(`Failed to get current branch: ${current.stderr}`);
      return false;
    }

    const activeBranch = current.stdout.trim();
    if (activeBranch !== branchName) {
      console.error(`Expected to be on branch ${branchName}, but currently on ${activeBranch}`);
      return false;
    }

    const status = await runCommand(["git", "status", "--porcelain"], { cwd: repoPath });
    if (status.code !== 0) {
      console.error(`Failed to check git status: ${status.stderr}`);
      return false;
    }

    if (status.stdout.trim().length) {
      console.warn(`Branch has uncommitted changes: ${status.stdout.trim()}`);
    }

    console.info(`Branch ${branchName} is ready for processing`);
    return true;
  }
}
