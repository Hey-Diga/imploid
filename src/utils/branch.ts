export function createIssueBranchName(
    issueNumber: number,
    processorName: string,
    timestamp: Date | string = new Date()
): string {
    const rawTimestamp = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    const fallbackTimestamp = new Date().toISOString();

    const sanitize = (value: string) => {
        const digits = value.replace(/\D/g, "");
        if (digits.length >= 14) {
            return digits.slice(0, 14);
        }
        const fallbackDigits = fallbackTimestamp.replace(/\D/g, "");
        return (digits + fallbackDigits).slice(0, 14);
    };

    const normalizedTimestamp = sanitize(rawTimestamp);
    return `issue-${issueNumber}-${processorName}-${normalizedTimestamp}`;
}
