import { mkdir } from "fs/promises";
import { resolve } from "path";
import { Config, ProcessorName, SUPPORTED_PROCESSORS } from "./config";
import { buildStartupBanner } from "./startupBanner";
import { GitHubClient, GitHubIssue } from "./githubClient";
import { IssueState, ProcessStatus } from "./models";
import { RepoManager } from "./repoManager";
import { StateManager } from "./stateManager";
import { ClaudeProcessor } from "./processors/claude";
import { CodexProcessor } from "./processors/codex";
import { ProcessorNotifier } from "./processors/shared";
import { SlackNotifier } from "../notifiers/slackNotifier";
import { TelegramNotifier } from "../notifiers/telegramNotifier";
import { createIssueBranchName } from "../utils/branch";
import { ForegroundRunner } from "./foregroundRunner";
import { LockFileManager } from "./lockFileManager";

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

export class ImploidOrchestrator {
  private readonly stateManager = new StateManager();
  private readonly githubClient: GitHubClient;
  private readonly repoManager: RepoManager;
  private readonly notifiers: ProcessorNotifier[] = [];
  private readonly processors: ProcessorDefinition[];

  constructor(private readonly config: Config, processorsOverride?: ProcessorName[]) {
    this.githubClient = new GitHubClient(this.config.githubToken);

    if (this.config.telegramBotToken && this.config.telegramChatId) {
      this.notifiers.push(new TelegramNotifier(this.config.telegramBotToken, this.config.telegramChatId));
    }
    if (this.config.slackBotToken && this.config.slackChannelId) {
      this.notifiers.push(new SlackNotifier(this.config.slackBotToken, this.config.slackChannelId));
    }

    this.repoManager = new RepoManager(this.config);

    const definitions: Record<ProcessorName, () => ProcessorDefinition> = {
      claude: () => ({
        name: "claude",
        displayName: "Claude",
        labels: {
          working: "claude-working",
          completed: "claude-completed",
          failed: "claude-failed",
        },
        runner: new ClaudeProcessor(this.config, this.notifiers, this.repoManager),
      }),
      codex: () => ({
        name: "codex",
        displayName: "Codex",
        labels: {
          working: "codex-working",
          completed: "codex-completed",
          failed: "codex-failed",
        },
        runner: new CodexProcessor(this.config, this.notifiers, this.repoManager),
      }),
    };

    const activeNames = processorsOverride && processorsOverride.length
      ? Array.from(new Set(processorsOverride))
      : this.config.enabledProcessors;
    const activeSet = new Set<ProcessorName>(activeNames);

    this.processors = SUPPORTED_PROCESSORS.filter((name) => activeSet.has(name)).map((name) => definitions[name]());

    if (!this.processors.length) {
      throw new Error(
        "No processors enabled. Update your configuration or pass --processors=<names> when running imploid."
      );
    }
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

    await this.scheduleIssues(allIssues);
    await this.stateManager.saveStates();
  }

  private async scheduleIssues(issues: ExtendedIssue[]): Promise<void> {
    const activeIssueNumbers = new Set(this.stateManager.getActiveIssueNumbers());
    let remainingCapacity = this.config.maxConcurrent - activeIssueNumbers.size;

    if (remainingCapacity <= 0) {
      return;
    }

    const candidateIssues = issues.filter((issue) => !activeIssueNumbers.has(issue.number));
    if (!candidateIssues.length) {
      return;
    }

    const startPromises: Promise<void>[] = [];

    for (const issue of candidateIssues) {
      if (remainingCapacity <= 0) {
        break;
      }

      const allocations = await this.reserveIssueSlots(issue);
      if (!allocations) {
        console.warn(`Unable to schedule issue #${issue.number}; no available agent slots for all processors`);
        continue;
      }

      activeIssueNumbers.add(issue.number);
      remainingCapacity -= 1;
      startPromises.push(this.processIssueAcrossProcessors(issue, allocations));
    }

    await Promise.all(startPromises);
  }

  private async reserveIssueSlots(
    issue: ExtendedIssue
  ): Promise<Array<{ processor: ProcessorDefinition; agentIndex: number }> | null> {
    const allocations: Array<{ processor: ProcessorDefinition; agentIndex: number }> = [];

    for (const processor of this.processors) {
      const agentIndex = this.stateManager.getAvailableAgentIndex(processor.name, this.config.maxConcurrent);
      if (agentIndex === undefined) {
        return null;
      }
      allocations.push({ processor, agentIndex });
    }

    const repoName = issue.repo_name ?? this.config.githubRepo;
    for (const { processor, agentIndex } of allocations) {
      const branchName = createIssueBranchName(issue.number, processor.name);
      const state = new IssueState({
        issue_number: issue.number,
        status: ProcessStatus.Running,
        branch: branchName,
        start_time: new Date().toISOString(),
        agent_index: agentIndex,
        repo_name: repoName,
        processor_name: processor.name,
        session_id: null,
      });
      this.stateManager.setState(issue.number, processor.name, state);
    }

    await this.stateManager.saveStates();
    return allocations;
  }

