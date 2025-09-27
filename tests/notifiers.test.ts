import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { SlackNotifier } from "../src/notifiers/slackNotifier";
import { TelegramNotifier } from "../src/notifiers/telegramNotifier";

describe("Notifiers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("SlackNotifier formats start message with repo link", async () => {
    const notifier = new SlackNotifier("xoxb-token", "C123");

    await notifier.notifyStart(42, "Ship feature", "owner/repo");

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://slack.com/api/chat.postMessage");
    const payload = JSON.parse(call[1].body as string);
    expect(payload.channel).toBe("C123");
    expect(payload.text).toContain("Started issue #42");
    expect(JSON.stringify(payload.blocks)).toContain("owner/repo");
  });

  test("SlackNotifier truncates long output when notifying needs input", async () => {
    const notifier = new SlackNotifier("xoxb-token", "C123");
    const body = "A".repeat(650);

    await notifier.notifyNeedsInput(5, body, "owner/repo");

    const payload = JSON.parse((global.fetch as any).mock.calls.pop()[1].body as string);
    const snippetBlock = payload.blocks[payload.blocks.length - 1];
    expect(JSON.stringify(snippetBlock)).toContain("A".repeat(500));
    expect(JSON.stringify(snippetBlock)).not.toContain("A".repeat(501));
  });

  test("TelegramNotifier truncates long messages", async () => {
    const notifier = new TelegramNotifier("bot-token", "chat-id");
    const longMessage = "B".repeat(4500);

    await notifier.notifyError(9, longMessage, "final output");

    const call = (global.fetch as any).mock.calls.pop();
    expect(call[0]).toMatch(/api.telegram.org/);
    const payload = JSON.parse(call[1].body as string);
    expect(payload.chat_id).toBe("chat-id");
    expect(payload.text.length).toBeLessThanOrEqual(4020);
    expect(payload.text).toContain("... (truncated)");
  });

  test("TelegramNotifier includes last output for shorter errors", async () => {
    const notifier = new TelegramNotifier("bot-token", "chat-id");

    await notifier.notifyError(10, "Minor failure", "final output");

    const payload = JSON.parse((global.fetch as any).mock.calls.pop()[1].body as string);
    expect(payload.text).toContain("Last output:");
    expect(payload.text).toContain("```\nfinal output\n```");
  });
});
