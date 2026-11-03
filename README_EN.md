<div align="center">

Existing users should read the [upgrade guide](./docs/guides/upgrading-from-0.5.5.md) before switching. Runtime requirements, QQ outbound behavior and body retention have changed. Migrated legacy conversations do not silently enable message recording or automatic Session rotation.

<img width="120" src="https://img.shields.io/badge/🤖-QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**A QQ Bot plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), connecting DeepSeek AI assistants to QQ private and group chats.**

[![npm version](https://img.shields.io/npm/v/@tencent-connect/dsh-qqbot)](https://www.npmjs.com/package/@tencent-connect/dsh-qqbot)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/tencent-connect/dsh-qqbot)](https://github.com/tencent-connect/dsh-qqbot)
[![QQ Bot](https://img.shields.io/badge/QQ_Bot-API_v2-red)](https://bot.q.qq.com/wiki/)

<br/>

**[简体中文](./README.md) | English**

Scan to join the QQ group / channel

<table>
<tr>
<td align="center" width="50%"><img src="./assets/docs/qqgroup.jpg" height="360" alt="QQ Group QR Code" /><br /><b>QQ Developer Group</b><br /><sub>Group 1: 1032635674 · Group 2: 1056948758</sub></td>
<td align="center" width="50%"><img src="./assets/docs/qqchannel.jpg" height="360" alt="QQ Channel QR Code" /><br /><b>QQ Developer Channel</b><br /><sub>Channel ID: 20dnumts4z</sub></td>
</tr>
</table>

</div>

## Summary

dsh-qqbot is a DeepSeek Harness (dsh) **bundle plugin** that connects a dsh agent to QQ private chats and groups. On install it inserts one plugin row into a chosen profile and reuses the native Session, Inbox, workspace and client extension interfaces without patching the host. You can bind bot credentials by QR-code login from the web UI or phone; @-mention the bot in QQ to get native agent answers (model, tools, permissions, approvals); manage conversations, history and per-conversation settings from a dedicated left rail grouped by groups/DMs; and view message records with Markdown and image/video/file previews. Main costs: the QQ passive-reply window is short (5 min for groups), a send only confirms platform acceptance rather than delivery, and QQ only receives the final text, not a stream.

## Table of Contents

- [Architecture](#architecture)
- [Installation](#installation)
- [Conversations and per-group settings](#conversations-and-per-group-settings)
- [Configuration](#configuration)
- [Built-in Commands](#built-in-commands)
- [Core Modules](#core-modules)
- [Session Routing](#session-routing)
- [Design Principles](#design-principles)
- [Known Limitations](#known-limitations)
- [Dev Note](#dev-note)
- [Local Development](#local-development)

## Architecture

> This development build uses public APIs from unmodified DSH. QQ has independent group/private navigation in the left sidebar and uses the native main conversation view and composer. See the [usage and migration guide](./docs/guides/native-sessions.en.md) for supported behavior and limitations. This build is not published.

```
QQ User → QQ WebSocket → dsh-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## Installation

Methods 1 and 2 install the published prebuilt npm package and do not require a Host source checkout. The native Session development build described here is not published. To use this checkout, complete [Local Development](#local-development), then load it with Method 3 or 4.

### Method 1: Desktop install (recommended)

No command line needed — everything happens inside the app:

1. **Install**: click "Plugins" in the left sidebar → "Add plugin" → enter `@tencent-connect/dsh-qqbot@latest` → install and start now

<img src="./assets/docs/install.png" alt="In-app plugin install" width="560" />

2. **Connect**: avatar at the bottom-left → Settings → "QQ Bots" → scan the QR code with mobile QQ

<img src="./assets/docs/setting.png" alt="Settings QR binding" width="560" />

Credentials are saved automatically after the scan; later launches need no re-scan.

Open QQ Bots for a dedicated sidebar grouped by group chats and private chats. Search names, local aliases, or Session titles. The sidebar shows the actual gateway status; saved credentials do not imply a connected gateway. The conversation directory survives restarts.

Open Settings to manage the account, access rules and defaults for new peers. Change credentials and Unbind remain visible. New-peer defaults contain the Agent preset, native execution permission, model, extra prompt and working directory. Changes apply only to peers admitted afterward.

Each peer keeps its reception switch, QQ alias, extra prompt and tool scope. Use the native composer for the current model and reasoning effort, and the new-Session entry for the Agent preset and workspace. The composer uses one permission menu for native modes and a fourth option, Custom tools. Selecting Custom tools keeps the current native permission as its base; edit the tool list in QQ conversation settings. Saved extra prompts apply to subsequent prompt assembly, with an 80,000-character limit for group and private prompts each. The phone `/preset` command still starts a new Session and preserves history and workspace. An unavailable preset leaves the existing Session unchanged and reports the reason.

Unsaved settings drafts stay in the current browser tab and never include AppSecret. The UI follows DSH's light and dark themes. Native chat keeps its composer, model and reasoning-effort controls; account and peer settings use the plugin extension interfaces. The native selectors have been verified with DSH `0.2.2-alpha.2`; older client seed tables and directory APIs are untested.

For multiple instances or isolated testing, set `QQBOT_DATA_DIR` to a separate absolute path for each instance. It isolates the conversation directory, policies, message records, delivery results, model/preset preferences, and media. Without this setting, the existing `~/.dsh-qqbot` data location remains in use.

### Method 2: Manual

```bash
# Add to a profile
npx @deepseek-ai/dsh plugin --profile qqbot add @tencent-connect/dsh-qqbot

# Start
npx @deepseek-ai/dsh --profile qqbot
```

On first launch, the plugin detects missing credentials and automatically starts the QR flow: a QR code is printed in the terminal → scan it with the QQ mobile app → credentials are saved to the profile, so subsequent launches require no re-scan.

In environments without the in-app binding page (pure CLI), set `QQBOT_BIND_OPEN_BROWSER=1` to additionally open a browser QR page as a fallback.

<img src="./assets/docs/qrcode.png" alt="QR code scan example" width="280" />

> **Note**: Upgrade to `0.4.0` or later for browser-link scanning, which avoids QR code misalignment in some terminals.

### Method 3: Local path

Complete the source build in [Local Development](#local-development), then add it to a profile:

```bash
# Add to a profile (local path)
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/dsh-qqbot

# Start
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

### Method 4: --patch dev mode

Complete Host preparation and the plugin build in [Local Development](#local-development) first. See the [testing guide](./TESTING.md#隔离-host) for isolated debugging.

```bash
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## Conversations and per-group settings

Each QQ group shares one current native Session; private chats stay separate for each contact. The QQ entry switches the left sidebar to independent group and private sections. The peer row opens the current chat; expansion shows the latest five historical Sessions, with more on demand. Each Session shows its own title and workspace. Return to workspaces restores the ordinary tree. Native Session titles and QQ aliases remain separate. `/new` preserves old Sessions. QQ Sessions may also appear in the ordinary workspace tree because the current Host has no public channel-filter API.

Web and QQ share the current Session and native Inbox. Web input replies only on the Web and participates in later shared context. Automatic QQ delivery requires a completed, unchanged, pure QQ turn proven by the native log. Web Steer, edited queue input, mixed or uncertain provenance suppress automatic delivery. Eligible completed answers in the current QQ Session can be previewed and explicitly sent; historical Sessions do not offer that action. Results show accepted parts, which do not prove delivery or reading. Failed or unknown attempts are not replayed automatically. Use a separate ordinary Session for private analysis. Previous standalone analysis Sessions remain available.


### Independent settings for each group or contact

QQ conversation settings contain reception, QQ alias, execution permission, custom tools, extra prompts and the recording switch. Use the native composer for model and reasoning effort, and the new-Session entry for preset and workspace. QQ message records are retained by default and can be cleared manually. Historical Sessions appear under their peer in the left sidebar. See [defaults and message records](./docs/guides/settings-and-message-records.md).

The composer's single permission menu contains native modes and a fourth option, Custom tools, and shares the current DSH Session's permission state. Selecting Custom tools keeps the current native permission as its base. Search and edit the tool list in QQ conversation settings; effective access is the intersection of the Agent's actual tools, native permission and QQ tool selection. Selecting a tool does not add it to the Agent. Editing an alias or prompt does not reset the current model, preset, workspace or native permission. Imported advanced authorization constraints remain until QQ settings are saved again; saving rebuilds the policy from this version's native permission and tool mode. See the upgrade guide for the differences. Read-only does not confine all reads to the working directory.

Web administration uses DSH authentication. The global superadmin list controls all QQ slash commands. Add members by pairing code, rename them, or remove them from this list. Superadmins remain subject to each peer's tool and resource limits. QQ group administration does not confer superadmin access. Native DSH Web commands do not use QQ identity checks; approval and question buttons retain their own permission rules.

### Recording and model background

Recording, background selection and automatic replies are independent. Enabled QQ records continue across Sessions with no automatic count or age limit by default; existing explicitly configured retention periods still apply. Delivery-state updates neither count as new messages nor move an old message to the front. Upstream historyLimit defaults to 10 and controls the separate in-memory group-context buffer, not persistent message retention. Migrated legacy peers whose recording is off stay off.

Clear message records removes QQ bodies while keeping message identities, body hashes, delivery state and operation-idempotency metadata to prevent replay. Native DSH Session history remains independent: QQ cleanup does not delete its questions, background or answers, or change Agent tool permissions.

Recent background defaults to all three limits of 10 messages, 10 minutes and 4,000 characters. History queries require an explicit `qqbot_group_history` grant. Unapproved and disabled peers retain discovery identity without saving new text. Only events actually pushed by QQ can be recorded.

The native conversation keeps its composer, model and permission controls. The QQ settings view contains configuration and the unified message timeline. Historical Sessions appear only in each peer subtree. Creating the next Session chooses the preset and workspace together, creates only one Session and keeps earlier history. QQ record retention does not delete native Session history.

## Configuration

| Config | Type | Default | Description |
|------|------|--------|------|
| `appId` | string | **required** | QQ Bot AppID (or via `QQBOT_APPID` env var) |
| `appSecret` | string | **required** | QQ Bot AppSecret (or via `QQBOT_SECRET` env var) |
| `provider` | string | Inherit DSH default | LLM provider name, specified together with model |
| `model` | string | Inherit DSH default | Model name |
| `preset` | string | Inherit DSH default | Agent preset id for new Sessions |
| `cwd` | string | `QQBOT_DATA_DIR/workspace` | Agent working directory; `~/.dsh-qqbot/workspace` when no data directory is specified |
| `requireMention` | boolean | `true` | Initial mention rule for newly discovered groups; edit existing groups separately |
| `groupPrompt` | string | - | Extra system prompt for group chats |
| `directPrompt` | string | - | Extra system prompt for direct chats |
| `textChunkLimit` | number | `4500` | Max chars per message |
| `streaming` | boolean | Legacy compatibility | QQ sends final text only; streaming stays in DSH |
| `sessionIdleTimeout` | number | `1800000` | Idle execution-instance eviction (ms); Session history remains |
| `processingTimeoutMs` | number | `1800000` | SDK inbound-processing timeout (ms), not an entire native Agent turn limit |
| `maxQueue` | number | `20` | Max concurrent queue length |
| `historyLimit` | number | `10` | Group history buffer size |
| `askTimeoutMs` | number | `300000` | Question timeout (ms), default 5 min (ask_user_question) |
| `showToolResults` | boolean | Legacy compatibility | Tool activity stays in DSH |
| `debug` | boolean | `false` | Debug mode |

### Access control (access)

| Config | Type | Default | Description |
|------|------|--------|------|
| `access.c2cMode` | `open`/`allowlist`/`disabled` | `open` | Direct-chat access mode; an empty allowlist denies everyone |
| `access.c2cAllow` | string[] | `[]` | Direct-chat allowlist (user openid) |
| `access.groupMode` | `open`/`allowlist`/`disabled` | `open` | Group access mode |
| `access.groupAllow` | string[] | `[]` | Group allowlist (group openid) |

### Rich media (media)

| Config | Type | Default | Description |
|------|------|--------|------|
| `media.enabled` | boolean | `true` | Enable rich media understanding (image/video download + tool analysis) |
| `media.maxMB` | number | `200` | Max download size (MB) |
| `media.ttlHours` | number | `24` | Media lifetime (hours), 0 = never expire |

### Vision (vision)

| Config | Type | Default | Description |
|------|------|--------|------|
| `vision.enabled` | boolean | `false` | Enable vision (qqbot_describe_image tool) |
| `vision.provider` | string | - | Vision model provider (e.g. pi-ai) |
| `vision.model` | string | - | Vision model id (e.g. qwen-vl-max) |
| `vision.maxBytes` | number | `10MB` | Max image bytes |
| `vision.maxTokens` | number | `1024` | Max output tokens |
| `vision.timeoutMs` | number | `120000` | Vision call timeout (ms) |

### Legacy file sending settings (sendFile)

This build does not register an Agent file-send tool or automatically deliver generated files. These fields remain only for configuration compatibility.

| Config | Type | Default | Description |
|------|------|--------|------|
| `sendFile.restrictPaths` | boolean | `true` | Enable path allowlist (media + cwd + extraRoots only) |
| `sendFile.extraRoots` | string[] | `[]` | Extra allowed root directories |

## Built-in Commands

All QQ slash commands require a global superadmin, including help, queries and stop commands. The Web command list and QQ help both come from the server command registry.

| Command | Description |
|------|------|
| `/new` (aliases `/reset` `/clear`) | Start a new session while keeping the phone's model/preset overrides |
| `/compact` | Compact session history (replace old records with a summary) |
| `/model` | View the current model and Web default; `/model provider/model` switches this private/group chat while retaining history; `/model reset` or `/model default` clears its override |
| `/preset` | View current/default presets; `/preset id` or `/preset reset` changes the choice and starts a new Session, retaining old history and workspace |
| `/permission` | View current and allowed permission modes; `/permission read-only` or `/permission workspace-write` selects an authorized mode |
| `/stop` | Abort the current generation |
| `/bot-ping` | Network latency test (transport & processing time) |
| `/bot-version` | View version info |
| `/bot-me` | Show your OpenID and, in a group, its OpenID; does not create an Agent task |
| `/bot-status` | View current session status |
| `/bot-help` | View all commands |

Model and next-session preset priority is **phone command override → QQ Web default → current DSH default**. Commands do not change the Web default or another chat. Saving Web configuration reloads the bot and retains saved chat overrides. `/model` uses DSH's native model selection and keeps the Session ID, history, and current preset; switching preset starts a new current Session and retains the old history and workspace. Validation or switching failures preserve the original Session and configuration.

Superadmins use `@bot /command` in groups or send `/command` directly in private chats. Commands remain subject to the current peer's access rules and allowed choices. Every command from a non-superadmin is denied. Other changes report busy during generation. Unknown commands from a superadmin return help rather than becoming model instructions.

<details>
<summary>Implementation detail (core modules, session routing, design principles)</summary>

## Core Modules

```
src/
├── index.ts                    # Cordis plugin entry (async apply)
├── config.ts                   # Config schema
├── types.ts                    # Global types
├── setup.ts                    # Credential binding (QR)
├── gateway/                    # Gateway assembly
│   ├── bootstrap.ts            # Startup wiring (session/event listeners, etc.)
│   └── middleware-setup.ts     # Middleware chain config
├── transport/                  # Transport layer
│   ├── inbound.ts              # QQ inbound message → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # Streaming buffer
│   ├── streaming-writer.ts     # Streaming writer
│   ├── reply-target.ts         # Reply target resolution
│   ├── msgid-cache.ts          # Passive reply msgid cache
│   ├── reply-limiter.ts        # Passive reply rate limiter
│   ├── tool-presenter.ts       # Tool-call presentation
│   └── chunker.ts              # Markdown chunking
├── session/                    # Session management
│   ├── session-manager.ts      # QQ peer → Agent mapping
│   └── idle-evictor.ts         # Idle eviction
├── model/                      # Model routing
│   ├── model-resolver.ts       # Route resolution
│   ├── prefs-store.ts          # Per-peer preference persistence
│   └── settings-reader.ts      # settings.yaml read-only
├── conversations/              # Directory, background, archive, and delivery results
├── policy/                     # Per-group tool and resource checks
├── features/                   # Interaction features
│   ├── question-channel.ts     # ask_user_question Q&A channel
│   ├── approval-channel.ts     # approval confirmation channel
│   └── answer-parser.ts        # Answer parsing
├── media/                      # Media
│   ├── vision-tool.ts          # Image vision understanding
│   ├── send-file-tool.ts       # Send local files
│   └── media-cleaner.ts        # Media TTL cleanup
├── middleware/                 # Middleware
│   ├── question-answer.ts      # Q&A answer handling
│   └── attachment.ts           # Attachment handling
├── shared/                     # Shared utilities
│   ├── utils.ts                # Common helpers
│   ├── scope.ts                # scope/peer extraction
│   └── send-helper.ts          # Chunked send
└── commands/                   # Slash commands
```

## Session Routing

sessionKey: `qqbot:${appId}:${scope}:${peerId}`; a UUID session id is minted for new sessions and persisted to `model-prefs.json`, resuming by the persisted id after restarts; pre-0.6 sessions keep their originally derived ids.

Resolution strategy: in-process reuse → persisted resume → fresh create.

## Design Principles

- **Pure Cordis plugin** — follows the dsh "Plugins, not loop changes" principle
- **Declarative dependencies** — `inject = ['agents']`, no direct coupling to other plugins
- **Session isolation** — one independent Agent per QQ direct user / group
- **Preset support** — mount presets (toolkits, prompts, etc.) via the `agent-presets` service
- **Idle eviction** — auto-dispose Agents on timeout to prevent memory leaks
- **Markdown output** — replies sent as Markdown with code-block/table-aware chunking
- **Image understanding** — supports `qqbot_describe_image` vision to analyze images sent by users
- **Explicit sending** — preview and send a Web answer to QQ; Agent file sending and automatic file delivery remain disabled
- **Question interaction** — supports `ask_user_question` with inline keyboard buttons (mutually exclusive) or numbered replies, one question at a time with timeout
- **Approval confirmation** — supports `approval/request` to ask for user confirmation on critical actions via allow/deny buttons

</details>

## Known Limitations

- **A send only confirms platform acceptance**: QQ returns an `accepted` state meaning the platform accepted it, not that the user received or read it; failed and unknown results are not auto-resent.
- **Short passive-reply window**: 5 minutes for groups, 30 minutes for DMs; each message has a passive-reply count limit (default 4, one reserved). After the window or limit, proactive sends may be rejected.
- **Final text only, no streaming**: QQ receives the turn's final answer text; streamed content stays in DSH. `streaming` is legacy-compat and ignored in this version.
- **No tool traces or files**: tool calls/results show only in DSH; no agent file-send tool is registered (`qqbot_send_file` is unavailable at runtime) and tool-generated files are not delivered. `showToolResults` and `sendFile.sendPresentedFiles` are legacy-compat and ignored.
- **Groups reply only on @ by default**: new groups have `requireMention=true`; non-@ group messages are at most background and never trigger a reply, and whether non-@ messages are even received depends on the QQ platform enabling full group-message events.
- **Session rotation ≠ record retention**: newly admitted peers default to native Session rotation after 7 days or 1,000 QQ messages at a safe boundary, keeping history. This branch adds Session rotation; it is not an upstream message-cleanup rule. QQ bodies have no automatic count or age limit by default. Existing explicit retention periods and manual clearing preserve deduplication metadata and native Session history.
- **Tool capability is host-bounded**: MCP/network tools cannot be domain-restricted; memory_*, subagent/delegation tools are unavailable; in native mode execution cannot exceed granted sandbox scope. If the current native permission is outside the allowed set, tools are restricted.
- **Media relies on local temp files**: downloads live in `QQBOT_DATA_DIR/media` (default `~/.dsh-qqbot/media`) and are pruned by `media.ttlHours` (default 24h); long-lived local paths can expire. Downloads are HTTPS-only with SSRF/size/timeout guards.
- **QQ sessions may appear duplicated in the workspace list**: the plugin reuses native sessions and the host has no public filter, so this limitation remains.
- **Access control is fail-closed**: DMs and groups default to `open`. An explicitly selected `allowlist` mode with an empty list denies everyone.
- **Some client copy is hard-coded Chinese**: the `qqbot` locale namespace covers only part of the strings; the rest is inline Chinese, not fully i18n'd.

## Dev Note

<details>

- Bundle-shaped plugin (`dsh.bundle.patch → cordis.patch.yml`): install inserts one plugin row into the profile layer and never patches host source; credentials/config go to the profile `cordis.patch.yml` and take effect via HMR.
- Loading source directly (`--patch cordis.dev.yml`) can't cross the `node_modules` boundary, so `getProfileDir()` is empty and credentials must come from env.
- To verify: whether `vision.timeoutMs` actually takes effect (`callVision` uses exec.signal); `ensureVisionInputModal` edits the host `settings.yaml` to add image input to the vision model; SSRF guard resolves IPv4 only and does not block IPv6. Design decisions and review records live in `docs/decisions/`.

</details>

## Local Development

The plugin supports Node.js `^22.19.0 || >=24.0.0` (Node 23 is unsupported). Current acceptance uses Node 24. A Host source build must also satisfy that checkout's own Node.js and pnpm requirements.

Source development requires a prepared, unmodified stock DSH Host. The accepted baseline is `0.2.2-alpha.2`, commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`. Use a separate source checkout; keep dependency installation and builds away from the Host you use daily. Install dependencies and generate public build artifacts in that Host checkout first (`pnpm install`, `pnpm run build:artifacts`). Plugin installation does not generate Host artifacts, and no Host patch is required.

In [package.json](./package.json), Host development dependencies use `link:../../deepseek-harness/...`. The default layout is:

```text
parent/
├── deepseek-harness/                 # Prepared stock Host
└── deepseek-harness-plugins/
    └── dsh-qqbot/                    # This plugin checkout
```

For another Host location, run the [link script](./scripts/link-stock-host.mjs) from the plugin root before installing plugin dependencies. It updates only this plugin's development dependency paths and does not modify the Host:

```bash
cd /path/to/dsh-qqbot

# Run first for a non-default Host location; skip for the default layout
node scripts/link-stock-host.mjs --host /absolute/stock/checkout

# Install plugin dependencies
pnpm install

# Build the plugin
pnpm build

# Dev mode (watch)
pnpm dev

# Debug via --patch
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

See the [testing guide](./TESTING.md) for the local QQ fixture, isolated Host checks, and coverage limits. Agents can use [qqbot-verify](./.agents/skills/qqbot-verify/SKILL.md).

## License

[MIT](./LICENSE)
