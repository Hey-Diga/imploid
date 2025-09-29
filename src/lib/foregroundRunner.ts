import { LockFileManager } from "./lockFileManager";

export interface ForegroundOptions {
  pollingInterval?: number;
  lockFilePath?: string;
}

export class ForegroundRunner {
  private readonly runOnce: () => Promise<void>;
  private readonly pollingInterval: number;
  private readonly lockManager: LockFileManager;
  private running = false;
  private intervalId: Timer | null = null;

  constructor(runOnce: () => Promise<void>, options: ForegroundOptions = {}) {
    this.runOnce = runOnce;
    this.pollingInterval = options.pollingInterval ?? 60000;
    this.lockManager = new LockFileManager(options.lockFilePath);
  }

  private formatTime(): string {
    const now = new Date();
    return now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  private async checkForIssues(): Promise<void> {
    console.log(`[${this.formatTime()}] Checking for new issues...`);
    try {
      await this.runOnce();
    } catch (error) {
      console.error(`[${this.formatTime()}] Error during polling:`, error);
    }
  }

  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      console.log(`\n[${this.formatTime()}] Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Foreground runner is already running");
    }

    const currentHolder = await this.lockManager.getCurrentHolder();
    if (currentHolder) {
      console.error(`Another instance is already running (PID: ${currentHolder.pid}, started: ${currentHolder.startTime})`);
      throw new Error("Imploid is already running in foreground mode");
    }

    const acquired = await this.lockManager.acquireLock();
    if (!acquired) {
      console.error("Failed to acquire lock for foreground mode");
      throw new Error("Could not start foreground mode");
    }

    this.running = true;
    this.setupSignalHandlers();

    console.log(`[${this.formatTime()}] Starting foreground mode (polling every ${this.pollingInterval / 1000} seconds)`);
    console.log(`[${this.formatTime()}] Press Ctrl+C to stop\n`);

    await this.checkForIssues();

    return new Promise((resolve) => {
      this.intervalId = setInterval(async () => {
        if (!this.running) {
          if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
          }
          resolve();
          return;
        }
        await this.checkForIssues();
      }, this.pollingInterval);
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    console.log(`[${this.formatTime()}] Stopping foreground mode...`);
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await this.lockManager.releaseLock();
    console.log(`[${this.formatTime()}] Foreground mode stopped`);
  }

  isRunning(): boolean {
    return this.running;
  }
}