  private async processIssueAcrossProcessors(
    issue: ExtendedIssue,
    allocations: Array<{ processor: ProcessorDefinition; agentIndex: number }>
  ): Promise<void> {
    await Promise.all(
      allocations.map(({ processor, agentIndex }) => this.processIssueForProcessor(processor, issue, agentIndex))
    );
  }

  private async processIssueForProcessor(
    processor: ProcessorDefinition,
    issue: ExtendedIssue,
    agentIndex: number
  ): Promise<void> {
    const repoName = issue.repo_name ?? this.config.githubRepo;
    let state = this.stateManager.getState(issue.number, processor.name);
    if (!state) {
      console.error(`State not found for issue #${issue.number} and processor ${processor.name}`);
      return;
    }

    try {
      await this.githubClient.updateIssueLabels(issue.number, {
        add: [processor.labels.working],
        remove: ["agent-ready", processor.labels.completed, processor.labels.failed],
      }, repoName);

      const formattedTitle = formatTitle(processor.displayName, issue.title);
      await Promise.all(
        this.notifiers.map((notifier) =>
          isSlackNotifier(notifier)
            ? notifier.notifyStart(issue.number, formattedTitle, repoName)
            : notifier.notifyStart(issue.number, formattedTitle)
        )
      );

      const result = await processor.runner.processIssue(issue.number, agentIndex, this.stateManager, repoName);
      state = this.stateManager.getState(issue.number, processor.name);

      if (state) {
        if (result.sessionId) {
          state.session_id = result.sessionId;
        }
        state.status = result.status;
        state.end_time = new Date().toISOString();
        this.stateManager.setState(issue.number, processor.name, state);
        await this.stateManager.saveStates();
      }

      if (result.status === ProcessStatus.Completed && state?.start_time && state?.end_time) {
        const start = new Date(state.start_time);
        const end = new Date(state.end_time);
        const durationSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
        const duration = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;

        await Promise.all(
          this.notifiers.map((notifier) =>
            notifier.notifyComplete(issue.number, duration, processor.displayName, repoName)
          )
        );

        await this.githubClient.updateIssueLabels(issue.number, {
          add: [processor.labels.completed],
          remove: [processor.labels.working],
        }, repoName);

        this.stateManager.removeState(issue.number, processor.name);
        await this.stateManager.saveStates();
      } else if (result.status === ProcessStatus.NeedsInput && state?.last_output) {
        await Promise.all(
          this.notifiers.map((notifier) =>
            isSlackNotifier(notifier)
              ? notifier.notifyNeedsInput(issue.number, state.last_output ?? "", repoName)
              : notifier.notifyNeedsInput(issue.number, state.last_output ?? "")
          )
        );
      } else if (result.status === ProcessStatus.Failed) {
        await this.githubClient.updateIssueLabels(issue.number, {
          add: [processor.labels.failed],
          remove: [processor.labels.working, "agent-ready"],
        }, repoName);
        this.stateManager.removeState(issue.number, processor.name);
        await this.stateManager.saveStates();
      }
    } catch (error) {
      console.error(`Error processing issue #${issue.number} with ${processor.displayName}`, error);
      await this.githubClient.updateIssueLabels(issue.number, {
        add: [processor.labels.failed],
        remove: [processor.labels.working, "agent-ready"],
      }, repoName).catch(() => undefined);
      this.stateManager.removeState(issue.number, processor.name);
      await this.stateManager.saveStates();
    } finally {
      await this.stateManager.saveStates();
    }
  }
}

export interface OrchestratorOptions {
  processors?: ProcessorName[];
  quiet?: boolean;
  foreground?: boolean;
  version?: string;
  description?: string;
}

export async function main(options: OrchestratorOptions = {}): Promise<void> {
  const config = await Config.loadOrCreate();

  if (!options.quiet) {
    const bannerLines = buildStartupBanner(config, {
      version: options.version,
      description: options.description,
      processorsOverride: options.processors,
    });
    for (const line of bannerLines) {
      console.log(line);
    }
  }

  const orchestrator = new ImploidOrchestrator(config, options.processors);

  if (options.foreground) {
    const lockManager = new LockFileManager();
    if (await lockManager.isLocked()) {
      const holder = await lockManager.getCurrentHolder();
      console.error(`\nError: Another Imploid instance is already running in foreground mode`);
      if (holder) {
        console.error(`  PID: ${holder.pid}`);
        console.error(`  Started: ${holder.startTime}`);
      }
      console.error(`\nTo stop the running instance, use: kill ${holder?.pid || '<PID>'}`);
      process.exitCode = 1;
      return;
    }

    const runner = new ForegroundRunner(
      async () => await orchestrator.run(),
      { pollingInterval: 60000 }
    );
    await runner.start();
  } else {
    const lockManager = new LockFileManager();
    if (await lockManager.isLocked()) {
      const holder = await lockManager.getCurrentHolder();
      console.error(`\nError: Imploid is running in foreground mode`);
      if (holder) {
        console.error(`  PID: ${holder.pid}`);
        console.error(`  Started: ${holder.startTime}`);
      }
      console.error(`\nCannot run one-shot mode while foreground mode is active.`);
      console.error(`To stop the foreground instance, use: kill ${holder?.pid || '<PID>'}`);
      process.exitCode = 1;
      return;
    }

    await orchestrator.run();
  }
}
