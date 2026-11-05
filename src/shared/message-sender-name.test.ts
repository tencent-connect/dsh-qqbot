import { describe, expect, it } from 'vitest';
import { messageSenderName } from './message-sender-name.ts';

const raw = { id: 'message', content: 'pair code', timestamp: '2026-11-04T00:00:00Z', author: { user_openid: 'sender' } };

describe('QQ message sender name', () => {
  it('prefers a nonempty normalized name', () => {
    expect(messageSenderName({ senderName: ' Normalized ', raw: { ...raw, author: { ...raw.author, username: 'Raw' } } })).toBe('Normalized');
  });
  it.each([undefined, '', '   '])('reads a raw username when the SDK name is empty (%s)', senderName => {
    expect(messageSenderName({ senderName, raw: { ...raw, author: { ...raw.author, username: ' Raw Nickname ' } } })).toBe('Raw Nickname');
  });
  it('accepts a supplied raw nickname when username is missing or invalid', () => {
    expect(messageSenderName({ raw: { ...raw, author: { ...raw.author, username: 42, nickname: ' Nickname ' } } })).toBe('Nickname');
  });
  it('does not interpret an ID or malformed name as a nickname', () => {
    expect(messageSenderName({ raw })).toBeUndefined();
    expect(messageSenderName({ raw: { ...raw, author: { ...raw.author, username: {}, nickname: [] } } })).toBeUndefined();
  });
});
