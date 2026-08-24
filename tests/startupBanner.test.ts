import { describe, expect, test } from "bun:test";
import type { Config, ProcessorName } from "../src/lib/config";
import { buildStartupBanner } from "../src/lib/startupBanner";

describe("buildStartupBanner", () => {
    test("includes ASCII art and summarises configured repos, processors, and notifications", () => {
        const originalHome = process.env.HOME;
        process.env.HOME = "/home/test";

        const enabledProcessors = ["claude", "codex"] as ProcessorName[];
        const config = {
            githubRepos: [
                { name: "hey/mobile-app", base_repo_path: "/home/test/.imploid/repos" },
                { name: "hey/marketing-site", base_repo_path: "/home/test/.imploid/repos" },
                { name: "hey/api", base_repo_path: "/home/test/.imploid/repos" },
            ],
            baseRepoPath: "/home/test/.imploid/repos",
            maxConcurrent: 3,
            get enabledProcessors() {
                return enabledProcessors;
            },
            isProcessorEnabled: (name: ProcessorName) => enabledProcessors.includes(name),
            claudeTimeout: 3600,
            claudeCheckInterval: 5,
            codexTimeout: 2400,
            codexCheckInterval: 10,
            slackChannelId: "C012345",
            telegramChatId: "",
        } as unknown as Config;

        try {
            const lines = buildStartupBanner(config, {
                version: "1.2.3",
                description: "Coordinates Claude and Codex to work GitHub issues in parallel.",
                processorsOverride: ["claude"],
            });

            expect(lines[0]).toContain("_");
            expect(lines[0]).toContain("|");
            expect(lines[1]).toBe("imploid v1.2.3 - Coordinates Claude and Codex to work GitHub issues in parallel.");
            expect(lines[2]).toBe("");
            expect(lines[3]).toBe("Repos: 3 configured -> hey/mobile-app, hey/marketing-site, +1 more (cache: ~/.imploid/repos)");
            expect(lines[4]).toBe("Processors: claude active timeout=3600s interval=5s | codex skipped (--processors)");
            expect(lines[5]).toBe("Concurrency: up to 3 issues at a time");
            expect(lines[6]).toBe("Notifications: Slack -> C012345 ; Telegram -> off");
            expect(lines[7]).toBe("");
        } finally {
            process.env.HOME = originalHome;
        }
    });

    test("includes ASCII art and uses fallback text when no repos or processors enabled", () => {
        const config = {
            githubRepos: [],
            baseRepoPath: "",
            maxConcurrent: 2,
            get enabledProcessors() {
                return [] as ProcessorName[];
            },
            isProcessorEnabled: () => false,
            claudeTimeout: 3600,
            claudeCheckInterval: 5,
            codexTimeout: 3600,
            codexCheckInterval: 5,
            slackChannelId: "",
            telegramChatId: "",
        } as unknown as Config;

        const lines = buildStartupBanner(config);

        expect(lines[0]).toContain("_");
        expect(lines[0]).toContain("|");
        expect(lines[1]).toBe("imploid vunknown - undefined");
        expect(lines[2]).toBe("");
        expect(lines[3]).toBe("Repos: none configured (run imploid --config)");
        expect(lines[4]).toBe("Processors: claude disabled (config) | codex disabled (config)");
        expect(lines[5]).toBe("Concurrency: up to 2 issues at a time");
        expect(lines[6]).toBe("Notifications: Slack -> off ; Telegram -> off");
        expect(lines[7]).toBe("");
    });
});
