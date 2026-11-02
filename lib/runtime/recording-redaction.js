/** Recording never keeps configured credentials or common credential arguments. */
export function redactRecordingText(text, secrets = []) {
    let result = text;
    for (const secret of secrets)
        if (secret)
            result = result.split(secret).join('[已隐藏凭据]');
    return result
        .replace(/(\bBearer\s+)\S+/gi, '$1[已隐藏凭据]')
        .replace(/((?:app[_-]?secret|access[_-]?token|api[_-]?key|password|authorization|client[_-]?secret)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1[已隐藏凭据]')
        .replace(/(\/\/(?:[^\s/:]+):)[^\s@/]+@/g, '$1[已隐藏凭据]@')
        .replace(/^(\/(?:token|secret|password|auth|login|key)\b)\s+.+$/i, '$1 [已隐藏凭据]');
}
//# sourceMappingURL=recording-redaction.js.map