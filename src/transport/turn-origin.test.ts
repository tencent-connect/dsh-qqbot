import { describe, expect, it } from 'vitest';
import {
  classifyTurnInput,
  createTurnState,
  deliveryMode,
  noteTurnInput,
} from './turn-origin.ts';

describe('classifyTurnInput', () => {
  it('QQ 登记过的 user 消息是被动回复，普通 user 消息是外部输入', () => {
    expect(classifyTurnInput({ kind: 'user' }, true)).toBe('qq');
    expect(classifyTurnInput({ kind: 'user' }, false)).toBe('external');
  });

  it('宿主注入和 notice 不代表读者', () => {
    expect(classifyTurnInput({ kind: 'user-question-reply' }, false)).toBe('internal');
    expect(classifyTurnInput({ kind: 'runtime-context' }, false)).toBe('internal');
    expect(classifyTurnInput({ kind: 'time-context' }, false)).toBe('internal');
    expect(classifyTurnInput({ kind: 'schedule' }, false)).toBe('internal');
    expect(classifyTurnInput({ kind: 'user', form: 'notice' }, true)).toBe('internal');
    expect(classifyTurnInput(undefined, false)).toBe('internal');
  });
});

describe('回合归属', () => {
  it('先注入再收到 QQ 消息，整轮仍是被动回复', () => {
    const state = createTurnState(1);
    noteTurnInput(state, classifyTurnInput({ kind: 'runtime-context' }, false));
    noteTurnInput(state, classifyTurnInput({ kind: 'user' }, true));
    noteTurnInput(state, classifyTurnInput({ kind: 'time-context' }, false));
    expect(deliveryMode(state)).toBe('passive');
  });

  it('QQ 消息之后的注入不改判', () => {
    const state = createTurnState(1);
    noteTurnInput(state, classifyTurnInput({ kind: 'user' }, true));
    noteTurnInput(state, classifyTurnInput({ kind: 'schedule' }, false));
    expect(deliveryMode(state)).toBe('passive');
  });

  it('只有服务消息的回合主动推送', () => {
    const state = createTurnState(2);
    noteTurnInput(state, classifyTurnInput({ kind: 'schedule' }, false));
    expect(deliveryMode(state)).toBe('proactive');
  });

  it('桌面输入主动推送，随后的 QQ 消息改判为被动', () => {
    const state = createTurnState(3);
    noteTurnInput(state, classifyTurnInput({ kind: 'user' }, false));
    expect(deliveryMode(state)).toBe('proactive');
    noteTurnInput(state, classifyTurnInput({ kind: 'user' }, true));
    expect(deliveryMode(state)).toBe('passive');
  });
});
