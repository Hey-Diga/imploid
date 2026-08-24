import { describe, expect, test } from "bun:test";
import type { Config, ProcessorName } from "../src/lib/config";
import { buildStartupBanner } from "../src/lib/startupBanner";

describe("buildStartupBanner", () => {
    test("summarises configured repos, processors, and notifications", () => {
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

            expect(lines).toEqual([
                "  _                 _       _     _ ",
                " (_)_ __ ___  _ __ | | ___ (_) __| |",
                " | | '_ ` _ \\| '_ \\| |/ _ \\| |/ _` |",
                " | | | | | | | |_) | | (_) | | (_| |",
                " |_|_| |_| |_| .__/|_|\\___/|_|\\__,_|",
                "             |_|                    ",
                "",
                "imploid v1.2.3 - Coordinates Claude and Codex to work GitHub issues in parallel.",
                "",
                "Repos: 3 configured -> hey/mobile-app, hey/marketing-site, +1 more (cache: ~/.imploid/repos)",
                "Processors: claude active timeout=3600s interval=5s | codex skipped (--processors)",
                "Concurrency: up to 3 issues at a time",
                "Notifications: Slack -> C012345 ; Telegram -> off",
                "",
            ]);
        } finally {
            process.env.HOME = originalHome;
        }
    });

    test("uses fallback text when no repos or processors enabled", () => {
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

        expect(lines).toEqual([
            "  _                 _       _     _ ",
            " (_)_ __ ___  _ __ | | ___ (_) __| |",
            " | | '_ ` _ \\| '_ \\| |/ _ \\| |/ _` |",
            " | | | | | | | |_) | | (_) | | (_| |",
            " |_|_| |_| |_| .__/|_|\\___/|_|\\__,_|",
            "             |_|                    ",
            "",
            "imploid vunknown - undefined",
            "",
            "Repos: none configured (run imploid --config)",
            "Processors: claude disabled (config) | codex disabled (config)",
            "Concurrency: up to 2 issues at a time",
            "Notifications: Slack -> off ; Telegram -> off",
            "",
        ]);
    });
});
