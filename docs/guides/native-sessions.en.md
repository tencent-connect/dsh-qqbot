# QQ Sessions in native DSH chat

This development build uses public extension APIs from unmodified DSH. QQ Sessions use an independent left sidebar, the main conversation view and native composer. No Host patch or shared-memory backend is required.

## Navigation and workspace

Each group has one current Session. Private chats are separate per contact. The QQ entry switches the left sidebar to independent group and private-chat sections. The peer row represents its current native Session; clicking the name opens it without an extra current-Session child. An arrow appears when history exists and expands the latest five historical Sessions, with more available on demand. Search matches peers, aliases and Session titles. Browsing an unapproved entry does not create an Agent or start a model.

QQ mode stays active when opening the native conversation. Return to workspaces, native New Session or another global panel restores the ordinary sidebar. Directory refresh never navigates. The peer summary shows its current Session title and short workspace name, omitting a redundant default title. History shows each Session's own title and workspace; full paths remain in tooltips. Only the current peer or the selected historical row is highlighted. The peer menu separates current-Session actions from QQ settings. Historical rename actions target that Session; its workspace action explicitly creates a new current Session. Workspaces do not group the QQ tree. Session titles and peer aliases remain separate.

The current stock Host has no public channel filter for its ordinary Session tree. QQ Sessions still use native storage and may also appear there outside QQ mode. This build retains that limitation without fake archive/subagent state or CSS hiding.

The main view keeps native model, reasoning, permission and input controls. The QQ conversation settings view beside Trajectory contains settings and message records; history lives under each peer in the sidebar. Historical Sessions retain the Host’s native behavior. Opening or editing history does not make it the QQ current Session.

Changing the QQ workspace or Agent preset creates a new current Session and retains history. Existing Session working directories and Agent composition are not replaced in place. Model changes preserve context and do not change Host defaults.

## Input and delivery

QQ requests use native `followup` and the same Agent Inbox as Web input. The plugin serializes QQ preparation and delivery without replacing the native input service.

Web input replies only on the Web. It remains part of this Session’s later shared context. Use a separate ordinary Session for private analysis.

Automatic QQ delivery requires a durable original request, unchanged native Inbox provenance, one pure QQ opening, a completed durable final answer and current authorization. Edited input, edit then revert, Steer, mixed or uncertain human input suppresses automatic delivery. Eligible completed answers in the current QQ Session can be previewed and explicitly sent. Historical Sessions do not offer that action.

Only final answer text is automatically delivered. Streaming content, reasoning, tool activity and generated files stay in DSH. Legacy streaming, tool-result and file-send configuration fields do not enable these outbound paths.

Deliveries have stable operation IDs and per-part states. Each conversation sends serially and rechecks authorization. Results show the number of accepted parts. Failed or unknown attempts may already have accepted some parts; check QQ before another deliberate action. Acceptance does not prove delivery or reading. Terminal attempts are not replayed under the same operation ID, and restart does not replay past answers. Delivery records can be refreshed manually.

The send preview and delivery records show the passive reply deadline. Group messages have a five-minute window; browsing or querying records does not extend it. A manual operation selects a live source from the same conversation when its queue starts and checks expiry before later segments. Without a live source, the button explicitly offers an active-send attempt, subject to the bot's platform permissions.

An admitted, deduplicated ordinary message can supply a reply source without mentioning the bot only if QQ actually delivers that event. This does not trigger the Agent or change the independent recording setting. Explicit platform rejections show the HTTP status, QQ business code and reason; network timeouts and other unconfirmed outcomes remain unknown. Error codes lost from older records are not reconstructed by guessing.

## Group background and permissions

QQ inbound and outbound text is kept indefinitely, with no automatic cleanup. Use Clear message records in the peer's Message records view to remove recorded text manually; message IDs remain for deduplication. Recording is independent of model background selection, reply triggering and permissions. Passive messages do not start a model or become synthetic native user/message events. Actual requests, selected background, replies and tool activity use native Session persistence.

Each group chooses the background available to its Agent. Saving records does not grant tools; Agent queries also require `qqbot_group_history`, while Web record queries do not start a model. Recent background defaults to all three bounds of 10 messages, 10 minutes and 4,000 characters. Consumption advances only after confirmed admission. `/new` starts a new background boundary.

Account access and the peer switch control admission, the recording setting controls records, and the reply switch controls Agent triggering. The account mention rule initializes newly discovered groups, not existing groups. Unapproved or disabled peers retain discovery identity and previous history without saving new text. Disabling also restricts QQ sends and related tools. The bot can use only messages actually pushed by QQ; local configuration does not grant full group-message access.

Global defaults are copied when each new peer is first admitted. The peer editor contains reception, alias, Agent preset, model, native permission, extra prompt, working directory and slash commands. Message records are kept indefinitely and can be cleared manually.

Saved extra prompts and persona changes take effect when the prompt is assembled at each step. Group and private-chat extra prompts are configured separately, with an 80,000-character limit each. Only Agent preset and working directory changes require a new Session.

Native execution uses the Agent's actual tools and approval policy. Custom tools restrict that set by stable tool identity. Existing resource and extra-approval limits require explicit confirmation before replacement. Read-only does not confine reads to the workspace. Child and outbound guards remain effective.

`/model` keeps context. `/preset` creates a new Session while idle. `/new`, `/reset` and `/clear` retain history. `/stop` stops work and keeps native queued input. Group administrators do not automatically become bot controllers.

## Rotation and migration

Sessions rotate at a safe idle boundary without native queued inputs after seven days or 1,000 QQ messages by default. Native history remains. This build does not physically delete it. Message records are kept indefinitely and can be cleared manually. Minimal operation IDs and terminal results remain to prevent replay. Native Session history is retained separately.

Binding, reliable Session associations, model preferences, group policies and former standalone analysis Sessions remain. Old group records use a read-only compatibility view. No native history is backfilled and no tasks are replayed. Older records are shown under their historical rules; new records are kept indefinitely and can be cleared manually. Background policies and tool grants remain unchanged.

Mem0, Qdrant, memory tools and automatic extraction are absent. Old memory configuration is ignored and obsolete tool grants are removed. Existing backend data and historical tool results are not deleted or rewritten.

Unbinding clears local credentials and reloads the plugin. It does not delete Session history or revoke QQ-side relationships. The SDK inbound timeout is not a limit on an entire native Agent turn.

Isolate `QQBOT_DATA_DIR`, DSH Home, profile and working directories for each test instance. Offline event tests do not prove QQ platform permissions or live delivery.

The unified timeline shows incoming contact or group messages on the left and bot delivery attempts on the right. Web-only answers appear only after an explicit send. Commands and SDK replies use the same ledger. Failed or unknown sends retain their errors and part results; interface acceptance is not delivery or read confirmation. The message-records page has no second composer.
