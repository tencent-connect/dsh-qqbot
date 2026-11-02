import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import { RUNTIME_ERROR_HINTS, RuntimeState } from './state.ts';

/** Observe completed facade sends without retaining their arguments or results. */
function observeSend<Args extends unknown[], Result>(
  send: (...args: Args) => Promise<Result>,
  runtime: RuntimeState,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      const result = await send(...args);
      runtime.sent();
      return result;
    } catch (error) {
      runtime.sendFailed();
      throw error;
    }
  };
}

/**
 * Attach runtime observations to this gateway's SDK instance.
 *
 * Markdown delegates to send(), media helpers delegate to sendMedia(). Stream
 * completion is observed separately because update() may only queue a frame.
 */
export function observeBotRuntime(bot: QQBot, runtime: RuntimeState): void {
  bot.use(async (_ctx, next) => {
    runtime.received();
    await next();
  });
  bot.on('ready', () => { runtime.setPhase('ready'); });
  bot.on('resumed', () => { runtime.setPhase('ready'); });
  bot.on('error', () => {
    runtime.setPhase(runtime.snapshot().phase, RUNTIME_ERROR_HINTS.connection);
  });

  bot.send = observeSend(bot.send.bind(bot), runtime);
  bot.sendText = observeSend(bot.sendText.bind(bot), runtime);
  bot.sendTextWithKeyboard = observeSend(bot.sendTextWithKeyboard.bind(bot), runtime);
  bot.sendMedia = observeSend(bot.sendMedia.bind(bot), runtime);
  bot.sendChannelMessage = observeSend(bot.sendChannelMessage.bind(bot), runtime);
  bot.sendDmMessage = observeSend(bot.sendDmMessage.bind(bot), runtime);

  const openStream = bot.openStream.bind(bot);
  bot.openStream = (options) => {
    const stream = openStream(options);
    const complete = stream.complete.bind(stream);
    stream.complete = async () => {
      try {
        const result = await complete();
        if (result !== undefined) runtime.sent();
        return result;
      } catch (error) {
        runtime.sendFailed();
        throw error;
      }
    };
    return stream;
  };
}
