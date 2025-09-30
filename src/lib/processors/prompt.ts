import { readFile } from "fs/promises";
import { resolve, isAbsolute, extname } from "path";
import { fileURLToPath } from "url";
import type { ProcessorName } from "../config";

const DEFAULT_PROMPT_NAMES: Record<ProcessorName, string> = {
    claude: "claude-default.md",
    codex: "codex-default.md",
};

const TEMPLATE_CACHE = new Map<string, string>();
const MODULE_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const DEFAULT_PROMPT_DIR = resolve(MODULE_DIR, "prompts");
const USER_PROMPT_SUBDIR = [".imploid", "prompts"] as const;

export interface BuildPromptOptions {
    promptPath?: string;
}

function ensureMdExtension(input: string): string {
    return extname(input) ? input : `${input}.md`;
}

function expandHomePrefix(input: string): string {
    if (input.startsWith("~/")) {
        const home = process.env.HOME ?? "";
        return resolve(home, input.slice(2));
    }
    return input;
}

async function loadTemplate(candidate: string): Promise<string | null> {
    if (TEMPLATE_CACHE.has(candidate)) {
        return TEMPLATE_CACHE.get(candidate) ?? null;
    }

    try {
        const content = await readFile(candidate, "utf8");
        TEMPLATE_CACHE.set(candidate, content);
        return content;
    } catch (error: unknown) {
        if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read prompt template at ${candidate}: ${message}`);
    }
}

function getPromptCandidates(
    processor: ProcessorName,
    promptPath?: string,
): { candidates: string[]; displayName: string } {
    const homeDir = process.env.HOME ? resolve(process.env.HOME) : undefined;

    if (promptPath) {
        if (promptPath.startsWith("~/")) {
            const withExt = ensureMdExtension(promptPath);
            const expanded = expandHomePrefix(withExt);
            return { candidates: [expanded], displayName: withExt };
        }

        if (isAbsolute(promptPath)) {
            const absolutePath = ensureMdExtension(promptPath);
            return { candidates: [absolutePath], displayName: absolutePath };
        }

        const fileName = ensureMdExtension(promptPath);
        const candidates: string[] = [];
        if (homeDir) {
            candidates.push(resolve(homeDir, ...USER_PROMPT_SUBDIR, fileName));
        }
        candidates.push(resolve(DEFAULT_PROMPT_DIR, fileName));
        return { candidates, displayName: fileName };
    }

    const defaultName = DEFAULT_PROMPT_NAMES[processor];
    const candidates: string[] = [];
    if (homeDir) {
        candidates.push(resolve(homeDir, ...USER_PROMPT_SUBDIR, defaultName));
    }
    candidates.push(resolve(DEFAULT_PROMPT_DIR, defaultName));
    return { candidates, displayName: defaultName };
}

function substituteVariables(template: string, issueNumber: number): string {
    return template.replace(/\$\{issueNumber\}/g, String(issueNumber));
}

export async function buildProcessorPrompt(
    processor: ProcessorName,
    issueNumber: number,
    options: BuildPromptOptions = {},
): Promise<string> {
    const { promptPath } = options;
    const { candidates, displayName } = getPromptCandidates(processor, promptPath);

    for (const candidate of candidates) {
        const template = await loadTemplate(candidate);
        if (template !== null) {
            return substituteVariables(template, issueNumber);
        }
    }

    throw new Error(
        `Prompt template ${displayName} not found. Checked locations: ${candidates.join(", ")}`,
    );
}
