#!/usr/bin/env node
/**
 * Verify prompt injection with the real Harness Cordis/SystemPrompt services.
 *
 * Build first, then run:
 *   node scripts/verify-prompt-runtime.mjs "C:/path/to/prompt.md"
 *
 * --sdk-root selects another package root containing node_modules; the outer
 * app.asar path is also accepted for Desktop's bundled dsh/node_modules layout.
 * An SDK kept inside app.asar must be run with Electron's Node launcher, which
 * understands ASAR paths. The agents are deliberately inert: this script never loads the
 * QQ gateway, opens a connection, calls a model, or writes profile preferences.
 * Only check results, file metadata, and SHA-256 hashes are printed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECTION = 'qqbot:scope-prompt';

class VerificationError extends Error {}

function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveSdk(requestedRoot) {
  // Desktop bundles its SDK under app.asar/dsh, separate from the shell's
  // app.asar/node_modules. Accept either level without loading shell code.
  for (const root of [requestedRoot, join(requestedRoot, 'dsh')]) {
    const require = createRequire(pathToFileURL(join(root, 'package.json')));
    try {
      return {
        root,
        require,
        cordis: require.resolve('@deepseek-ai/cordis'),
        systemPrompt: require.resolve('@deepseek-ai/dsh-system-prompt'),
      };
    } catch {
      // Try the packaged Desktop layout before reporting a useful error.
    }
  }
  throw new VerificationError('Cannot locate Cordis/SystemPrompt under --sdk-root; ASAR SDKs require Electron in Node mode and use app.asar/dsh');
}

async function packageVersion(requireFromSdk, name) {
  try {
    const path = requireFromSdk.resolve(`${name}/package.json`);
    return JSON.parse(await readFile(path, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function promptSection(assembly, expectedText, label) {
  const sections = assembly.sections.filter((section) => section.name === SECTION);
  check(sections.length === 1, `${label}: expected exactly one QQ prompt section`);
  check(sections[0].text === expectedText, `${label}: prompt text differs from the complete source`);
  return sections[0];
}

function sameAssembly(actual, expected, label) {
  // Compare in memory only; a failed assertion must never print prompt text.
  check(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ordinary host assembly changed`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      'sdk-root': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('Usage: node scripts/verify-prompt-runtime.mjs <prompt-file> [--sdk-root <package-root>]');
    return;
  }
  check(positionals.length === 1, 'Provide exactly one local prompt file path; use --help for usage');

  const promptPath = resolve(positionals[0]);
  const bytes = await readFile(promptPath);
  // Match a UTF-8 text file, stripping an optional encoding BOM only.
  const fileText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  check(fileText.length > 0, 'The prompt file must not be empty');

  const sdk = resolveSdk(resolve(values['sdk-root'] ?? repositoryRoot));
  const sdkRoot = sdk.root;
  const requireFromSdk = sdk.require;
  const [{ Context }, promptSdk, { SessionManager }] = await Promise.all([
    import(pathToFileURL(sdk.cordis).href),
    import(pathToFileURL(sdk.systemPrompt).href),
    import(pathToFileURL(join(repositoryRoot, 'dist/session/session-manager.js')).href),
  ]);
  const SystemPrompt = promptSdk.SystemPrompt ?? promptSdk.default;
  check(typeof Context === 'function' && typeof SystemPrompt === 'function', 'The selected Harness SDK does not expose the required services');

  const ctx = new Context();
  let manager;
  let disposedAgents = 0;
  let createdAgents = 0;
  const agents = new Map();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const directText = `Direct text verification ${randomUUID()}`;
  const groupText = `Group text verification ${randomUUID()}`;
  const staleText = `Inactive text verification ${randomUUID()}`;
  const config = {
    appId: `prompt-runtime-check-${randomUUID()}`,
    appSecret: '',
    provider: 'verification-only',
    model: 'verification-only',
    groupPromptMode: 'file',
    groupPromptFile: promptPath,
    groupPrompt: staleText,
    directPromptMode: 'text',
    directPromptFile: '',
    directPrompt: directText,
    sessionIdleTimeout: 0,
    debug: false,
  };

  const registry = {
    get: (id) => agents.get(id),
    // Force the real SessionManager's create path without touching persistence.
    async resume() { throw new VerificationError('No persisted agents exist in this verification'); },
    async create(options) {
      createdAgents++;
      const agent = {
        id: `verification-agent-${createdAgents}`,
        ctx: ctx.extend(),
        status: 'idle',
        session: { id: options.sessionId, events: [] },
        options: options.agentOptions ?? {},
        cancel() {},
        followup() { throw new VerificationError('Model execution is forbidden in this verification'); },
        async whenIdle() {},
        async runMaintenance() { throw new VerificationError('Maintenance is unnecessary in this verification'); },
      };
      if (options.setup) await options.setup(agent.ctx);
      agents.set(options.sessionId, agent);
      return {
        agent,
        async dispose() {
          if (agents.delete(options.sessionId)) disposedAgents++;
        },
      };
    },
  };

  try {
    await ctx.plugin(SystemPrompt, {});
    check(typeof ctx.systemPrompt?.assemble === 'function', 'The real SystemPrompt service did not start');
    const hostAgent = { id: 'ordinary-host-agent', ctx: ctx.extend() };
    const hostContext = { agent: hostAgent, scope: hostAgent.ctx };
    const hostBefore = await ctx.systemPrompt.assemble(hostContext);
    const noAgentBefore = await ctx.systemPrompt.assemble();

    manager = new SessionManager(ctx, registry, config, logger);
    const group = await manager.getOrCreate('group', 'verification-group', 'verification-sender', {
      scope: 'group', targetId: 'verification-group',
    });
    const direct = await manager.getOrCreate('c2c', 'verification-direct', 'verification-direct', {
      scope: 'c2c', targetId: 'verification-direct',
    });
    const assemble = (record) => ctx.systemPrompt.assemble({ agent: record.agent, scope: record.agent.ctx });

    const groupAssembly = await assemble(group);
    promptSection(groupAssembly, fileText, 'Group file mode');
    const directAssembly = await assemble(direct);
    promptSection(directAssembly, directText, 'Private text mode');
    check(promptSdk.renderPrompt(groupAssembly).includes(fileText), 'Group file mode: model-facing prompt does not contain the complete file');
    check(!promptSdk.renderPrompt(directAssembly).includes(fileText), 'Group file content leaked into private chat');
    promptSection(await assemble(group), fileText, 'Repeated group assembly');
    sameAssembly(await ctx.systemPrompt.assemble(hostContext), hostBefore, 'Host agent after group file mode');
    sameAssembly(await ctx.systemPrompt.assemble(), noAgentBefore, 'Unscoped assembly after group file mode');

    // Exercise the opposite scope using the same live SessionManager records.
    config.groupPromptMode = 'text';
    config.groupPrompt = groupText;
    config.directPromptMode = 'file';
    config.directPromptFile = promptPath;
    config.directPrompt = staleText;
    const privateFileAssembly = await assemble(direct);
    promptSection(privateFileAssembly, fileText, 'Private file mode');
    const groupTextAssembly = await assemble(group);
    promptSection(groupTextAssembly, groupText, 'Group text mode');
    check(promptSdk.renderPrompt(privateFileAssembly).includes(fileText), 'Private file mode: model-facing prompt does not contain the complete file');
    check(!promptSdk.renderPrompt(groupTextAssembly).includes(fileText), 'Private file content leaked into group chat');
    sameAssembly(await ctx.systemPrompt.assemble(hostContext), hostBefore, 'Host agent after private file mode');
    sameAssembly(await ctx.systemPrompt.assemble(), noAgentBefore, 'Unscoped assembly after private file mode');
    check(createdAgents === 2 && manager.size === 2, 'Expected exactly two inert verification agents');

    await manager.disposeAll();
    check(disposedAgents === 2 && manager.size === 0 && agents.size === 0, 'Verification agents were not completely disposed');
    console.log(JSON.stringify({
      status: 'PASS',
      sdkRoot,
      sdk: {
        cordis: await packageVersion(requireFromSdk, '@deepseek-ai/cordis'),
        systemPrompt: await packageVersion(requireFromSdk, '@deepseek-ai/dsh-system-prompt'),
      },
      file: { path: promptPath, bytes: bytes.length, characters: fileText.length, sha256: sha256(fileText) },
      checks: [
        'group file mode injects the complete file once',
        'private file mode injects the complete file once',
        'inactive text is ignored in file mode',
        'group and private prompts remain isolated',
        'rendered model-facing prompts contain the complete file',
        'ordinary host agents and unscoped assembly are unchanged',
        'all verification agents are disposed',
      ],
      qqConnections: 0,
      modelCalls: 0,
    }, null, 2));
  } finally {
    try {
      await manager?.disposeAll();
    } finally {
      // Cordis releases may expose disposal on the context or its root fiber.
      if (typeof ctx.dispose === 'function') await ctx.dispose();
      else await ctx.fiber.dispose();
    }
  }
}

main().catch((error) => {
  // SDK error messages can contain snippets of prompt text. Keep failures
  // useful without allowing those snippets or assertion diffs into output.
  const message = error instanceof VerificationError
    ? error.message
    : `Harness runtime verification could not finish (${error?.code ?? error?.name ?? 'unknown error'})`;
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});
