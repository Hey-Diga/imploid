import { mkdir } from "fs/promises";
import { resolve } from "path";
import { Config } from "./config";
import { GitHubClient, GitHubIssue } from "./githubClient";
import { IssueState, ProcessStatus } from "./models";
import { RepoManager } from "./repoManager";
import { StateManager } from "./stateManager";
import { ClaudeProcessor, Notifier } from "./claudeProcessor";
import { SlackNotifier } from "../notifiers/slackNotifier";
import { TelegramNotifier } from "../notifiers/telegramNotifier";

interface ExtendedIssue extends GitHubIssue {
  repo_name?: string;
}

function isSlackNotifier(notifier: Notifier): notifier is SlackNotifier {
  return notifier instanceof SlackNotifier;
}

export class IssueOrchestrator {
  private readonly stateManager: StateManager;
  private readonly githubClient: GitHubClient;
  private readonly repoManager: RepoManager;
  private readonly processor: ClaudeProcessor;
  private readonly notifiers: Notifier[];

  constructor(private readonly config: Config) {
    this.stateManager = new StateManager();
    this.githubClient = new GitHubClient(this.config.githubToken);

    this.notifiers = [];
    if (this.config.telegramBotToken && this.config.telegramChatId) {
      this.notifiers.push(new TelegramNotifier(this.config.telegramBotToken, this.config.telegramChatId));
    }
    if (this.config.slackBotToken && this.config.slackChannelId) {
      this.notifiers.push(new SlackNotifier(this.config.slackBotToken, this.config.slackChannelId));
    }

    this.repoManager = new RepoManager(this.config);
    this.processor = new ClaudeProcessor(this.config, this.notifiers, this.repoManager);
  }

  private async ensureState(): Promise<void> {
    await this.stateManager.initialize();
  }

  private async ensureBasePaths(): Promise<void> {
    for (const repoConfig of this.config.githubRepos) {
      const basePath = resolve(repoConfig.base_repo_path.replace(/^~\//, `${process.env.HOME ?? ""}/`));
      await mkdir(basePath, { recursive: true });
    }
  }

  async run(): Promise<void> {
    await this.ensureState();
    await this.ensureBasePaths();

    const allIssues: ExtendedIssue[] = [];
    for (const repoConfig of this.config.githubRepos) {
      try {
        const issues = await this.githubClient.getReadyIssues(repoConfig.name);
        issues.forEach((issue) => {
          (issue as ExtendedIssue).repo_name = repoConfig.name;
        });
        console.info(`Found ${issues.length} ready issues in ${repoConfig.name}`);
        allIssues.push(...(issues as ExtendedIssue[]));
      } catch (error) {
        console.error(`Failed to get issues from ${repoConfig.name}`, error);
      }
    }

    console.info(`Found ${allIssues.length} total ready issues`);

    const activeIssues = this.stateManager.getActiveIssues();
    const newIssues = allIssues.filter((issue) => !activeIssues.includes(issue.number));

    const availableSlots = this.config.maxConcurrent - activeIssues.length;
    if (availableSlots <= 0 || !newIssues.length) {
      await this.stateManager.saveStates();
      return;
    }

    const issuesToProcess = newIssues.slice(0, availableSlots);
    const tasks = issuesToProcess.map((issue) => this.processIssue(issue));
    await Promise.all(tasks);
    await this.stateManager.saveStates();
  }

  private async processIssue(issue: ExtendedIssue): Promise<void> {
    const availableIndex = this.stateManager.getAvailableAgentIndex(this.config.maxConcurrent);
    if (availableIndex === undefined) {
      console.warn(`No available agent slots for issue #${issue.number}`);
      return;
    }

    const repoName = issue.repo_name ?? this.config.githubRepo;
    const state = new IssueState({
      issue_number: issue.number,
      status: ProcessStatus.Running,
      branch: `issue-${issue.number}`,
      start_time: new Date().toISOString(),
      agent_index: availableIndex,
      repo_name: repoName,
      session_id: null,
    });

    this.stateManager.setState(issue.number, state);
    await this.stateManager.saveStates();

    try {
      await this.githubClient.updateIssueLabels(issue.number, {
        add: ["claude-working"],
        remove: ["ready-for-claude"],
      }, repoName);

      await Promise.all(
        this.notifiers.map((notifier) =>
          isSlackNotifier(notifier)
            ? notifier.notifyStart(issue.number, issue.title, repoName)
            : notifier.notifyStart(issue.number, issue.title)
        )
      );

      const result = await this.processor.processIssue(issue.number, availableIndex, this.stateManager, repoName);
      const currentState = this.stateManager.getState(issue.number);
      if (currentState) {
        if (result.sessionId) {
          currentState.session_id = result.sessionId;
        }
        currentState.status = result.status;
        currentState.end_time = new Date().toISOString();
        this.stateManager.setState(issue.number, currentState);
        await this.stateManager.saveStates();
      }

      if (result.status === ProcessStatus.Completed && currentState?.start_time && currentState?.end_time) {
        const start = new Date(currentState.start_time);
        const end = new Date(currentState.end_time);
        const durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
        const duration = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;

        await Promise.all(
          this.notifiers.map((notifier) =>
            isSlackNotifier(notifier)
              ? notifier.notifyComplete(issue.number, duration, repoName)
              : notifier.notifyComplete(issue.number, duration)
          )
        );

        await this.githubClient.updateIssueLabels(issue.number, {
          add: ["claude-completed"],
          remove: ["claude-working"],
        }, repoName);

        this.stateManager.removeState(issue.number);
        await this.stateManager.saveStates();
      } else if (result.status === ProcessStatus.NeedsInput && currentState?.last_output) {
        await Promise.all(
          this.notifiers.map((notifier) =>
            isSlackNotifier(notifier)
              ? notifier.notifyNeedsInput(issue.number, currentState.last_output ?? "", repoName)
              : notifier.notifyNeedsInput(issue.number, currentState.last_output ?? "")
          )
        );
      } else if (result.status === ProcessStatus.Failed) {
        await this.githubClient.updateIssueLabels(issue.number, {
          add: ["claude-failed"],
          remove: ["claude-working", "ready-for-claude"],
        }, repoName);
        this.stateManager.removeState(issue.number);
        await this.stateManager.saveStates();
      }
    } catch (error) {
      console.error(`Error processing issue #${issue.number}`, error);
      await this.githubClient.updateIssueLabels(issue.number, {
        add: ["claude-failed"],
        remove: ["claude-working", "ready-for-claude"],
      }, repoName).catch(() => undefined);
      this.stateManager.removeState(issue.number);
      await this.stateManager.saveStates();
    } finally {
      await this.stateManager.saveStates();
    }
  }
}

export async function main(): Promise<void> {
  const config = await Config.loadOrCreate();
  const orchestrator = new IssueOrchestrator(config);
  await orchestrator.run();
}
