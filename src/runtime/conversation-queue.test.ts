import { describe, expect, it } from 'vitest';
import { ConversationQueue } from './conversation-queue.ts';

describe('shared QQ and Web queue', () => {
  it('keeps each conversation ordered while another conversation progresses', async () => {
    const queue = new ConversationQueue();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const events: string[] = [];
    const first = queue.run('group-a', async () => { events.push('qq'); await barrier; });
    const web = queue.run('group-a', async () => { events.push('web'); });
    await queue.run('group-b', async () => { events.push('other'); });
    expect(events).toEqual(['qq', 'other']);
    release();
    await Promise.all([first, web]);
    expect(events).toEqual(['qq', 'other', 'web']);
  });

  it('contains failure and rejects over-capacity without losing accepted tasks', async () => {
    const queue = new ConversationQueue();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = queue.run('a', async () => { await barrier; throw new Error('failed'); }, 1);
    await expect(queue.run('a', async () => {}, 1)).rejects.toThrow('过多');
    release();
    await expect(first).rejects.toThrow('failed');
    expect(await queue.run('a', async () => 42)).toBe(42);
  });
});
