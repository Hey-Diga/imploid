import { Config, ProcessorName, SUPPORTED_PROCESSORS } from "./config";

export interface StartupBannerOptions {
	version?: string;
	description?: string;
	processorsOverride?: ProcessorName[];
}

function abbreviateHomePath(input: string): string {
	if (!input) {
		return "";
	}
	const home = process.env.HOME;
	if (home && input.startsWith(home)) {
		const remainder = input.slice(home.length);
		return remainder.length ? `~${remainder}` : "~";
	}
	return input;
}

function formatRepoLine(config: Config): string {
	const repos = config.githubRepos;
	const count = repos.length;
	if (!count) {
		return "Repos: none configured (run imploid --config)";
	}

	const names = repos.slice(0, 2).map((repo) => repo.name);
	let summary = `${count} configured -> ${names.join(", ")}`;
	if (count > 2) {
		summary += `, +${count - 2} more`;
	}

	const basePath = abbreviateHomePath(
		config.baseRepoPath || repos[0]?.base_repo_path || "",
	);
	if (basePath) {
		summary += ` (cache: ${basePath})`;
	}

	return `Repos: ${summary}`;
}

function formatProcessorSegments(
	config: Config,
	processorsOverride?: ProcessorName[],
): string {
	const override =
		processorsOverride && processorsOverride.length
			? Array.from(new Set(processorsOverride))
			: undefined;
	const activeNames = override ?? config.enabledProcessors;
	const activeSet = new Set<ProcessorName>(activeNames);
	const overrideUsed = Boolean(override);

	const segments = SUPPORTED_PROCESSORS.map((name) => {
		const isActive = activeSet.has(name);
		const isEnabled = config.isProcessorEnabled(name);
		if (isActive) {
			const timeout =
				name === "claude" ? config.claudeTimeout : config.codexTimeout;
			const interval =
				name === "claude"
					? config.claudeCheckInterval
					: config.codexCheckInterval;
			return `${name} active timeout=${timeout}s interval=${interval}s`;
		}
		if (isEnabled) {
			return overrideUsed
				? `${name} skipped (--processors)`
				: `${name} enabled`;
		}
		return `${name} disabled (config)`;
	});

	return `Processors: ${segments.join(" | ")}`;
}

function formatConcurrencyLine(config: Config): string {
	return `Concurrency: up to ${config.maxConcurrent} issues at a time`;
}

function formatNotificationsLine(config: Config): string {
	const slackStatus = config.slackChannelId ? config.slackChannelId : "off";
	const telegramStatus = config.telegramChatId ? config.telegramChatId : "off";
	return `Notifications: Slack -> ${slackStatus} ; Telegram -> ${telegramStatus}`;
}

export function buildStartupBanner(
	config: Config,
	options: StartupBannerOptions = {},
): string[] {
	const version = options.version ?? "unknown";

	const lines = [
		`imploid v${version} - ${options.description}`,
		"",
		formatRepoLine(config),
		formatProcessorSegments(config, options.processorsOverride),
		formatConcurrencyLine(config),
		formatNotificationsLine(config),
		"",
	];

	return lines;
}
