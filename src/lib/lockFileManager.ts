import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve } from "path";

interface LockData {
  pid: number;
  startTime: string;
}

export class LockFileManager {
  private readonly lockPath: string;

  constructor(lockPath?: string) {
    if (lockPath) {
      this.lockPath = this.expandPath(lockPath);
    } else {
      const homeDir = process.env.HOME;
      if (homeDir && homeDir.length) {
        this.lockPath = resolve(homeDir, ".imploid", "imploid.lock");
      } else {
        this.lockPath = resolve(process.cwd(), "imploid.lock");
      }
    }
  }

  private expandPath(path: string): string {
    if (path.startsWith("~/")) {
      const homeDir = process.env.HOME ?? "";
      if (!homeDir) {
        return path.slice(2);
      }
      return resolve(homeDir, path.slice(2));
    }
    if (path.startsWith("/")) {
      return path;
    }
    return resolve(process.cwd(), path);
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentHolder(): Promise<LockData | null> {
    try {
      const content = await readFile(this.lockPath, "utf-8");
      return JSON.parse(content) as LockData;
    } catch {
      return null;
    }
  }

  async isLocked(): Promise<boolean> {
    const holder = await this.getCurrentHolder();
    if (!holder) return false;
    
    if (this.isProcessRunning(holder.pid)) {
      return true;
    }
    
    try {
      await unlink(this.lockPath);
    } catch {
    }
    return false;
  }

  async acquireLock(): Promise<boolean> {
    const currentHolder = await this.getCurrentHolder();
    
    if (currentHolder) {
      if (this.isProcessRunning(currentHolder.pid)) {
        return false;
      }
      
      try {
        await unlink(this.lockPath);
      } catch {
      }
    }

    const lockData: LockData = {
      pid: process.pid,
      startTime: new Date().toISOString()
    };

    try {
      await mkdir(dirname(this.lockPath), { recursive: true });
      await writeFile(this.lockPath, JSON.stringify(lockData, null, 2), "utf-8");
      return true;
    } catch (error) {
      console.error("Failed to acquire lock:", error);
      return false;
    }
  }

  async releaseLock(): Promise<void> {
    try {
      const currentHolder = await this.getCurrentHolder();
      if (currentHolder && currentHolder.pid === process.pid) {
        await unlink(this.lockPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to release lock:", error);
      }
    }
  }

  getLockPath(): string {
    return this.lockPath;
  }
}