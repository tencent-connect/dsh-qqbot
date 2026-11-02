import { payloadHash } from "./qq-operations.js";
function suppressed(reason) { return { kind: 'suppressed', reason }; }
function trustedContext(message) {
    const kind = message.source.kind;
    return kind === 'runtime-context' || kind === 'skill-catalog' || kind === 'time-context';
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function textJSON(message) {
    if (message.content.length !== 1)
        return undefined;
    const block = message.content[0];
    if (block?.type !== 'text')
        return undefined;
    try {
        return JSON.parse(block.text);
    }
    catch {
        return undefined;
    }
}
function hasReceipt(receipts, operation, turn, callId, answer) {
    return receipts.some(receipt => receipt.sessionId === operation.sessionId && receipt.turn === turn
        && receipt.callId === callId && receipt.actor.length > 0 && receipt.nonce.length > 0
        && receipt.answerHash === payloadHash(answer));
}
function lateAnswer(message) {
    const source = message.source;
    const sourceKind = source.kind;
    if (sourceKind !== 'user-question-reply' || !('callId' in source) || typeof source.callId !== 'string'
        || !('outcome' in source) || source.outcome !== 'answered')
        return undefined;
    const data = textJSON(message);
    if (!object(data) || data.kind !== 'answer_to_pending_question' || data.tool !== 'ask_user_question'
        || data.callId !== source.callId || !Array.isArray(data.answers) || !Array.isArray(data.questions))
        return undefined;
    return { callId: source.callId, answer: { answers: data.answers } };
}
function foldTurn(events, turn, operations, receipts) {
    if (!Number.isSafeInteger(turn) || turn < 1)
        return suppressed('invalid-turn');
    const inbox = { 'next-turn': [], 'next-step': [] };
    const byMessage = new Map();
    for (const operation of operations) {
        if (byMessage.has(operation.message.id) || operation.payloadHash !== payloadHash(operation.message))
            return suppressed('ambiguous-operation');
        byMessage.set(operation.message.id, operation);
    }
    const revoked = new Set();
    const inserted = new Set();
    const claims = [];
    const humanInputs = [];
    const questionCalls = new Map();
    const questionResults = [];
    let openTurn;
    let seenTurn = false;
    let previousTurn = 0;
    let openStep;
    let latestStep = 0;
    let end;
    let final;
    let finalStepEnded = false;
    let expectedSeq = 0;
    for (const event of events) {
        if (event.seq !== expectedSeq++)
            return suppressed('incomplete-log');
        switch (event.type) {
            case 'turn/start':
                if (openTurn !== undefined || event.data.turn <= previousTurn)
                    return suppressed('invalid-turn-boundary');
                openTurn = event.data.turn;
                previousTurn = event.data.turn;
                if (openTurn === turn)
                    seenTurn = true;
                break;
            case 'agent/inbox/spliced': {
                const { target, start, inserted: messages, outcome } = event.data;
                const removedCount = event.data.removedCount ?? 0;
                const pending = inbox[target];
                if (!Number.isSafeInteger(start) || start < 0 || start > pending.length || !Number.isSafeInteger(removedCount)
                    || removedCount < 0 || start + removedCount > pending.length)
                    return suppressed('invalid-inbox-history');
                const removed = pending.splice(start, removedCount, ...messages);
                const pendingIds = [...inbox['next-turn'], ...inbox['next-step']].map(message => message.id);
                if (new Set(pendingIds).size !== pendingIds.length)
                    return suppressed('duplicate-pending-input');
                for (const message of messages) {
                    const operation = byMessage.get(message.id);
                    if (operation) {
                        if (target !== 'next-turn' || inserted.has(message.id) || payloadHash(message) !== operation.payloadHash)
                            revoked.add(message.id);
                        inserted.add(message.id);
                    }
                }
                if (removedCount === 0)
                    break;
                if (outcome === 'canceled') {
                    for (const message of removed)
                        revoked.add(message.id);
                    break;
                }
                if (openTurn === undefined || start !== 0 || messages.length > 0
                    || (target === 'next-turn' && removedCount !== 1))
                    return suppressed('invalid-inbox-claim');
                if (openTurn === turn)
                    for (const message of removed)
                        claims.push({ message, target, seq: event.seq, entered: false });
                break;
            }
            case 'step/start':
                if (event.data.turn !== openTurn || openStep !== undefined)
                    return suppressed('invalid-step-boundary');
                if (openTurn === turn) {
                    if (event.data.step !== latestStep + 1)
                        return suppressed('invalid-step-boundary');
                    latestStep = event.data.step;
                }
                openStep = event.data.step;
                break;
            case 'step/end':
                if (event.data.turn !== openTurn || event.data.step !== openStep)
                    return suppressed('invalid-step-boundary');
                if (openTurn === turn && final?.data.step === event.data.step)
                    finalStepEnded = true;
                openStep = undefined;
                break;
            case 'user/message':
                if (openTurn === turn) {
                    if (openStep === undefined)
                        return suppressed('input-outside-step');
                    if (trustedContext(event.data) && revoked.has(event.data.id))
                        return suppressed('context-input-modified');
                    if (event.surfaceOp !== 'append') {
                        const range = event.surfaceOp;
                        if (humanInputs.some(input => input.seq >= range.startSeq && input.seq <= range.endSeq))
                            return suppressed('input-history-rewritten');
                    }
                    if (!trustedContext(event.data)) {
                        const claim = claims.find(item => !item.entered && item.message.id === event.data.id && payloadHash(item.message) === payloadHash(event.data));
                        if (!claim)
                            return suppressed('unclaimed-input');
                        claim.entered = true;
                        if (humanInputs.some(input => input.message.id === event.data.id))
                            return suppressed('repeated-input');
                        humanInputs.push({ message: event.data, seq: event.seq });
                    }
                }
                break;
            case 'assistant/message':
                if (openTurn === turn) {
                    if (event.data.turn !== turn || event.data.step !== openStep || event.surfaceOp !== 'append')
                        return suppressed('invalid-assistant-boundary');
                    final = event;
                    finalStepEnded = false;
                }
                break;
            case 'tool/call':
                if (event.data.name === 'ask_user_question') {
                    if (questionCalls.has(event.data.callId))
                        return suppressed('duplicate-question-call');
                    questionCalls.set(event.data.callId, event.data.turn);
                }
                break;
            case 'tool/result':
                if (openTurn === turn && questionCalls.has(event.data.message.toolCallId)) {
                    if (event.data.turn !== turn || questionCalls.get(event.data.message.toolCallId) !== turn || event.data.message.isError)
                        return suppressed('unverified-question-result');
                    if (questionResults.some(result => result.callId === event.data.message.toolCallId))
                        return suppressed('duplicate-question-result');
                    questionResults.push({ callId: event.data.message.toolCallId, value: textJSON(event.data.message) });
                }
                break;
            case 'turn/end':
                if (event.data.turn !== openTurn || openStep !== undefined)
                    return suppressed('invalid-turn-boundary');
                openTurn = undefined;
                if (event.data.turn === turn)
                    end = event;
                break;
            default:
                break;
        }
        if (end)
            break;
    }
    if (!seenTurn)
        return suppressed('missing-turn');
    const qqClaims = claims.filter(claim => byMessage.has(claim.message.id));
    const only = qqClaims[0];
    if (qqClaims.length !== 1 || !only)
        return suppressed('not-one-qq-opening');
    const operation = byMessage.get(only.message.id);
    if (!operation || only.target !== 'next-turn' || revoked.has(only.message.id)
        || !inserted.has(only.message.id) || payloadHash(only.message) !== operation.payloadHash)
        return suppressed('qq-input-modified');
    const primary = humanInputs.find(input => input.message.id === operation.message.id);
    for (const claim of claims) {
        if (claim.message.id === operation.message.id || (trustedContext(claim.message) && !revoked.has(claim.message.id)))
            continue;
        const answer = lateAnswer(claim.message);
        if (!answer || !questionCalls.has(answer.callId) || questionCalls.get(answer.callId) !== turn
            || !hasReceipt(receipts, operation, turn, answer.callId, answer.answer))
            return suppressed('mixed-input');
    }
    for (const input of humanInputs) {
        if (input.message.id === operation.message.id)
            continue;
        const answer = lateAnswer(input.message);
        if (!answer || !hasReceipt(receipts, operation, turn, answer.callId, answer.answer))
            return suppressed('unverified-human-input');
    }
    for (const result of questionResults) {
        if (!object(result.value))
            return suppressed('unverified-question-result');
        if (result.value.pending === true && result.value.callId === result.callId && result.value.answers === undefined)
            continue;
        if (!Array.isArray(result.value.answers)
            || !hasReceipt(receipts, operation, turn, result.callId, { answers: result.value.answers }))
            return suppressed('unverified-human-answer');
    }
    if (end && claims.some(claim => !trustedContext(claim.message) && !claim.entered))
        return suppressed('claimed-input-not-admitted');
    if (end && [...questionCalls].some(([callId, calledTurn]) => calledTurn === turn && !questionResults.some(result => result.callId === callId)))
        return suppressed('missing-question-result');
    if (end && final?.data.step !== latestStep)
        return suppressed('missing-final-answer');
    return { kind: 'evidence', evidence: { operation, inputSeq: primary?.seq ?? only.seq, admitted: primary !== undefined, end, final, finalStepEnded } };
}
/** Eligibility for live hooks. Durable claim evidence never grants final delivery on its own. */
export function classifyTurnInputs(events, turn, operations, receipts) {
    const folded = foldTurn(events, turn, operations, receipts);
    if (folded.kind === 'suppressed')
        return folded;
    return { kind: 'qq', operationId: folded.evidence.operation.operationId, inputSeq: folded.evidence.inputSeq };
}
/** Only a completed, unmixed native turn can authorize one final QQ response. */
export function classifyTurn(events, turn, operations, receipts) {
    const folded = foldTurn(events, turn, operations, receipts);
    if (folded.kind === 'suppressed')
        return folded;
    const { operation, inputSeq, admitted, end, final, finalStepEnded } = folded.evidence;
    if (!end || end.data.reason.kind !== 'completed')
        return suppressed('turn-not-completed');
    if (!admitted || !final || !finalStepEnded || final.data.interrupted
        || final.data.message.content.some(block => block.type === 'tool-call'))
        return suppressed('missing-final-answer');
    const text = final.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (!text.trim())
        return suppressed('empty-final-answer');
    return { kind: 'qq', operationId: operation.operationId, finalMessageId: final.data.message.id, text, inputSeq };
}
//# sourceMappingURL=qq-turn.js.map