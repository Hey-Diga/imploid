import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { GitHubClient } from "../src/lib/githubClient";

describe("GitHubClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("fetches ready issues with correct parameters", async () => {
    (global.fetch as any).mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      expect(url.pathname).toBe("/repos/owner/repo/issues");
      expect(url.searchParams.get("labels")).toBe("ready-for-claude");
      expect(url.searchParams.get("state")).toBe("open");
      expect(init?.headers).toMatchObject({ Authorization: "token ghp_test" });

      return new Response(JSON.stringify([{ number: 7, title: "Example", labels: [] }]), {
        status: 200,
      });
    });

    const client = new GitHubClient("ghp_test", "owner/repo");
    const issues = await client.getReadyIssues();
    expect(issues).toHaveLength(1);
    expect((issues[0] as any).repo_name).toBe("owner/repo");
  });

  test("updates issue labels by merging existing ones", async () => {
    const responses = [
      new Response(JSON.stringify({ labels: [{ name: "ready-for-claude" }] }), { status: 200 }),
      new Response(null, { status: 200 }),
    ];

    (global.fetch as any).mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/issues/123")) {
        expect(init?.method ?? "GET").toBe("GET");
        return responses.shift()!;
      }
      if (url.pathname.endsWith("/issues/123/labels")) {
        expect(init?.method).toBe("PUT");
        expect(init?.body).toBe(JSON.stringify(["ready-for-claude", "claude-working"]));
        return responses.shift()!;
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const client = new GitHubClient("ghp_test", "owner/repo");
    await client.updateIssueLabels(123, { add: ["claude-working"] });
    expect((global.fetch as any).mock.calls.length).toBe(2);
  });

  test("throws when GitHub returns error for ready issues", async () => {
    (global.fetch as any).mockImplementation(async () => new Response("", { status: 500 }));

    const client = new GitHubClient("ghp_test", "owner/repo");
    await expect(client.getReadyIssues()).rejects.toThrow("GitHub API error: 500");
  });

  test("adds repo_name to issues when override is provided", async () => {
    (global.fetch as any).mockImplementation(async () =>
      new Response(JSON.stringify([{ number: 1, title: "Example", labels: [] }]), { status: 200 })
    );

    const client = new GitHubClient("ghp_test");
    const issues = await client.getReadyIssues("owner/another");
    expect((issues[0] as any).repo_name).toBe("owner/another");
  });

  test("propagates errors when fetching issue before updating labels", async () => {
    (global.fetch as any).mockImplementation(async (input: RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/issues/456")) {
        return new Response("", { status: 404 });
      }
      throw new Error("Unexpected call");
    });

    const client = new GitHubClient("ghp_test", "owner/repo");
    await expect(client.updateIssueLabels(456, { add: ["claude-working"] })).rejects.toThrow(
      "Failed to fetch issue: 404"
    );
  });

  test("throws when creating a comment fails", async () => {
    (global.fetch as any).mockImplementation(async () => new Response("", { status: 403 }));

    const client = new GitHubClient("ghp_test", "owner/repo");
    await expect(client.createComment(12, "hello")).rejects.toThrow("Failed to create comment: 403");
  });
});
