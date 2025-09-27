import { mkdir } from "fs/promises";
import { resolve } from "path";
import { Config } from "./config";
import { GitHubClient, GitHubIssue } from "./githubClient";
import { IssueState, ProcessStatus } from "./models";
import { RepoManager } from "./repoManager";
import { StateManager } from "./stateManager";
import { ClaudeProcessor } from "./processors/claude";
import { CodexProcessor } from "./processors/codex";
import { ProcessorNotifier } from "./processors/shared";
import { SlackNotifier } from "../notifiers/slackNotifier";
import { TelegramNotifier } from "../notifiers/telegramNotifier";

interface ExtendedIssue extends GitHubIssue {
  repo_name?: string;
}

function isSlackNotifier(notifier: ProcessorNotifier): notifier is SlackNotifier {
  return notifier instanceof SlackNotifier;
}

function formatTitle(displayName: string, title: string): string {
  return `[${displayName}] ${title}`;
}

interface ProcessorDefinition {
  name: string;
  displayName: string;
  labels: {
    working: string;
    completed: string;
    failed: string;
  };
  runner: {
    processIssue(
      issueNumber: number,
      agentIndex: number,
      stateManager: StateManager,
      repoName?: string
    ): Promise<{ status: ProcessStatus; sessionId?: string | null }>;
  };
}

export class IssueOrchestrator {
  private readonly stateManager = new StateManager();
  private readonly githubClient: GitHubClient;
  private readonly repoManager: RepoManager;
  private readonly notifiers: ProcessorNotifier[] = [];
  private readonly processors: ProcessorDefinition[];

  constructor(private readonly config: Config) {
    this.githubClient = new GitHubClient(this.config.githubToken);

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      this.notifiers.push(new TelegramNotifier(this.config.telegramBotToken, this.config.telegramChatId));
    }
    if (this.config.slackBotToken && this.config.slackChannelId) {
      this.notifiers.push(new SlackNotifier(this.config.slackBotToken, this.config.slackChannelId));
    }

    this.repoManager = new RepoManager(this.config);

    this.processors = [
      {
        name: "claude",
        displayName: "Claude",
        labels: {
          working: "claude-working",
          completed: "claude-completed",
          failed: "claude-failed",
        },
        runner: new ClaudeProcessor(this.config, this.notifiers, this.repoManager),
      },
      {
        name: "codex",
        displayName: "Codex",
        labels: {
          working: "codex-working",
          completed: "codex-completed",
          failed: "codex-failed",
        },
        runner: new CodexProcessor(this.config, this.notifiers, this.repoManager),
      },
    ];
  }

  private async ensureState(): Promise<void> {
    await this.stateManager.initialize();
  }

  private async ensureBasePaths(): Promise<void> {
    for (const repoConfig of this.config.githubRepos) {
      const basePath = resolve(repoConfig.base_repo_path.replace(/^~\//, `${process.env.HOME ?? ""}/`));
      await mkdir(basePath, { recursive: true });
      for (const processor of this.processors) {
        await mkdir(resolve(basePath, processor.name), { recursive: true });
      }
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

    for (const processor of this.processors) {
      await this.runProcessorCycle(processor, allIssues);
    }

    await this.stateManager.saveStates();
  }

  private async runProcessorCycle(processor: ProcessorDefinition, issues: ExtendedIssue[]): Promise<void> {
    const activeStates = this.stateManager.getActiveStatesByProcessor(processor.name);
    const activeIssueNumbers = new Set(activeStates.map((state) => state.issue_number));
    const availableSlots = this.config.maxConcurrent - activeStates.length;

    if (availableSlots <= 0) {
      return;
    }

    const newIssues = issues.filter((issue) => !activeIssueNumbers.has(issue.number));
    if (!newIssues.length) {
      return;
    }

    const issuesToProcess = newIssues.slice(0, availableSlots);
    await Promise.all(issuesToProcess.map((issue) => this.processIssueForProcessor(processor, issue)));
  }

  private async processIssueForProcessor(processor: ProcessorDefinition, issue: ExtendedIssue): Promise<void> {
    const availableIndex = this.stateManager.getAvailableAgentIndex(processor.name, this.config.maxConcurrent);
    if (availableIndex === undefined) {
      console.warn(`[${processor.displayName}] No available agent slots for issue #${issue.number}`);
      return;
    }

    const repoName = issue.repo_name ?? this.config.githubRepo;
    const state = new IssueState({
      issue_number: issue.number,
      status: ProcessStatus.Running,
      branch: `issue-${issue.number}-${processor.name}`,
      start_time: new Date().toISOString(),
      agent_index: availableIndex,
      repo_name: repoName,
      processor_name: processor.name,
      session_id: null,
    });

    this.stateManager.setState(issue.number, processor.name, state);
    await this.stateManager.saveStates();

    try {
      await this.githubClient.updateIssueLabels(issue.number, {
        add: [processor.labels.working],
        remove: ["ready-for-claude", processor.labels.completed, processor.labels.failed],
      }, repoName);

      const formattedTitle = formatTitle(processor.displayName, issue.title);
      await Promise.all(
        this.notifiers.map((notifier) =>
          isSlackNotifier(notifier)
            ? notifier.notifyStart(issue.number, formattedTitle, repoName)
            : notifier.notifyStart(issue.number, formattedTitle)
        )
      );

      const result = await processor.runner.processIssue(issue.number, availableIndex, this.stateManager, repoName);
      const currentState = this.stateManager.getState(issue.number, processor.name);

      if (currentState) {
        if (result.sessionId) {
          currentState.session_id = result.sessionId;
        }
        currentState.status = result.status;
        currentState.end_time = new Date().toISOString();
        this.stateManager.setState(issue.number, processor.name, currentState);
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
          add: [processor.labels.completed],
          remove: [processor.labels.working],
        }, repoName);

        this.stateManager.removeState(issue.number, processor.name);
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
          add: [processor.labels.failed],
          remove: [processor.labels.working, "ready-for-claude"],
        }, repoName);
        this.stateManager.removeState(issue.number, processor.name);
        await this.stateManager.saveStates();
      }
    } catch (error) {
      console.error(`Error processing issue #${issue.number} with ${processor.displayName}`, error);
      await this.githubClient.updateIssueLabels(issue.number, {
        add: [processor.labels.failed],
        remove: [processor.labels.working, "ready-for-claude"],
      }, repoName).catch(() => undefined);
      this.stateManager.removeState(issue.number, processor.name);
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
