window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot-workbench-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/shared/workbench-timeline-protocol.ts
		const WORKBENCH_TIMELINE_PATH = "/api/qqbot/workbench/timeline";
		const WORKBENCH_SEND_PATH = "/api/qqbot/workbench/send";
		const QQ_MANUAL_MESSAGE_LIMIT = 2e3;
		function canQuoteTimelineEntry(row) {
			return row?.direction === "inbound" && row.status === "received" && typeof row.platformId === "string" && row.platformId.length > 0 && row.text !== "配对码已隐藏" && !/^\/[a-z]/i.test(row.text) && (!!row.text || !!row.attachments);
		}
		//#endregion
		//#region src/client/http.ts
		/** Same-origin JSON requests with bounded waiting and actionable HTTP errors. */
		var HttpError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		async function fetchJson(path, init = {}, timeoutMs = 1e4) {
			const controller = new AbortController();
			const callerSignal = init.signal;
			let timedOut = false;
			const onCancel = () => {
				controller.abort(callerSignal?.reason);
			};
			if (callerSignal?.aborted) onCancel();
			else callerSignal?.addEventListener("abort", onCancel, { once: true });
			const timer = setTimeout(() => {
				if (controller.signal.aborted) return;
				timedOut = true;
				controller.abort();
			}, timeoutMs);
			try {
				if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
				const response = await fetch(path, {
					...init,
					signal: controller.signal
				});
				if (!response.ok) {
					const body = await response.json().catch(() => null);
					throw new HttpError(response.status, body?.error ?? `请求失败（HTTP ${response.status}）`);
				}
				return await response.json();
			} catch (error) {
				if (controller.signal.aborted) {
					if (timedOut) throw new Error("请求超时，请重试");
					throw new DOMException("请求已取消", "AbortError");
				}
				throw error;
			} finally {
				clearTimeout(timer);
				callerSignal?.removeEventListener("abort", onCancel);
			}
		}
		//#endregion
		//#region src/client/workbench-composer.ts
		const drafts = /* @__PURE__ */ new Map();
		const activeOperations = /* @__PURE__ */ new Map();
		function rememberedOperation(key) {
			try {
				return activeOperations.get(key) ?? sessionStorage.getItem(key) ?? void 0;
			} catch {
				return activeOperations.get(key);
			}
		}
		function rememberOperation(key, id) {
			if (id) activeOperations.set(key, id);
			else activeOperations.delete(key);
			try {
				if (id) sessionStorage.setItem(key, id);
				else sessionStorage.removeItem(key);
			} catch {}
		}
		const QqComposer = (0, react.forwardRef)(function QqComposer({ appId, peer, robotName, disabledReason, onUpdate }, ref) {
			const target = {
				appId,
				scope: peer.scope,
				openId: peer.openId
			};
			const key = "qqbot-send:" + JSON.stringify([
				appId,
				peer.scope,
				peer.openId
			]);
			const [draft, setDraft] = (0, react.useState)(() => drafts.get(key) ?? { text: "" });
			const [operation, setOperation] = (0, react.useState)(() => rememberedOperation(key));
			const [status, setStatus] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [uncertain, setUncertain] = (0, react.useState)(false);
			const inFlight = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const input = (0, react.useRef)(null);
			const fileInput = (0, react.useRef)(null);
			const edit = (value) => {
				if (value.text || value.attachment || value.quote) {
					drafts.delete(key);
					drafts.set(key, value);
					if (drafts.size > 100) drafts.delete(drafts.keys().next().value);
				} else drafts.delete(key);
				setDraft(value);
			};
			const finish = (id, result) => {
				const current = rememberedOperation(key);
				if (current && current !== id) return;
				const done = result.status === "accepted" || result.status === "rejected";
				if (done && current === id) {
					rememberOperation(key);
					if (result.status === "accepted") drafts.delete(key);
				}
				if (!mounted.current) return;
				if (result.status === "accepted") setDraft({ text: "" });
				if (done) setOperation(void 0);
				setUncertain(result.status === "unknown");
				const codes = [result.httpStatus && `HTTP ${result.httpStatus}`, result.platformCode && `QQ ${result.platformCode}`].filter(Boolean).join(" · ");
				setStatus(result.status === "accepted" ? "QQ 接口已接受" : result.status === "rejected" ? `消息未发送${codes ? `（${codes}）` : ""}，请检查连接或权限后重试。` : result.status === "sending" ? "正在等待 QQ 回执…" : "发送结果未知，请先在 QQ 核对。");
				onUpdate();
			};
			const run = async (id, submit) => {
				if (inFlight.current) return;
				inFlight.current = true;
				setBusy(true);
				setStatus(submit !== void 0 ? "发送中…" : "正在查询发送结果…");
				try {
					const query = new URLSearchParams({
						...target,
						operation: id
					});
					let request = { cache: "no-store" };
					if (submit?.attachment) {
						const form = new FormData();
						query.forEach((value, key) => form.set(key, value));
						form.set("text", submit.text);
						form.set("attachment", submit.attachment);
						request = {
							method: "POST",
							body: form
						};
					} else if (submit) request = {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							...target,
							operation: id,
							text: submit.text,
							replyTo: submit.quote?.id
						})
					};
					const result = await fetchJson(submit === void 0 ? `${WORKBENCH_SEND_PATH}?${query}` : WORKBENCH_SEND_PATH, request, 24e3);
					finish(id, result);
				} catch (cause) {
					if (rememberedOperation(key) !== id) return;
					const declined = submit !== void 0 && cause instanceof HttpError && [
						400,
						401,
						403,
						404,
						409,
						413
					].includes(cause.status);
					if (declined) rememberOperation(key);
					if (mounted.current) {
						if (declined) setOperation(void 0);
						setUncertain(!declined);
						setStatus(declined ? cause.message : "暂未确认发送结果，请查询回执或先在 QQ 核对。");
					}
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			(0, react.useEffect)(() => {
				mounted.current = true;
				const id = rememberedOperation(key);
				if (id) run(id);
				return () => {
					mounted.current = false;
				};
			}, [key]);
			const send = () => {
				if (inFlight.current || disabledReason || !draft.text.trim() && !draft.attachment || operation || rememberedOperation(key)) return;
				const id = crypto.randomUUID();
				rememberOperation(key, id);
				setOperation(id);
				setUncertain(false);
				run(id, draft);
			};
			const onKeyDown = (event) => {
				if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
				event.preventDefault();
				send();
			};
			const editLocked = !!disabledReason || busy || !!operation;
			(0, react.useImperativeHandle)(ref, () => ({ replyTo(row, sender) {
				if (editLocked || inFlight.current || rememberedOperation(key)) return;
				if (draft.attachment) {
					setStatus("请先移除附件，再引用回复。");
					return;
				}
				edit({
					...draft,
					quote: {
						id: row.id,
						text: row.text.slice(0, 400),
						attachments: row.attachments,
						sender
					}
				});
				setStatus("");
				input.current?.focus();
			} }));
			return (0, react.createElement)("form", {
				className: "imqw-composer",
				onSubmit: (event) => {
					event.preventDefault();
					send();
				}
			}, (0, react.createElement)("input", {
				ref: fileInput,
				type: "file",
				hidden: true,
				"aria-label": "选择 QQ 附件",
				disabled: editLocked,
				onChange: (event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (!file || editLocked || draft.quote) return;
					if (!file.size || file.size > 4194304) {
						setStatus("请选择一个非空附件，最多 4 MiB。");
						return;
					}
					edit({
						...draft,
						attachment: file
					});
					setStatus("");
				}
			}), draft.attachment ? (0, react.createElement)("div", { className: "imqw-composer-attachment" }, (0, react.createElement)("span", { title: draft.attachment.name }, draft.attachment.name), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: editLocked,
				onClick: () => {
					edit({ text: draft.text });
					setStatus("");
				}
			}, "移除附件")) : null, draft.quote ? (0, react.createElement)("div", { className: "imqw-composer-attachment imqw-composer-quote" }, (0, react.createElement)("span", { title: draft.quote.text }, `回复 ${draft.quote.sender} · ${draft.quote.text || `附件 ${draft.quote.attachments} 项`}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: editLocked,
				onClick: () => {
					edit({ text: draft.text });
					setStatus("");
					input.current?.focus();
				}
			}, "取消引用")) : null, (0, react.createElement)("div", { className: "imqw-composer-input" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: editLocked || !!draft.quote,
				onClick: () => fileInput.current?.click(),
				title: draft.quote ? "取消引用后可添加附件" : "每次可发送一个附件，最多 4 MiB"
			}, "附件"), (0, react.createElement)("textarea", {
				ref: input,
				"aria-label": "发送到 QQ 的消息",
				rows: 1,
				maxLength: QQ_MANUAL_MESSAGE_LIMIT,
				value: draft.text,
				readOnly: !!operation,
				disabled: !!disabledReason,
				placeholder: disabledReason || `以 ${robotName} 的身份发送到 QQ`,
				onChange: (event) => {
					edit({
						...draft,
						text: event.currentTarget.value
					});
					setStatus("");
				},
				onKeyDown
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "submit",
				size: "sm",
				variant: "primary",
				disabled: editLocked || !draft.text.trim() && !draft.attachment
			}, "发送")), (0, react.createElement)("div", { className: "imqw-composer-footer" }, (0, react.createElement)("span", {
				className: "imqw-muted",
				role: "status"
			}, status || (disabledReason ? "" : "直接发到 QQ · Shift + Enter 换行")), operation && !busy ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				onClick: () => {
					run(operation);
				}
			}, "查询回执") : null, operation && !busy && uncertain ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: () => {
					rememberOperation(key);
					setOperation(void 0);
					setUncertain(false);
					setStatus("已结束查询。发送前请在 QQ 核对。");
					input.current?.focus();
				}
			}, "结束查询") : null));
		});
		//#endregion
		//#region src/client/workbench-timeline.ts
		const statusLabel = {
			received: "已收到",
			sending: "发送中",
			partial: "QQ 已接受部分内容",
			accepted: "QQ 接口已接受",
			rejected: "QQ 拒绝",
			unknown: "结果未知"
		};
		const inboundLabel = {
			"mention-required": "已收到，未 @ 机器人",
			"rate-limited": "触发频率限制",
			"queue-full": "处理队列已满",
			empty: "没有可提交给 DSH 的内容",
			submitted: "已提交到 DSH",
			"submit-failed": "提交到 DSH 失败",
			"session-archived": "当前 Session 已归档，消息未提交"
		};
		const sourceLabel = {
			automatic: "自动回复",
			agent: "Agent 投递",
			manual: "网页直发",
			answer: "Session 回答"
		};
		const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });
		const timeFormat = new Intl.DateTimeFormat("zh-CN", { timeStyle: "short" });
		function grouped(previous, row) {
			return !!previous && previous.direction === row.direction && (row.direction === "outbound" || !!row.senderId && previous.senderId === row.senderId) && row.at >= previous.at && row.at - previous.at < 18e4;
		}
		function updateLatest(current, latest) {
			if (!current || !latest.entries.length) return latest;
			const overlap = current.entries.findIndex((row) => row.id === latest.entries[0]?.id);
			if (overlap < 0) return latest;
			return {
				entries: [...current.entries.slice(0, overlap), ...latest.entries],
				before: overlap > 0 ? current.before : latest.before,
				incomplete: latest.incomplete
			};
		}
		function QqTimelineView({ appId, peer, robotName, disabledReason, openSession }) {
			const [page, setPage] = (0, react.useState)();
			const [error, setError] = (0, react.useState)("");
			const [readingOlder, setReadingOlder] = (0, react.useState)(false);
			const [refresh, setRefresh] = (0, react.useState)(0);
			const [newMessages, setNewMessages] = (0, react.useState)(false);
			const latestId = (0, react.useRef)(void 0);
			const list = (0, react.useRef)(null);
			const composer = (0, react.useRef)(null);
			const lifetime = (0, react.useRef)(null);
			const follow = (0, react.useRef)(true);
			const olderHeight = (0, react.useRef)(void 0);
			const { scope, openId, recording } = peer;
			const params = (before) => {
				const query = new URLSearchParams({
					appId,
					scope,
					openId
				});
				if (before) query.set("before", before);
				return `${WORKBENCH_TIMELINE_PATH}?${query}`;
			};
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				lifetime.current = controller;
				let timer;
				const read = async () => {
					try {
						const latest = await fetchJson(params(), {
							signal: controller.signal,
							cache: "no-store"
						});
						if (controller.signal.aborted) return;
						const tail = latest.entries.at(-1)?.id;
						if (!follow.current && latestId.current && tail !== latestId.current) setNewMessages(true);
						latestId.current = tail;
						setPage((previous) => updateLatest(previous, latest));
						setError("");
					} catch (cause) {
						if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取 QQ 流水");
					} finally {
						if (!controller.signal.aborted) timer = setTimeout(() => {
							read();
						}, 4e3);
					}
				};
				read();
				return () => {
					controller.abort();
					clearTimeout(timer);
				};
			}, [
				appId,
				scope,
				openId,
				refresh
			]);
			(0, react.useLayoutEffect)(() => {
				const node = list.current;
				if (!node) return;
				if (olderHeight.current !== void 0) {
					node.scrollTop += node.scrollHeight - olderHeight.current;
					olderHeight.current = void 0;
				} else if (follow.current) node.scrollTop = node.scrollHeight;
			}, [page]);
			const loadOlder = async () => {
				const before = page?.before;
				const signal = lifetime.current?.signal;
				if (!before || !signal || readingOlder) return;
				setReadingOlder(true);
				try {
					const older = await fetchJson(params(before), {
						signal,
						cache: "no-store"
					});
					if (signal.aborted) return;
					olderHeight.current = list.current?.scrollHeight;
					setPage((current) => current?.before === before ? {
						entries: [...older.entries, ...current.entries],
						before: older.before,
						incomplete: current.incomplete || older.incomplete
					} : current);
					setError("");
				} catch (cause) {
					if (!signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取更早记录");
				} finally {
					setReadingOlder(false);
				}
			};
			const refreshEntry = async (id) => {
				const signal = lifetime.current?.signal;
				if (!signal || signal.aborted) return void 0;
				const query = new URLSearchParams({
					appId,
					scope,
					openId,
					entryId: id
				});
				const entry = await fetchJson(`${WORKBENCH_TIMELINE_PATH}?${query}`, {
					signal,
					cache: "no-store"
				});
				if (signal.aborted) return void 0;
				setPage((current) => current && {
					...current,
					entries: current.entries.map((row) => row.id === id ? entry : row)
				});
				return entry;
			};
			const reload = () => setRefresh((value) => value + 1);
			const jump = () => {
				follow.current = true;
				setNewMessages(false);
				if (list.current) list.current.scrollTop = list.current.scrollHeight;
			};
			const entries = page?.entries ?? [];
			return (0, react.createElement)("section", {
				className: "imqw-timeline",
				"aria-label": "QQ 消息"
			}, (0, react.createElement)("div", { className: "imqw-timeline-header" }, (0, react.createElement)("span", { className: "imqw-muted" }, !recording ? "消息保存已关闭" : "QQ 消息"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: readingOlder,
				onClick: reload
			}, "刷新消息")), error || page?.incomplete ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqb-error"
			}, error || "消息记录可能不完整。") : null, (0, react.createElement)("div", {
				className: "imqw-timeline-scroll",
				ref: list,
				onScroll: () => {
					const node = list.current;
					if (!node) return;
					follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
					if (follow.current) setNewMessages(false);
				}
			}, !page && !error ? (0, react.createElement)("p", {
				role: "status",
				className: "imqw-timeline-empty imqw-muted"
			}, "正在读取消息…") : null, page?.entries.length === 0 ? (0, react.createElement)("p", { className: "imqw-timeline-empty imqw-muted" }, "还没有已保存的 QQ 消息。") : null, page?.before ? (0, react.createElement)("div", { className: "imqw-timeline-older" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: readingOlder,
				onClick: () => {
					loadOlder();
				}
			}, readingOlder ? "正在读取…" : "加载更早消息")) : null, (0, react.createElement)("ol", { className: "imqw-timeline-list" }, entries.flatMap((row, index) => {
				const previous = entries[index - 1];
				const newDay = !previous || dateFormat.format(previous.at) !== dateFormat.format(row.at);
				const message = (0, react.createElement)(MessageRow, {
					key: row.id,
					row,
					appId,
					scope,
					openId,
					robotName,
					openSession,
					refreshEntry,
					peerName: scope === "c2c" ? peer.alias || peer.name : void 0,
					onReply: !disabledReason && canQuoteTimelineEntry(row) ? (sender) => composer.current?.replyTo(row, sender) : void 0,
					compact: !newDay && grouped(previous, row)
				});
				return newDay ? [(0, react.createElement)("li", {
					key: "date-" + row.id,
					className: "imqw-message-day"
				}, dateFormat.format(row.at)), message] : [message];
			}))), newMessages ? (0, react.createElement)("div", { className: "imqw-message-jump" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: jump
			}, "查看最新消息 ↓")) : null, (0, react.createElement)(QqComposer, {
				ref: composer,
				appId,
				peer,
				robotName,
				disabledReason,
				onUpdate: reload
			}));
		}
		function MessageRow({ row, appId, scope, openId, robotName, peerName, openSession, refreshEntry, onReply, compact }) {
			const [checking, setChecking] = (0, react.useState)(false);
			const [receiptNote, setReceiptNote] = (0, react.useState)("");
			const outbound = row.direction === "outbound";
			const sender = outbound ? robotName : peerName || row.senderName || (scope === "c2c" ? `私聊 ${openId.slice(-8)}` : row.senderId ? `成员 ${row.senderId.slice(-8)}` : "QQ 成员");
			const errorCode = [row.httpStatus && `HTTP ${row.httpStatus}`, row.platformCode && `QQ ${row.platformCode}`].filter(Boolean).join(" · ");
			const linkedSession = row.sessionId;
			const queryReceipt = async () => {
				setChecking(true);
				setReceiptNote("");
				try {
					if ((await refreshEntry(row.id))?.status === "unknown") setReceiptNote("记录仍未确认结果，请在 QQ 核对。");
				} catch (error) {
					setReceiptNote(error instanceof Error ? error.message : "无法查询发送记录。");
				} finally {
					setChecking(false);
				}
			};
			const detail = row.inboundOutcome ? inboundLabel[row.inboundOutcome] : statusLabel.received;
			const imageCount = row.imageCount ?? 0;
			const remaining = (row.attachments ?? 0) - imageCount;
			return (0, react.createElement)("li", {
				className: "imqw-timeline-row",
				"data-direction": row.direction,
				"data-compact": compact
			}, (0, react.createElement)("span", {
				className: "imqw-message-avatar",
				"aria-hidden": true
			}, !compact && [...sender][0]?.toUpperCase()), (0, react.createElement)("div", { className: "imqw-message-body" }, compact ? null : (0, react.createElement)("div", { className: "imqw-timeline-meta" }, (0, react.createElement)("strong", { title: sender }, sender), (0, react.createElement)("time", { dateTime: new Date(row.at).toISOString() }, timeFormat.format(row.at))), (0, react.createElement)("div", { className: "imqw-timeline-bubble" }, row.quote ? (0, react.createElement)("blockquote", null, row.quote.senderName ? (0, react.createElement)("strong", null, row.quote.senderName) : null, row.quote.text ? (0, react.createElement)("div", null, row.quote.text) : null, row.quote.attachments ? (0, react.createElement)("span", { className: "imqw-muted" }, `引用附件 · ${row.quote.attachments} 项`) : null) : null, row.text ? (0, react.createElement)("div", { className: "imqw-timeline-text" }, row.text) : null, imageCount > 0 ? (0, react.createElement)("div", { className: "imqw-message-images" }, Array.from({ length: imageCount }, (_, index) => {
				const query = new URLSearchParams({
					appId,
					scope,
					openId,
					entryId: row.id,
					image: String(index)
				});
				return (0, react.createElement)(MessageImage, {
					key: index,
					url: `${WORKBENCH_TIMELINE_PATH}?${query}`,
					number: index + 1
				});
			})) : null, remaining > 0 ? (0, react.createElement)("div", { className: "imqw-muted" }, row.attachmentName ? `附件 · ${row.attachmentName}` : `附件 · ${remaining} 项`) : null), (0, react.createElement)("div", { className: "imqw-timeline-meta imqw-message-details" }, outbound ? (0, react.createElement)("span", { "data-status": row.status }, statusLabel[row.status]) : null, row.source ? (0, react.createElement)("span", null, sourceLabel[row.source]) : null, onReply ? (0, react.createElement)("button", {
				type: "button",
				className: "imqw-message-action",
				onClick: () => onReply(sender)
			}, "引用回复") : null, linkedSession && openSession ? (0, react.createElement)("button", {
				type: "button",
				className: "imqw-message-action",
				"aria-label": "打开关联 Session",
				title: "打开关联 Session",
				onClick: () => openSession(linkedSession)
			}, "↗") : null), (0, react.createElement)("details", { className: "imqw-response-detail" }, (0, react.createElement)("summary", null, "响应详情"), outbound ? (0, react.createElement)("p", null, row.source ? `来源 · ${sourceLabel[row.source]}` : "来源未记录", (0, react.createElement)("br"), statusLabel[row.status], errorCode ? ` · ${errorCode}` : "") : (0, react.createElement)("p", null, detail), outbound && (row.status === "unknown" || row.status === "sending") ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				disabled: checking,
				onClick: () => {
					queryReceipt();
				}
			}, checking ? "查询中…" : "查询回执") : null, receiptNote ? (0, react.createElement)("p", { role: "status" }, receiptNote) : null)));
		}
		function MessageImage({ url, number }) {
			const [unavailable, setUnavailable] = (0, react.useState)(false);
			if (unavailable) return (0, react.createElement)("span", { className: "imqw-muted" }, "图片已过期或无法预览");
			return (0, react.createElement)("a", {
				className: "imqw-message-image",
				href: url,
				target: "_blank",
				rel: "noopener noreferrer",
				"aria-label": `打开原图 ${number}`
			}, (0, react.createElement)("img", {
				src: url,
				alt: `QQ 图片 ${number}`,
				loading: "lazy",
				decoding: "async",
				onError: () => setUnavailable(true)
			}));
		}
		//#endregion
		//#region src/client/history-extension.ts
		const name = "im-qqbot-workbench-history-client";
		const inject = ["qqbotWorkbench"];
		function apply(ctx) {
			ctx.effect(() => ctx.qqbotWorkbench.registerView({
				id: "qq-history",
				title: "QQ 记录",
				component: QqTimelineView
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map