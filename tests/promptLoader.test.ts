import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { buildProcessorPrompt } from "../src/lib/processors/prompt";

const originalHome = process.env.HOME;
let tempHome: string | undefined;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "imploid-home-"));
  process.env.HOME = tempHome;
});

afterEach(async () => {
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  process.env.HOME = originalHome;
});

describe("buildProcessorPrompt", () => {
  test("loads bundled default prompt when no override is provided", async () => {
    const prompt = await buildProcessorPrompt("claude", 15);
    expect(prompt).toContain("Issue 15");
    expect(prompt).toContain("Setup Phase");
  });

  test("uses processor-specific prompt path overrides from ~/.imploid/prompts", async () => {
    if (!tempHome) {
      throw new Error("tempHome not configured");
    }
    const promptDir = join(tempHome, ".imploid", "prompts");
    await mkdir(promptDir, { recursive: true });
    await writeFile(
      join(promptDir, "claude-experimental.md"),
      "Custom Claude workflow for issue ${issueNumber}"
    );

    const prompt = await buildProcessorPrompt("claude", 27, {
      promptPath: "claude-experimental",
    });

    expect(prompt).toBe("Custom Claude workflow for issue 27");
  });

  test("prefers ~/.imploid/prompts overrides over bundled defaults", async () => {
    if (!tempHome) {
      throw new Error("tempHome not configured");
    }
    const promptDir = join(tempHome, ".imploid", "prompts");
    await mkdir(promptDir, { recursive: true });
    await writeFile(
      join(promptDir, "codex-default.md"),
      "Overridden Codex instructions for issue ${issueNumber}"
    );

    const prompt = await buildProcessorPrompt("codex", 33);

    expect(prompt).toBe("Overridden Codex instructions for issue 33");
  });

  test("throws a descriptive error when the resolved prompt file is missing", async () => {
    await expect(
      buildProcessorPrompt("codex", 5, { promptPath: "missing-template" })
    ).rejects.toThrow(/missing-template\.md/);
  });
});
