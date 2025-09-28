import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupClaudeDotfiles } from "../src/lib/claudeDotfilesSetup";

const API_BASE = "https://api.github.com/repos/Hey-Diga/dotclaude/contents";
const DEFAULT_REF = "main";

const tempDirs: string[] = [];

afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("setupClaudeDotfiles", () => {
    test("downloads commands into the local .claude directory", async () => {
        const tempDir = await mkdtemp(join(tmpdir(), "claude-setup-test-"));
        tempDirs.push(tempDir);

        const fetchImpl = createMockFetch({
            [apiPath("commands")]: () =>
                new Response(
                    JSON.stringify([
                        {
                            name: "hello.txt",
                            path: "commands/hello.txt",
                            type: "file",
                            download_url: rawUrl("hello.txt"),
                        },
                        {
                            name: "nested",
                            path: "commands/nested",
                            type: "dir",
                        },
                    ])
                ),
            [apiPath("commands/nested")]: () =>
                new Response(
                    JSON.stringify([
                        {
                            name: "example.json",
                            path: "commands/nested/example.json",
                            type: "file",
                            download_url: rawUrl("nested/example.json"),
                        },
                    ])
                ),
            [rawUrl("hello.txt")]: () => new Response("hello world", { status: 200 }),
            [rawUrl("nested/example.json")]: () =>
                new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
        });

        await setupClaudeDotfiles({ cwd: tempDir, fetchImpl });

        const commandsDir = join(tempDir, ".claude", "commands");
        await expect(stat(commandsDir)).resolves.toBeDefined();

        const hello = await readFile(join(commandsDir, "hello.txt"), "utf8");
        expect(hello).toBe("hello world");

        const nestedContent = await readFile(join(commandsDir, "nested", "example.json"), "utf8");
        expect(JSON.parse(nestedContent)).toEqual({ hello: "world" });
    });
});

function createMockFetch(resolvers: Record<string, () => Response | Promise<Response>>): typeof fetch {
    return async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const resolver = resolvers[url];
        if (!resolver) {
            throw new Error(`Unexpected fetch request to ${url}`);
        }
        return resolver();
    };
}

function apiPath(path: string): string {
    const encoded = path
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    return `${API_BASE}/${encoded}?ref=${DEFAULT_REF}`;
}

function rawUrl(path: string): string {
    return `https://raw.githubusercontent.com/Hey-Diga/dotclaude/${DEFAULT_REF}/commands/${path}`;
}
