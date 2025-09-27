export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

export async function runCommand(command: string[], options: RunCommandOptions = {}): Promise<CommandResult> {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: options.env,
  });

  const [stdoutBuffer, stderrBuffer, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { code: exitCode, stdout: stdoutBuffer, stderr: stderrBuffer };
}

export interface SpawnedProcess {
  process: Bun.Subprocess;
  stdout: ReadableStreamDefaultReader<Uint8Array>;
  stderr: ReadableStreamDefaultReader<Uint8Array>;
}

export function spawnProcess(command: string[], options: RunCommandOptions = {}): SpawnedProcess {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin ? new TextEncoder().encode(options.stdin) : undefined,
  });

  return {
    process,
    stdout: process.stdout.getReader(),
    stderr: process.stderr.getReader(),
  };
}
