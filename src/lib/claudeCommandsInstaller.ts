import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface InstallClaudeCommandsOptions {
    cwd?: string;
    fetchImpl?: typeof fetch;
}

interface GitHubContentEntry {
    name: string;
    path: string;
    type: string;
    download_url?: string;
}

const REPO_OWNER = "Hey-Diga";
const REPO_NAME = "dotclaude";
const COMMANDS_ROOT = "commands";
const DEFAULT_REF = "main";
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

const DEFAULT_HEADERS = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "imploid",
};

export async function installClaudeCommands(options: InstallClaudeCommandsOptions = {}): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (typeof fetchImpl !== "function") {
        throw new Error("fetch implementation is required to download command templates");
    }

    const claudeDir = join(cwd, ".claude");
    const commandsDir = join(claudeDir, COMMANDS_ROOT);

    await rm(commandsDir, { recursive: true, force: true });
    await mkdir(commandsDir, { recursive: true });

    await downloadDirectory(COMMANDS_ROOT, commandsDir, fetchImpl);
}

async function downloadDirectory(remotePath: string, localPath: string, fetchImpl: typeof fetch): Promise<void> {
    const entries = await fetchDirectoryContents(remotePath, fetchImpl);

    for (const entry of entries) {
        if (entry.type === "dir") {
            const nestedRemote = `${remotePath}/${entry.name}`;
            const nestedLocal = join(localPath, entry.name);
            await mkdir(nestedLocal, { recursive: true });
            await downloadDirectory(nestedRemote, nestedLocal, fetchImpl);
        } else if (entry.type === "file") {
            if (!entry.download_url) {
                throw new Error(`Missing download URL for ${entry.path}`);
            }
            await downloadFile(entry.download_url, join(localPath, entry.name), fetchImpl);
        }
    }
}

async function fetchDirectoryContents(remotePath: string, fetchImpl: typeof fetch): Promise<GitHubContentEntry[]> {
    const encodedPath = remotePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    const url = `${API_BASE}/${encodedPath}?ref=${DEFAULT_REF}`;
    const response = await fetchImpl(url, { headers: DEFAULT_HEADERS });

    if (!response.ok) {
        throw new Error(`Failed to fetch directory listing for ${remotePath}: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;

    if (!Array.isArray(payload)) {
        throw new Error(`Unexpected payload while listing ${remotePath}`);
    }

    return payload as GitHubContentEntry[];
}

async function downloadFile(url: string, destination: string, fetchImpl: typeof fetch): Promise<void> {
    const response = await fetchImpl(url, {
        headers: {
            ...DEFAULT_HEADERS,
            Accept: "application/octet-stream",
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, buffer);
}
