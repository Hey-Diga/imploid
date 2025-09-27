interface TelegramPayload {
  chat_id: string;
  text: string;
  parse_mode?: string;
}

export class TelegramNotifier {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  private async sendMessageBody(body: TelegramPayload): Promise<void> {
    const maxLength = 4000;
    if (body.text.length > maxLength) {
      body.text = `${body.text.slice(0, maxLength)}\n... (truncated)`;
    }

    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`Failed to send Telegram message: ${response.status}`);
    }
  }

  async sendMessage(message: string, parseMode: string = "Markdown"): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    await this.sendMessageBody({
      chat_id: this.chatId,
      text: message,
      parse_mode: parseMode,
    });
  }

  async notifyStart(issueNumber: number, title: string): Promise<void> {
    await this.sendMessage(`🚀 *Started issue #${issueNumber}*: ${title}`);
  }

  async notifyComplete(issueNumber: number, duration: string): Promise<void> {
    await this.sendMessage(`✅ *Completed issue #${issueNumber}* [${duration}]`);
  }

  async notifyNeedsInput(issueNumber: number, output: string): Promise<void> {
    const snippet = output.slice(-1000);
    await this.sendMessage(`⏳ *Issue #${issueNumber} needs input*:\n\`\`\`\n${snippet}\n\`\`\``);
  }

  async notifyError(issueNumber: number, error: string, output?: string): Promise<void> {
    let message = `❌ *Error on issue #${issueNumber}*:\n${error}`;
    if (output) {
      const snippet = output.slice(-500);
      message += `\n\nLast output:\n\`\`\`\n${snippet}\n\`\`\``;
    }
    await this.sendMessage(message);
  }
}
