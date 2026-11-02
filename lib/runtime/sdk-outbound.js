import { sanitizedDeliveryError } from "./delivery-error.js";
/** Track facade sends, including SDK middleware replies, once across delegation. */
export function trackSdkOutbound(bot, service) {
    function track(send, describe) {
        return async (...args) => {
            const { target, text } = describe(...args);
            try {
                if (target.scope !== 'group' && target.scope !== 'c2c')
                    return await send(...args);
                const scope = target.scope;
                if (!service.store.get(service.store.key(scope, target.targetId)))
                    return await send(...args);
                return await service.trackAutomatic({ ...target, scope }, text, () => send(...args), 'sdk');
            }
            catch (error) {
                throw sanitizedDeliveryError(error, [service.config.appSecret]);
            }
        };
    }
    bot.send = track(bot.send.bind(bot), options => ({ target: options.target, text: options.content ?? options.markdown?.content ?? '[QQ 卡片或媒体]' }));
    bot.sendText = track(bot.sendText.bind(bot), (target, text) => ({ target, text }));
    bot.sendTextWithKeyboard = track(bot.sendTextWithKeyboard.bind(bot), (target, text) => ({ target, text }));
    bot.sendMarkdown = track(bot.sendMarkdown.bind(bot), (target, text) => ({ target, text }));
    bot.sendMedia = track(bot.sendMedia.bind(bot), options => ({ target: options.target, text: '[QQ 媒体]' }));
}
//# sourceMappingURL=sdk-outbound.js.map