import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadPromptTemplate, buildIssuePrompt } from "../src/lib/processors/prompt";

describe("Prompt loading", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "prompt-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("loadPromptTemplate", () => {
    test("loads default template from source directory", async () => {
      const template = await loadPromptTemplate("claude");
      expect(template).toContain("# GitHub Issue Workflow for Issue ${issueNumber}");
      expect(template).toContain("## Role & Goal");
      expect(template).toContain("## Setup Phase");
      expect(template).toContain("## Analysis Phase");
      expect(template).toContain("## Implementation Phase");
    });

    test("loads user override from ~/.imploid/prompts/", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customContent = "# Custom Claude Prompt for Issue ${issueNumber}\n\nThis is a custom prompt.";
      writeFileSync(join(userPromptsDir, "claude-default.md"), customContent, "utf8");

      const template = await loadPromptTemplate("claude");
      expect(template).toBe(customContent);
    });

    test("loads custom prompt by path", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customContent = "# Experimental Claude Prompt for Issue ${issueNumber}\n\nExperimental prompt.";
      writeFileSync(join(userPromptsDir, "claude-experimental.md"), customContent, "utf8");

      const template = await loadPromptTemplate("claude", "claude-experimental");
      expect(template).toBe(customContent);
    });

    test("throws error when custom prompt not found", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });

      await expect(loadPromptTemplate("claude", "nonexistent")).rejects.toThrow(
        /Failed to load custom prompt/
      );
    });

    test("loads source default when user default not found", async () => {
      const template = await loadPromptTemplate("claude");
      expect(template).toContain("# GitHub Issue Workflow for Issue ${issueNumber}");
    });

    test("user default takes precedence over source default", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const userContent = "# User Override for Issue ${issueNumber}";
      writeFileSync(join(userPromptsDir, "claude-default.md"), userContent, "utf8");

      const template = await loadPromptTemplate("claude");
      expect(template).toBe(userContent);
      expect(template).not.toContain("## Role & Goal");
    });

    test("loads codex template", async () => {
      const template = await loadPromptTemplate("codex");
      expect(template).toContain("# GitHub Issue Workflow for Issue ${issueNumber}");
    });
  });

  describe("buildIssuePrompt", () => {
    test("substitutes issue number in template", async () => {
      const prompt = await buildIssuePrompt(42, "claude");
      expect(prompt).toContain("# GitHub Issue Workflow for Issue 42");
      expect(prompt).not.toContain("${issueNumber}");
    });

    test("substitutes multiple occurrences of issue number", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customContent =
        "Issue ${issueNumber} details: gh issue view ${issueNumber}\nProcessing issue ${issueNumber}";
      writeFileSync(join(userPromptsDir, "claude-default.md"), customContent, "utf8");

      const prompt = await buildIssuePrompt(123, "claude");
      expect(prompt).toBe("Issue 123 details: gh issue view 123\nProcessing issue 123");
      expect(prompt).not.toContain("${issueNumber}");
    });

    test("works with custom prompt path", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });
      const customContent = "Custom prompt for issue ${issueNumber}";
      writeFileSync(join(userPromptsDir, "my-custom.md"), customContent, "utf8");

      const prompt = await buildIssuePrompt(999, "claude", "my-custom");
      expect(prompt).toBe("Custom prompt for issue 999");
    });

    test("handles issue number conversion to string", async () => {
      const prompt = await buildIssuePrompt(1, "claude");
      expect(prompt).toContain("Issue 1");
    });
  });

  describe("Error handling", () => {
    test("throws error when processor has no default template", async () => {
      await expect(loadPromptTemplate("nonexistent-processor")).rejects.toThrow(
        /Failed to load default prompt/
      );
    });

    test("provides clear error message for missing custom prompt", async () => {
      const userPromptsDir = join(tempDir, ".imploid", "prompts");
      mkdirSync(userPromptsDir, { recursive: true });

      try {
        await loadPromptTemplate("claude", "missing-file");
        throw new Error("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("Failed to load custom prompt");
        expect((error as Error).message).toContain("missing-file.md");
      }
    });
  });
});