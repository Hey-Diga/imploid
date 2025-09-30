import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function expandHomePath(input: string): string {
  if (input.startsWith("~/")) {
    return resolve(process.env.HOME ?? "", input.slice(2));
  }
  return input;
}

export async function loadPromptTemplate(
  processorName: string,
  customPath?: string
): Promise<string> {
  const userPromptsDir = expandHomePath("~/.imploid/prompts/");
  let templatePath: string;
  let templateContent: string;

  if (customPath) {
    const customFullPath = resolve(userPromptsDir, `${customPath}.md`);
    try {
      templateContent = await readFile(customFullPath, "utf8");
      return templateContent;
    } catch (error) {
      throw new Error(
        `Failed to load custom prompt from ${customFullPath}: ${(error as Error).message}`
      );
    }
  }

  const userDefaultPath = resolve(userPromptsDir, `${processorName}-default.md`);
  try {
    templateContent = await readFile(userDefaultPath, "utf8");
    return templateContent;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Failed to load user prompt from ${userDefaultPath}: ${(error as Error).message}`
      );
    }
  }

  const defaultPath = resolve(__dirname, "prompts", `${processorName}-default.md`);
  try {
    templateContent = await readFile(defaultPath, "utf8");
    return templateContent;
  } catch (error) {
    throw new Error(
      `Failed to load default prompt from ${defaultPath}: ${(error as Error).message}`
    );
  }
}

export async function buildIssuePrompt(
  issueNumber: number,
  processorName: string,
  customPath?: string
): Promise<string> {
  const template = await loadPromptTemplate(processorName, customPath);
  return template.replace(/\$\{issueNumber\}/g, String(issueNumber));
}
