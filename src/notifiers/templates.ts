export function formatCompletionMessage(
  issueNumber: number,
  duration: string,
  processorName: string,
  repoName?: string
): string {
  const repoText = repoName ? ` in ${repoName}` : "";
  return `✅ *Completed issue #${issueNumber}${repoText} with ${processorName}*\nDuration: \`${duration}\``;
}
