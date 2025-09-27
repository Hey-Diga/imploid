export interface GitHubIssue {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
  [key: string]: unknown;
}

export class GitHubClient {
  private readonly token: string;
  private readonly defaultRepo?: string;

  constructor(token: string, repo?: string) {
    this.token = token;
    this.defaultRepo = repo;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "imploid",
    };
  }

  private buildRepoUrl(repo?: string): string {
    const target = repo ?? this.defaultRepo;
    if (!target) {
      throw new Error("No repository specified");
    }
    return `https://api.github.com/repos/${target}`;
  }

  async getReadyIssues(repo?: string): Promise<GitHubIssue[]> {
    const baseUrl = this.buildRepoUrl(repo);
    const url = new URL(`${baseUrl}/issues`);
    url.searchParams.set("labels", "agent-ready");
    url.searchParams.set("state", "open");

    const response = await fetch(url, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const issues = (await response.json()) as GitHubIssue[];
    const repoName = repo ?? this.defaultRepo;
    if (repoName) {
      for (const issue of issues) {
        (issue as any).repo_name = repoName;
      }
    }
    return issues;
  }

  async updateIssueLabels(
    issueNumber: number,
    options: { add?: string[]; remove?: string[] } = {},
    repo?: string
  ): Promise<void> {
    const baseUrl = this.buildRepoUrl(repo);
    const issueUrl = `${baseUrl}/issues/${issueNumber}`;

    const issueResp = await fetch(issueUrl, { headers: this.headers });
    if (!issueResp.ok) {
      throw new Error(`Failed to fetch issue: ${issueResp.status}`);
    }
    const issue = (await issueResp.json()) as GitHubIssue;
    const currentLabels = new Set(issue.labels.map((label) => label.name));

    for (const label of options.remove ?? []) {
      currentLabels.delete(label);
    }
    for (const label of options.add ?? []) {
      currentLabels.add(label);
    }

    const updateResp = await fetch(`${issueUrl}/labels`, {
      method: "PUT",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(Array.from(currentLabels)),
    });

    if (!updateResp.ok) {
      throw new Error(`Failed to update labels: ${updateResp.status}`);
    }
  }

  async createComment(issueNumber: number, body: string, repo?: string): Promise<void> {
    const baseUrl = this.buildRepoUrl(repo);
    const url = `${baseUrl}/issues/${issueNumber}/comments`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create comment: ${response.status}`);
    }
  }
}
