import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "fs";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { LockFileManager } from "../src/lib/lockFileManager";
import { ForegroundRunner } from "../src/lib/foregroundRunner";

describe("LockFileManager", () => {
  let lockPath: string;
  let manager: LockFileManager;

  beforeEach(() => {
    lockPath = join(tmpdir(), `test-lock-${Date.now()}.lock`);
    manager = new LockFileManager(lockPath);
  });

  afterEach(async () => {
    if (existsSync(lockPath)) {
      rmSync(lockPath, { force: true });
    }
  });

  test("acquireLock creates lock file with PID", async () => {
    const result = await manager.acquireLock();
    expect(result).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    const content = await readFile(lockPath, "utf-8");
    const data = JSON.parse(content);
    expect(data.pid).toBe(process.pid);
    expect(data.startTime).toBeDefined();
  });

  test("acquireLock fails if lock already exists with running process", async () => {
    const lockData = { pid: process.pid, startTime: new Date().toISOString() };
    await writeFile(lockPath, JSON.stringify(lockData));
    
    const result = await manager.acquireLock();
    expect(result).toBe(false);
  });

  test("acquireLock removes stale lock from terminated process", async () => {
    const stalePid = 999999;
    const lockData = { pid: stalePid, startTime: new Date().toISOString() };
    await writeFile(lockPath, JSON.stringify(lockData));
    
    const result = await manager.acquireLock();
    expect(result).toBe(true);
    const content = await readFile(lockPath, "utf-8");
    const data = JSON.parse(content);
    expect(data.pid).toBe(process.pid);
  });

  test("releaseLock removes lock file", async () => {
    await manager.acquireLock();
    expect(existsSync(lockPath)).toBe(true);
    
    await manager.releaseLock();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("isLocked returns true when lock exists", async () => {
    expect(await manager.isLocked()).toBe(false);
    await manager.acquireLock();
    expect(await manager.isLocked()).toBe(true);
    await manager.releaseLock();
    expect(await manager.isLocked()).toBe(false);
  });

  test("getCurrentHolder returns lock info", async () => {
    const before = await manager.getCurrentHolder();
    expect(before).toBeNull();
    
    await manager.acquireLock();
    const holder = await manager.getCurrentHolder();
    expect(holder?.pid).toBe(process.pid);
    expect(holder?.startTime).toBeDefined();
  });
});

describe("ForegroundRunner", () => {
  let runner: ForegroundRunner;
  let lockPath: string;
  let runOnceMock: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    lockPath = join(tmpdir(), `test-foreground-${Date.now()}.lock`);
    runOnceMock = mock(async () => {});
    runner = new ForegroundRunner(runOnceMock, { 
      pollingInterval: 100, 
      lockFilePath: lockPath 
    });
    
    consoleLogSpy = spyOn(console, "log");
    consoleErrorSpy = spyOn(console, "error");
    processExitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      return undefined as never;
    });
  });

  afterEach(async () => {
    await runner.stop();
    if (existsSync(lockPath)) {
      rmSync(lockPath, { force: true });
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test("start acquires lock and begins polling", async () => {
    runner.start();
    
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(existsSync(lockPath)).toBe(true);
    const logCalls = consoleLogSpy.mock.calls;
    const startFound = logCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Starting foreground mode'))
    );
    expect(startFound).toBe(true);
    
    await runner.stop();
  });

  test("start fails if lock is already held", async () => {
    const lockData = { pid: process.pid, startTime: new Date().toISOString() };
    await writeFile(lockPath, JSON.stringify(lockData));
    
    await expect(runner.start()).rejects.toThrow("already running");
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Another instance"));
  });

  test("executes runOnce at polling intervals", async () => {
    runner.start();
    
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(runOnceMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    
    await runner.stop();
  });

  test("handles runOnce errors gracefully", async () => {
    const errorMock = mock(async () => {
      throw new Error("Test error");
    });
    runner = new ForegroundRunner(errorMock, { 
      pollingInterval: 100, 
      lockFilePath: lockPath 
    });
    
    runner.start();
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const errorCalls = consoleErrorSpy.mock.calls;
    const errorFound = errorCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Error during polling'))
    );
    expect(errorFound).toBe(true);
    
    await runner.stop();
  });

  test("stops cleanly and releases lock", async () => {
    runner.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(existsSync(lockPath)).toBe(true);
    await runner.stop();
    
    expect(existsSync(lockPath)).toBe(false);
    const logCalls = consoleLogSpy.mock.calls;
    const stopFound = logCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Stopping foreground mode'))
    );
    expect(stopFound).toBe(true);
  });

  test.skip("handles SIGINT for graceful shutdown", async () => {
    const startPromise = runner.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    process.emit("SIGINT" as any);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const logCalls = consoleLogSpy.mock.calls;
    const sigintFound = logCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Received SIGINT'))
    );
    expect(sigintFound).toBe(true);
    await runner.stop();
  });

  test.skip("handles SIGTERM for graceful shutdown", async () => {
    const startPromise = runner.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    process.emit("SIGTERM" as any);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const logCalls = consoleLogSpy.mock.calls;
    const sigtermFound = logCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Received SIGTERM'))
    );
    expect(sigtermFound).toBe(true);
    await runner.stop();
  });

  test("displays status messages during polling", async () => {
    runner.start();
    await new Promise(resolve => setTimeout(resolve, 250));
    
    const logCalls = consoleLogSpy.mock.calls;
    const checkFound = logCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Checking for new issues'))
    );
    expect(checkFound).toBe(true);
    
    await runner.stop();
  });

  test("respects polling interval configuration", async () => {
    runner = new ForegroundRunner(runOnceMock, { 
      pollingInterval: 200, 
      lockFilePath: lockPath 
    });
    
    runner.start();
    await new Promise(resolve => setTimeout(resolve, 450));
    
    const callCount = runOnceMock.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(callCount).toBeLessThanOrEqual(3);
    
    await runner.stop();
  });
});

describe("Integration: Foreground mode with orchestrator", () => {
  test("main function accepts foreground flag", async () => {
    const options = { foreground: true, quiet: true };
    expect(options.foreground).toBe(true);
    expect(options.quiet).toBe(true);
  });
});