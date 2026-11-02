import { describe, expect, it } from 'vitest';
import { ApiError } from '@tencent-connect/qqbot-nodejs';
import { deliveryFailure } from './delivery-error.ts';

describe('QQ send result evidence', () => {
  it('retains the actual permission rejection and codes', () => {
    const result = deliveryFailure(new ApiError('unsafe path', 400, '/v2/groups/private/messages', 40034105, '主动消息失败, 无权限'));
    expect(result.state).toBe('failed');
    expect(result.error).toContain('HTTP 400');
    expect(result.error).toContain('40034105');
    expect(result.error).toContain('主动消息失败, 无权限');
    expect(result.error).not.toContain('/v2/groups');
  });
  it.each([0, 200, 204, 302, 408, 500, 502, 503])('keeps uncertain HTTP %s results unknown even if a business code exists', status => {
    expect(deliveryFailure(new ApiError('response unavailable', status, '/messages', 123, 'response unavailable')).state).toBe('unknown');
  });
  it.each([400, 401, 403, 404, 429])('classifies HTTP %s as an explicit rejection', status => {
    expect(deliveryFailure(new ApiError('rejected', status, '/messages')).state).toBe('failed');
  });
  it('does not infer HTTP rejection from an ordinary token or network Error', () => {
    expect(deliveryFailure(new Error('HTTP 400 while obtaining token')).state).toBe('unknown');
  });
  it('redacts credential and source fields and bounds the saved message', () => {
    const message = 'token=secret-value appSecret="secret-two" "client_secret":"secret-three" msg_id=private-id https://example.com/?token=secret-four\n' + 'x'.repeat(3000);
    const result = deliveryFailure(new ApiError('ignored', 400, '/private', 1, message));
    for (const value of ['secret-value', 'secret-two', 'secret-three', 'private-id', 'secret-four', '\n']) expect(result.error).not.toContain(value);
    expect(result.error.length).toBeLessThan(500);
  });
});
