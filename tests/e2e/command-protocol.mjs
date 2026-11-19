/** Fixed commands and synthetic peers keep the local fixture away from real QQ targets. */
import { faceText, formattedText, stickerText } from './timeline-media-fixture.mjs';

export const DUMMY_APP_ID = '0000000000';
export const DUMMY_SECRET = 'local-fixture-only';
export const DUMMY_TOKEN = 'local-fixture-token';
const backgroundMessages = {
  'background-remove-first': 'QQ_BACKGROUND_REMOVE_FIRST',
  'background-remove-second': 'QQ_BACKGROUND_REMOVE_SECOND',
  'background-remove-late': 'QQ_BACKGROUND_REMOVE_LATE',
  'background-steer-first': 'QQ_BACKGROUND_STEER_FIRST',
  'background-steer-second': 'QQ_BACKGROUND_STEER_SECOND',
  'background-steer-late': 'QQ_BACKGROUND_STEER_LATE',
  'timeline-rich-text': formattedText,
  'timeline-sticker': stickerText,
  'timeline-face': faceText,
};

function identifier(value, label) {
  if (typeof value !== 'string' || !value || /[\s"'<>]/u.test(value)) {
    throw new Error(`Invalid fixture ${label}`);
  }
  return value;
}

function modelPath(route, label) {
  if (route === null || typeof route !== 'object') throw new Error(`Missing fixture ${label} route`);
  const provider = identifier(route.provider, `${label} provider`);
  if (provider.includes('/')) throw new Error(`Invalid fixture ${label} provider`);
  return `${provider}/${identifier(route.model, `${label} model`)}`;
}

export function createFixtureCommands(config = {}) {
  const primary = config.primary ?? { provider: 'fixture', model: 'primary' };
  const secondary = config.secondary ?? { provider: 'fixture', model: 'secondary' };
  const primaryPath = modelPath(primary, 'primary');
  const secondaryPath = modelPath(secondary, 'secondary');
  const primaryPreset = identifier(config.presets?.primary ?? 'standard', 'primary preset');
  const secondaryPreset = identifier(config.presets?.secondary ?? 'minimal', 'secondary preset');
  return Object.freeze({
    help: '/bot-help', status: '/bot-status', model: '/model',
    effort: '/effort', 'effort-high': '/effort high', 'effort-default': '/effort default', 'effort-invalid': '/effort max',
    'model-primary': `/model ${primaryPath}`,
    'model-short': `/model ${primary.model}`,
    'model-secondary': `/model ${secondaryPath}`,
    preset: '/preset',
    'preset-standard': `/preset ${primaryPreset}`,
    'preset-minimal': `/preset ${secondaryPreset}`,
    'preset-reset': '/preset reset', 'preset-default': '/preset default',
    'preset-invalid': '/preset fixture-unavailable',
    new: '/new', reset: '/reset', clear: '/clear', stop: '/stop', compact: '/compact',
    ping: '/bot-ping', version: '/bot-version',
    smoke: '只回复 QQ_CMD_OK，不调用工具。',
    ...backgroundMessages,
  });
}

export function parseFixtureMessage(value = {}, commands = createFixtureCommands(), allowModelRequests = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fixture message');
  const allowedKeys = new Set(['scope', 'identity', 'groupIdentity', 'mention', 'command']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('Unsupported fixture message option');
  const { scope = 'group', identity = 'denied', command = 'help' } = value;
  if (!['c2c', 'group'].includes(scope)) throw new Error('Unsupported fixture scope');
  if (!['allowed', 'denied'].includes(identity)) throw new Error('Unsupported fixture identity');
  if (value.groupIdentity !== undefined && (scope !== 'group' || !['allowed', 'denied'].includes(value.groupIdentity))) {
    throw new Error('Invalid fixture group identity');
  }
  if (value.mention !== undefined && typeof value.mention !== 'boolean') throw new Error('Invalid fixture mention flag');
  if (typeof command !== 'string' || !Object.hasOwn(commands, command)) throw new Error('Unsupported fixture command');
  if (!allowModelRequests && (['smoke', 'compact'].includes(command) || Object.hasOwn(backgroundMessages, command))) {
    throw new Error('Fixture model requests are disabled');
  }
  return { scope, identity, groupIdentity: value.groupIdentity ?? identity, command,
    mention: value.mention !== false, content: commands[command] };
}

export function isFixtureOutboundPath(path) {
  return /^\/v2\/(?:users\/local-fixture-(?:allowed|denied|outbound)-user|groups\/local-fixture-(?:allowed|denied|outbound)-group)\/(?:messages|files)$/u.test(path);
}

export function outboundObservation(path, body, mode) {
  const content = typeof body?.content === 'string' ? body.content
    : typeof body?.markdown?.content === 'string' ? body.markdown.content : '';
  const redacted = content.replace(/([?&]token=)[^\s&"<>]+/giu, '$1[redacted]')
    .replace(/\bBearer\s+[^\s"<>]+/giu, 'Bearer [redacted]');
  return { path, mode, messageType: body?.msg_type ?? null, content: redacted.slice(0, 12_000), at: Date.now() };
}
