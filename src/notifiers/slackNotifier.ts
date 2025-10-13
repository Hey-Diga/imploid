import { formatCompletionMessage } from "./templates";

interface SlackMessage {
  text?: string;
  blocks?: unknown[];
}

export class SlackNotifier {
  private readonly clientToken: string;
  private readonly channelId: string;

  constructor(botToken: string, channelId: string) {
    this.clientToken = botToken;
    this.channelId = channelId;
  }

  private async sendMessage(payload: SlackMessage): Promise<void> {
    if (!this.clientToken || !this.channelId) return;

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${this.clientToken}`,
      },
      body: JSON.stringify({ channel: this.channelId, ...payload }),
    });

    if (!response.ok) {
      console.error(`Failed to send Slack message: ${response.status}`);
    } else {
      const data = await response.json();
      if (!data.ok) {
        console.error(`Slack API error: ${data.error}`);
      }
    }
  }

  async notifyStart(issueNumber: number, title: string, repoName?: string): Promise<void> {
    const repoText = repoName ? ` in ${repoName}` : "";
    const issueUrl = repoName ? `https://github.com/${repoName}/issues/${issueNumber}` : `#${issueNumber}`;
    const issueLink = repoName ? `<${issueUrl}|#${issueNumber}>` : `#${issueNumber}`;

    await this.sendMessage({
      text: `Started issue #${issueNumber}: ${title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rocket: *Started processing issue ${issueLink}${repoText}*\n${title}`,
          },
        },
      ],
    });
  }

  async notifyComplete(
    issueNumber: number,
    duration: string,
    processorName: string,
    repoName?: string
  ): Promise<void> {
    const message = formatCompletionMessage(issueNumber, duration, processorName, repoName);
    await this.sendMessage({
      text: message,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: message,
          },
        },
      ],
    });
  }

  async notifyNeedsInput(issueNumber: number, output: string, repoName?: string): Promise<void> {
    const repoText = repoName ? ` in ${repoName}` : "";
    const issueUrl = repoName ? `https://github.com/${repoName}/issues/${issueNumber}` : `#${issueNumber}`;
    const issueLink = repoName ? `<${issueUrl}|#${issueNumber}>` : `#${issueNumber}`;
    const snippet = output.length > 500 ? output.slice(-500) : output;

    await this.sendMessage({
      text: `Issue #${issueNumber} needs input`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:hourglass: *Issue ${issueLink}${repoText} needs input*`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${snippet}\`\`\``,
          },
        },
      ],
    });
  }

  async notifyError(issueNumber: number, error: string, output?: string, repoName?: string): Promise<void> {
    const repoText = repoName ? ` in ${repoName}` : "";
    const issueUrl = repoName ? `https://github.com/${repoName}/issues/${issueNumber}` : `#${issueNumber}`;
    const issueLink = repoName ? `<${issueUrl}|#${issueNumber}>` : `#${issueNumber}`;
    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:x: *Error on issue ${issueLink}${repoText}*\n${error}`,
        },
      },
    ];

    if (output) {
      const snippet = output.length > 300 ? output.slice(-300) : output;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Last output:*\n\`\`\`${snippet}\`\`\``,
        },
      });
    }

    await this.sendMessage({
      text: `Error on issue #${issueNumber}: ${error}`,
      blocks,
    });
  }
}
