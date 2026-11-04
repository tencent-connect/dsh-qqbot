function nonBlankName(value) {
    if (typeof value !== 'string')
        return undefined;
    return value.trim().slice(0, 300) || undefined;
}
/** Some SDK message branches keep optional author names only in the raw event. */
export function messageSenderName(message) {
    const normalized = nonBlankName(message.senderName);
    if (normalized)
        return normalized;
    const author = message.raw.author;
    return ('username' in author ? nonBlankName(author.username) : undefined)
        || ('nickname' in author ? nonBlankName(author.nickname) : undefined);
}
//# sourceMappingURL=message-sender-name.js.map