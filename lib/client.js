window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		//#region ../../deepseek-harness/packages/preset/agent-preset-registry/lib/types/display.js
		/**
		* Display resolution for roster presets, shared by every surface that renders
		* preset names: shipped presets resolve through locale dictionary keys, and
		* user-authored metadata is never translated. A pure fold with no imports, so
		* browser bundles inline it and the Host uses the same single home for which
		* shipped id carries which copy key.
		* @module @deepseek-ai/dsh-agent-preset-registry/display
		*/
		const BUILT_IN_PRESET_KEYS = {
			standard: {
				name: "presetStandardName",
				description: "presetStandardDescription"
			},
			ptc: {
				name: "presetPtcName",
				description: "presetPtcDescription"
			},
			minimal: {
				name: "presetMinimalName",
				description: "presetMinimalDescription"
			},
			cordis: {
				name: "presetCordisName",
				description: "presetCordisDescription"
			}
		};
		/**
		* Whether a roster row is one of the shipped presets whose copy the dictionaries carry.
		* A shipped preset publishes no `name`; a declaration that names itself owns its copy.
		* @param preset - roster row.
		* @returns true for a shipped preset id without a published name.
		*/
		function isBuiltInPreset(preset) {
			return preset.name === void 0 && BUILT_IN_PRESET_KEYS[preset.id] !== void 0;
		}
		/**
		* Resolve preset display copy without making user-authored metadata translatable.
		* @param preset - roster row whose copy is being rendered.
		* @param t - active locale lookup covering {@link BuiltInPresetCopyKey}.
		* @returns localized copy for a known shipped preset, otherwise declaration metadata.
		*/
		function presetDisplayText(preset, t) {
			const keys = isBuiltInPreset(preset) ? BUILT_IN_PRESET_KEYS[preset.id] : void 0;
			if (keys !== void 0) return {
				name: t(keys.name),
				description: t(keys.description)
			};
			return {
				name: preset.name ?? preset.id,
				...preset.description === void 0 ? {} : { description: preset.description }
			};
		}
		//#endregion
		//#region ../../deepseek-harness/packages/util/brand/lib/index.js
		/**
		* Duplicate-install-safe nominal primitive helpers.
		*
		* A brand makes structurally identical strings or numbers non-interchangeable
		* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
		* expected, and an event sequence cannot be passed as a log offset. Comparison,
		* logging, and serialization retain the underlying primitive behavior.
		*
		* This package owns no concrete domain value and keeps no runtime identity or mutable
		* state, so independently installed copies produce interchangeable values.
		*
		* @module @deepseek-ai/dsh-brand
		*/
		/**
		* Apply a compile-time string brand without changing the value.
		* @param value - string admitted by the domain that owns the target brand.
		* @returns the same string with the requested compile-time brand.
		*/
		function brandString(value) {
			return value;
		}
		//#endregion
		//#region ../../deepseek-harness/packages/core/session/lib/types/types.js
		/**
		* Brand a string as a {@link SessionId}.
		* @param id - the raw session id string.
		* @returns the same string with the session-id brand.
		*/
		function SessionId(id) {
			return brandString(id);
		}
		//#endregion
		//#region src/shared/bind-protocol.ts
		/**
		* 端内绑定协议 —— 宿主路由与客户端面板的共享契约
		*
		* 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
		* （client/bind-page.ts）各自 import，杜绝两端协议漂移。
		* 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
		* 客户端 tsdown 构建会将其内联进 bundle。
		*/
		/** 状态查询（绑定页轮询） */
		const BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
		/** 刷新二维码（绑定页按钮） */
		const BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
		/** 解绑：移除已保存凭据，回到绑定流程 */
		const BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
		//#endregion
		//#region src/client/http.ts
		/** Same-origin JSON requests with bounded waiting and actionable HTTP errors. */
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
					throw new Error(body?.error ?? `请求失败（HTTP ${response.status}）`);
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
		//#region src/client/bind-page.ts
		/**
		* 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
		*
		* 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
		* - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
		* 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
		*
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		/** 样式注入标记（幂等） */
		const STYLE_ID$1 = "im-qqbot-bind-panel-styles";
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$1) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 24px 16px; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 12px; color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { box-sizing: content-box; border-radius: var(--dsw-radius-md); padding: 8px; max-width: calc(100% - 16px); height: auto; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-pluginPageContent { max-width: 680px; margin: 0 auto; }
.imqb-pageTitle { margin: 0 0 12px; font-size: 20px; line-height: 1.5; font-weight: 600; }
.imqb-pageDescription { margin: 0 0 16px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-error { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--dsw-alias-state-error-primary); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 13px; color: var(--dsw-alias-label-primary); }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
.imqb-account {
  display: flex; align-items: center; flex-wrap: wrap; column-gap: 24px;
  border-bottom: .5px solid var(--dsw-alias-border-l2); padding-bottom: 12px;
}
.imqb-account > .imqb-status-row { flex: 1 1 240px; min-width: 0; }
.imqb-account > .imqb-status-actions { padding: 12px 0; flex-wrap: wrap; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: var(--dsw-radius-md); padding: 8px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
    `;
			style.textContent += `\n.imqb-danger { color: var(--dsw-alias-state-error-primary); }
.imqb-field > span { width: 100%; }
.imqb-cards { display: flex; flex-direction: column; gap: 20px; }
.imqb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 16px 16px; background: var(--dsw-alias-bg-layer-1); }
.imqb-cardTitle { margin: 14px 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb-cardHint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }`;
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
		* 新相位（如解绑后的 waiting 二维码）。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				const controller = new AbortController();
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "saving" ? 500 : phase === "bound" ? 3e4 : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const body = await fetchJson(BIND_STATE_PATH, {
							cache: "no-store",
							signal: controller.signal
						});
						sawRoute = true;
						if (!alive()) return;
						setGone(false);
						setError(null);
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch (cause) {
						if (alive()) {
							const message = cause instanceof Error ? cause.message : "无法获取绑定状态";
							setError(message);
							if (!sawRoute && message.includes("HTTP 404")) setGone(true);
						}
					} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					setGone(false);
					setError(null);
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [enabled]);
			return {
				state,
				gone,
				error,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const body = await fetchJson(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				return body.ok ? {
					ok: true,
					message: body.message
				} : {
					ok: false,
					error: body.error ?? "保存失败，请重试"
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示），提交成功后展示保存结果；
		* 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
		*/
		function ManualForm({ initialAppId, recheck }) {
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setBusy(true);
				setResult(null);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					if (outcome.ok) {
						setAppSecret("");
						recheck();
					}
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy,
				recheck
			]);
			if (result !== null && result.ok) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载，连接结果可在左侧 QQ 导航底部查看")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: recheck
			}, "刷新状态")));
			return (0, react.createElement)("form", {
				className: "imqb-form",
				onSubmit: submit
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: appId,
				placeholder: "QQ 机器人 AppID",
				disabled: busy,
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "password",
				value: appSecret,
				disabled: busy,
				placeholder: initialAppId === void 0 ? "QQ 机器人 AppSecret" : "输入新的 AppSecret（不回显）",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password"
			})), result !== null && !result.ok ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, result.error) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				type: "submit",
				disabled: busy
			}, busy ? "正在保存…" : "保存"));
		}
		/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
		const QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
		/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
		function QqBotIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-qqicon"
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
		function BoundView({ appId, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [confirmUnbind, setConfirmUnbind] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const unbind = (0, react.useCallback)(() => {
				if (busy) return;
				setConfirmUnbind(false);
				setBusy(true);
				setUnbindResult(null);
				fetchJson(BIND_UNBIND_PATH, { method: "POST" }).then((body) => {
					if (body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? "解绑失败，请重试"
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [recheck, busy]);
			if (unbindResult?.ok === true) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "👋"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: recheck
			}, "刷新状态")));
			if (editing) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "更换凭据")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => {
					setEditing(false);
				}
			}, "返回")), (0, react.createElement)(ManualForm, {
				initialAppId: appId,
				recheck
			}));
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-account" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId}`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				className: "imqb-danger",
				disabled: busy,
				onClick: () => setConfirmUnbind(true)
			}, busy ? "正在解绑…" : "解绑"))), unbindResult !== null && !unbindResult.ok ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, unbindResult.message) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: confirmUnbind,
				onClose: () => setConfirmUnbind(false),
				title: "解绑 QQ 机器人",
				closeLabel: "关闭",
				description: "清除本机保存的 QQ 凭据并重载连接，随后进入扫码绑定。会话历史保留；此操作不会移出 QQ 群或删除平台侧关系。",
				footer: (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: () => setConfirmUnbind(false)
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: unbind
				}, "确认解绑"))
			}));
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state, recheck }) {
			const [mode, setMode] = (0, react.useState)("qr");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(() => {
				if (busy) return;
				setBusy(true);
				setError(null);
				fetchJson(BIND_REFRESH_PATH, { method: "POST" }).then(() => {
					recheck();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
				}).finally(() => {
					setBusy(false);
				});
			}, [busy, recheck]);
			if (mode === "manual") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "手动填写凭据"), (0, react.createElement)(ManualForm, { recheck }), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => {
					setMode("qr");
				}
			}, "改用扫码绑定"));
			return (0, react.createElement)("div", { className: "imqb-panel" }, state.qrSvg === void 0 ? null : (0, react.createElement)("img", {
				src: state.qrSvg,
				alt: "QQ 扫码二维码",
				width: 220,
				height: 220,
				className: "imqb-qr"
			}), (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "使用手机 QQ 扫描二维码完成绑定"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "二维码显示异常？在浏览器中打开"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: refresh
			}, busy ? "正在刷新…" : "刷新二维码"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写")), error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null);
		}
		function FailedView({ reason, recheck }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const retry = () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				fetchJson(BIND_REFRESH_PATH, { method: "POST" }).then(() => {
					recheck();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
				}).finally(() => {
					setBusy(false);
				});
			};
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, reason), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "primary",
				size: "sm",
				disabled: busy,
				onClick: retry
			}, busy ? "正在刷新…" : "重新获取二维码"), error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null);
		}
		function BindPanelBody(props) {
			usePanelStyles();
			const injected = props.state !== void 0;
			const internal = useBindState(!injected);
			const state = injected ? props.state ?? null : internal.state;
			const gone = injected ? props.gone ?? false : internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const error = injected ? props.error : internal.error;
			const [lastQr, setLastQr] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (state === null) return;
				if (state.phase === "waiting") {
					if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
				} else if (state.phase === "bound") setLastQr(null);
			}, [state]);
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: recheck
			}, "重新读取绑定状态"));
			if (state === null || state.phase === "starting") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", {
				className: error ? "imqb-error" : "imqb-hint",
				role: "status"
			}, error ?? "正在获取绑定状态…"), error ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: recheck
			}, "重试读取绑定状态") : null);
			if (state.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在保存凭据…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，正在重新加载连接"))));
			}
			if (state.phase === "failed") return (0, react.createElement)(FailedView, {
				reason: state.reason,
				recheck
			});
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				key: state.appId,
				appId: state.appId,
				recheck
			});
			return (0, react.createElement)(UnboundView, {
				state,
				recheck
			});
		}
		//#endregion
		//#region src/client/config-form-state.ts
		const EDITABLE_KEYS = ["access"];
		const ACCESS_KEYS = [
			"c2cMode",
			"c2cAllow",
			"groupMode",
			"groupAllow"
		];
		const DEFAULT_ACCESS = {
			c2cMode: "allowlist",
			c2cAllow: [],
			groupMode: "open",
			groupAllow: []
		};
		function equal(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/** Preserve raw textarea lines while editing; normalize only the submitted snapshot. */
		function normalizeConfig(form) {
			if (form.access === void 0) return { ...form };
			const lines = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
			return {
				...form,
				access: {
					...form.access,
					c2cAllow: lines(form.access.c2cAllow),
					groupAllow: lines(form.access.groupAllow)
				}
			};
		}
		/** Build the writable difference without submitting account or working-directory fields. */
		function configPatch(baseline, form) {
			const changed = {};
			for (const key of EDITABLE_KEYS) if (!equal(form[key], baseline[key])) Object.assign(changed, { [key]: form[key] });
			return changed;
		}
		function isConfigDirty(baseline, form) {
			return Object.keys(configPatch(baseline, form)).length > 0;
		}
		/** Refresh untouched fields while preserving local edits, including individual access fields. */
		function rebaseConfig(baseline, form, incoming) {
			const rebased = { ...incoming };
			for (const key of EDITABLE_KEYS) if (key !== "access" && !equal(form[key], baseline[key])) Object.assign(rebased, { [key]: form[key] });
			if (form.access !== void 0 && !equal(form.access, baseline.access)) {
				const access = { ...incoming.access ?? DEFAULT_ACCESS };
				for (const key of ACCESS_KEYS) if (!equal(form.access[key], baseline.access?.[key])) Object.assign(access, { [key]: form.access[key] });
				rebased.access = access;
			}
			return rebased;
		}
		/** Pick the supported fields so stored browser drafts cannot retain a future secret response field. */
		function configDraft(baseline, form) {
			const pick = (source) => {
				const value = {};
				if (source.appId !== void 0) value.appId = source.appId;
				for (const key of EDITABLE_KEYS) if (source[key] !== void 0) Object.assign(value, { [key]: source[key] });
				return value;
			};
			return {
				baseline: pick(baseline),
				form: pick(form)
			};
		}
		/** Ignore malformed tab storage instead of rendering unchecked field values. */
		function parseConfigDraft(value) {
			const validConfig = (candidate) => {
				if (candidate === null || typeof candidate !== "object") return false;
				const fields = candidate;
				for (const key of [
					"appId",
					"provider",
					"model",
					"preset",
					"groupPrompt",
					"directPrompt"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "string") return false;
				for (const key of [
					"requireMention",
					"streaming",
					"showToolResults",
					"debug"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "boolean") return false;
				if (fields.access !== void 0) {
					if (fields.access === null || typeof fields.access !== "object") return false;
					const access = fields.access;
					for (const key of ["c2cMode", "groupMode"]) if (![
						"open",
						"allowlist",
						"disabled"
					].includes(String(access[key]))) return false;
					for (const key of ["c2cAllow", "groupAllow"]) if (!Array.isArray(access[key]) || !access[key].every((entry) => typeof entry === "string")) return false;
				}
				return true;
			};
			if (value === null || typeof value !== "object") return void 0;
			const stored = value;
			return validConfig(stored.baseline) && validConfig(stored.form) ? configDraft(stored.baseline, stored.form) : void 0;
		}
		//#endregion
		//#region src/shared/pairing-protocol.ts
		/**
		* 配对码认领协议 —— Web 与 QQ 两端共享的契约。
		*
		* 背景：官方 QQ 机器人 API 只给 openid（AppID 维度、匿名、群/私两套），用户看不到也拿不到。
		* 因此用「一次性配对码」把「能打开 DSH Web 的本人」与「QQ 侧发消息的 openid」缝起来：
		*   Web 生成码 → 用户在 QQ 直接发送该码 → 机器人把该消息的 openid 记为目标身份。
		*
		* 本模块只含类型 + 常量 + 纯函数（码生成/校验格式），零 node 依赖，
		* 客户端 bundle 会内联。运行期状态（谁生成了哪个码、TTL、是否已用）由配对服务持有。
		*/
		/** Web 生成配对码 */
		const PAIR_ISSUE_PATH = "/qqbot/im-qqbot/pair/issue";
		/** Web 查询认领状态（进行中的码 + 已认领成员） */
		const PAIR_STATUS_PATH = "/qqbot/im-qqbot/pair/status";
		/** Web 撤销/移除一个已认领成员 */
		const PAIR_REVOKE_PATH = "/qqbot/im-qqbot/pair/revoke";
		/** Web 手动按 openID 直接添加成员（用户自行输入 openid） */
		const PAIR_MANUAL_PATH = "/qqbot/im-qqbot/pair/manual";
		/** Web 修改成员昵称 */
		const PAIR_RENAME_PATH = "/qqbot/im-qqbot/pair/rename";
		//#endregion
		//#region src/client/qq-pairing.ts
		/**
		* 配对码认领 UI —— Web 侧生成一次性码、展示已认领成员、撤销。
		*
		* 流程：Web 生成码 → 用户在 QQ 直接发送该码 → 机器人识别并写名单。
		* 本组件只负责 Web 端的码展示与已认领列表；真正的 openid 绑定在服务端完成。
		*/
		/** 配对状态轮询间隔（进行中的码需要实时反映"已认领"）。 */
		const POLL_MS = 2e3;
		function usePairStatus(active) {
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const reload = (0, react.useCallback)(() => setTick((n) => n + 1), []);
			(0, react.useEffect)(() => {
				if (!active) return;
				let stopped = false;
				const load = () => {
					fetchJson(PAIR_STATUS_PATH, { cache: "no-store" }).then((s) => {
						if (!stopped) {
							setStatus(s);
							setError(null);
						}
					}).catch((c) => {
						if (stopped) return;
						const msg = c instanceof Error ? c.message : "";
						if (/404|未绑定|not found/i.test(msg)) {
							setStatus({
								challenges: [],
								owners: [],
								allowC2c: [],
								allowGroup: []
							});
							setError(null);
							return;
						}
						setError(msg || "读取认领状态失败");
					});
				};
				load();
				const timer = setInterval(load, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [active, tick]);
			return {
				status,
				error,
				reload
			};
		}
		/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
		function PairClaimPanel({ purpose, title, hint, enabled = true }) {
			const { status, error, reload } = usePairStatus(enabled);
			const members = status === null ? [] : purpose === "owner" ? status.owners : purpose === "allow-group" ? status.allowGroup : status.allowC2c;
			const [code, setCode] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)(null);
			const [manualOpenid, setManualOpenid] = (0, react.useState)("");
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const copyPairCode = (0, react.useCallback)(async (value) => {
				try {
					await (globalThis.navigator?.clipboard?.writeText?.(value) ?? Promise.reject(/* @__PURE__ */ new Error("no clipboard")));
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {}
			}, []);
			const codeSeen = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (code === null || status === null) {
					codeSeen.current = false;
					return;
				}
				if (status.challenges.some((c) => c.code === code.code)) {
					codeSeen.current = true;
					return;
				}
				if (codeSeen.current) {
					codeSeen.current = false;
					const expired = Date.now() > code.expiresAt;
					setCode(null);
					if (expired) setMsg("配对码已过期，请重新生成");
					else {
						setMsg("该配对码已被认领 ✔");
						setAddOpen(false);
					}
				}
			}, [status, code]);
			if (!enabled) return (0, react.createElement)("div", { className: "imqc-pair" }, (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("strong", null, title)), (0, react.createElement)("p", { className: "imqc-hint" }, "先完成 QQ 机器人绑定，才能配置认领。"));
			const issue = () => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_ISSUE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ purpose })
				}).then((r) => {
					setCode({
						code: r.code,
						expiresAt: r.expiresAt
					});
					reload();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "生成配对码失败")).finally(() => setBusy(false));
			};
			const revoke = (openid) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_REVOKE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid
					})
				}).then(() => reload()).catch((c) => setMsg(c instanceof Error ? c.message : "移除失败")).finally(() => setBusy(false));
			};
			const saveRename = (openid, nickname) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_RENAME_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						openid,
						nickname
					})
				}).then(() => {
					setEditing(null);
					reload();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "修改失败")).finally(() => setBusy(false));
			};
			const addManual = () => {
				if (busy || !manualOpenid.trim()) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid: manualOpenid
					})
				}).then((r) => {
					setManualOpenid("");
					setMsg(r.message ?? "已添加 ✔");
					reload();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "添加失败")).finally(() => setBusy(false));
			};
			const secs = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1e3)) : 0;
			const openAdd = () => {
				setAddOpen(true);
				setMsg(null);
				if (code === null) issue();
			};
			return (0, react.createElement)("div", { className: "imqc-pair" }, (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("strong", null, title), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: openAdd
			}, "添加…")), hint ? (0, react.createElement)("p", { className: "imqc-hint" }, hint) : null, msg ? (0, react.createElement)("p", {
				className: "imqc-hint",
				role: "status"
			}, msg) : null, error ? (0, react.createElement)("p", {
				className: "imqc-error",
				role: "alert"
			}, error) : null, members.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "尚未添加任何成员。") : (0, react.createElement)("ul", { className: "imqc-pairMembers" }, ...members.map((m) => {
				const isEditing = editing?.openid === m.openid;
				return (0, react.createElement)("li", {
					className: "imqc-pairMember",
					key: `${m.openid}:${m.scene}`
				}, (0, react.createElement)("div", { className: "imqc-pairMemberMain" }, (0, react.createElement)("span", { className: "imqc-pairMemberName" }, m.nickname || "（未命名）"), (0, react.createElement)("span", { className: "imqc-pairMemberMeta" }, m.scene === "group" ? "群" : `私聊${m.sceneName ? `「${m.sceneName}」` : ""}`)), isEditing ? (0, react.createElement)("div", { className: "imqc-inline imqc-pairMemberEdit" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value: editing.nickname,
					disabled: busy,
					placeholder: "昵称",
					"aria-label": "修改昵称",
					onChange: (e) => setEditing({
						openid: m.openid,
						nickname: e.currentTarget.value
					})
				}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: () => saveRename(m.openid, editing.nickname)
				}, "保存"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => setEditing(null)
				}, "取消")) : (0, react.createElement)("div", { className: "imqc-inline imqc-pairMemberActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => setEditing({
						openid: m.openid,
						nickname: m.nickname
					})
				}, "改名"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => revoke(m.openid)
				}, "移除")));
			})), addOpen ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: `添加${title}`,
				closeLabel: "关闭",
				onClose: () => setAddOpen(false),
				className: "imqc-pairModal",
				children: (0, react.createElement)("div", { className: "imqc imqc-pairDialog" }, (0, react.createElement)("h4", { className: "imqc-pairSectionTitle" }, "方式一 · 让对方在 QQ 认领（推荐）"), (0, react.createElement)("ol", { className: "imqc-pairSteps" }, (0, react.createElement)("li", null, "下面生成一次性配对码；"), (0, react.createElement)("li", null, `让对方在${purpose === "allow-group" ? "群里 @ 机器人后" : "私聊里"}直接发送这个码：`), (0, react.createElement)("li", null, "机器人会自动匹配 TA 的昵称与 openID，并弹出「确认/取消」，点「确认」后加入。")), code ? (0, react.createElement)("div", { className: "imqc-pairCodeCard" }, (0, react.createElement)("div", { className: "imqc-pairCodeMain" }, (0, react.createElement)("code", { className: "imqc-pairCodeValue" }, code.code), (0, react.createElement)("span", { className: "imqc-pairCodeMeta" }, `${secs}s 内有效`)), (0, react.createElement)("div", { className: "imqc-pairCodeActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy,
					onClick: () => {
						copyPairCode(code.code);
					}
				}, copied ? "已复制" : "复制"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: issue
				}, busy ? "生成中…" : "重新生成"))) : (0, react.createElement)("p", { className: "imqc-hint" }, "正在生成配对码…"), (0, react.createElement)("h4", { className: "imqc-pairSectionTitle" }, "方式二 · 直接按 openID 添加"), (0, react.createElement)("p", { className: "imqc-hint" }, "每行一个（也支持用逗号分隔）。格式：openID 或 openID:昵称。例如："), (0, react.createElement)("pre", { className: "imqc-pairExample" }, "ABCD1234EFGH\nWXYZ5678:小明\nIJKL0000:Alice Zhang"), (0, react.createElement)("textarea", {
					className: "imqc-pairTextarea",
					rows: 4,
					value: manualOpenid,
					disabled: busy,
					"aria-label": `${title} openID 列表`,
					placeholder: "openID 或 openID:昵称，每行一个",
					onChange: (e) => setManualOpenid(e.currentTarget.value)
				}), (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy || manualOpenid.trim() === "",
					onClick: () => {
						addManual();
					}
				}, "添加"), (0, react.createElement)("span", { className: "imqc-hint" }, "openID:昵称 的昵称会记入成员展示。")), msg ? (0, react.createElement)("p", {
					className: "imqc-hint",
					role: "status"
				}, msg) : null, error ? (0, react.createElement)("p", {
					className: "imqc-error",
					role: "alert"
				}, error) : null, (0, react.createElement)("div", { className: "imqc-actions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					onClick: () => setAddOpen(false)
				}, "完成")))
			}) : null);
		}
		//#endregion
		//#region src/client/config-panel.ts
		/**
		* QQ 机器人配置面板 — 必要配置的 UI 编辑
		*
		* 使用宿主公共 Switch、SegmentedControl、Button 与目录菜单；多行草稿保留普通 textarea。
		*
		* 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 这里只维护账号访问范围；Agent 默认设置通过独立的版本化接口保存。
		*/
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-qqbot-config-panel-styles";
		/** QQ settings layout; control appearance belongs to the public host primitives. */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const existing = document.getElementById(STYLE_ID);
				const retain = (element) => {
					element.dataset.users = String(Number(element.dataset.users ?? 0) + 1);
					return () => {
						const users = Number(element.dataset.users ?? 1) - 1;
						if (users === 0) element.remove();
						else element.dataset.users = String(users);
					};
				};
				if (existing !== null) return retain(existing);
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); }
.imqb2-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-textarea { box-sizing: border-box; width: 100%; min-height: 68px; padding: 8px 12px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.imqb2-textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
/* Preserve the QQ settings draft and readback feedback in the sticky footer. */
.imqb2-footer {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center;
  flex-wrap: wrap; gap: 8px; margin-top: 16px; padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.imqb2-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.imqb2-feedback { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb2-feedback p { flex: 1; min-width: 0; }
.imqb2-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb2-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb2-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.imqb2-directory-feedback { display: flex; align-items: flex-start; gap: 8px; }
.imqb2-directory-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .imqb2-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb2-selector-head { align-items: stretch; flex-direction: column; }
  .imqb2-note { flex-basis: 100%; }
}
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
				document.head.appendChild(style);
				return retain(style);
			}, []);
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange, disabled = false }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: `imqq-access-${label}`,
				value,
				options,
				onChange,
				label,
				disabled
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "disabled",
				label: "禁用"
			}
		];
		const DRAFT_STORAGE_KEY = "im-qqbot/config-draft/v1";
		function storedDraft() {
			try {
				const text = sessionStorage.getItem(DRAFT_STORAGE_KEY);
				return text === null ? void 0 : parseConfigDraft(JSON.parse(text));
			} catch (_error) {
				return;
			}
		}
		/** Keep an edited form through a client reload without storing credential fields. */
		function storeDraft(draft) {
			try {
				if (isConfigDirty(draft.baseline, draft.form)) sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(configDraft(draft.baseline, draft.form)));
				else sessionStorage.removeItem(DRAFT_STORAGE_KEY);
			} catch (_error) {}
		}
		function matchesSavedConfig(config, expected) {
			return config.appId === expected.appId && !isConfigDirty(config, {
				...config,
				...expected.changed
			});
		}
		function waitForReadback(signal, delay) {
			return new Promise((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", finish);
					resolve();
				};
				const timer = setTimeout(finish, delay);
				signal.addEventListener("abort", finish, { once: true });
				if (signal.aborted) finish();
			});
		}
		/** HMR can briefly serve the old plugin fiber after its profile patch was written. */
		async function confirmSavedConfig(expected, signal) {
			const deadline = Date.now() + 5e3;
			for (let attempt = 0; attempt < 6 && !signal.aborted; attempt += 1) {
				const remaining = deadline - Date.now();
				if (remaining <= 0) break;
				try {
					const { config } = await fetchJson(BIND_CONFIG_PATH, {
						cache: "no-store",
						signal
					}, Math.min(1e3, remaining));
					if (matchesSavedConfig(config, expected)) return config;
				} catch (_error) {}
				if (!signal.aborted) await waitForReadback(signal, Math.min(400, Math.max(0, deadline - Date.now())));
			}
		}
		/** Settings editor with recoverable requests and a draft protected from binding refreshes. */
		function ConfigPanel({ bindPhase }) {
			useConfigPanelStyles();
			const [draft, setDraft] = (0, react.useState)(null);
			const draftRef = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			const saveController = (0, react.useRef)(null);
			const pendingConfirmation = (0, react.useRef)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [reload, setReload] = (0, react.useState)(0);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [draftNotice, setDraftNotice] = (0, react.useState)(null);
			const replaceDraft = (0, react.useCallback)((next) => {
				draftRef.current = next;
				storeDraft(next);
				setDraft(next);
			}, []);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					saveController.current?.abort();
				};
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let stopped = false;
				setLoading(true);
				setLoadError(null);
				fetchJson(BIND_CONFIG_PATH, {
					cache: "no-store",
					signal: controller.signal
				}).then(({ config }) => {
					if (stopped || saveController.current !== null) return;
					const expected = pendingConfirmation.current;
					if (expected !== null && config.appId === expected.appId && !matchesSavedConfig(config, expected)) {
						setResult({
							kind: "unconfirmed",
							message: "配置已保存，刷新配置核对生效结果。"
						});
						return;
					}
					pendingConfirmation.current = null;
					const current = draftRef.current ?? storedDraft();
					const sameAccount = current?.baseline.appId === config.appId;
					const hadDraft = current !== void 0 && current !== null && sameAccount && isConfigDirty(current.baseline, current.form);
					const form = hadDraft ? rebaseConfig(current.baseline, current.form, config) : config;
					replaceDraft({
						baseline: config,
						form
					});
					setDraftNotice(hadDraft && isConfigDirty(config, form) ? "已保留未保存的修改，其余配置已更新。" : null);
					setLoadError(null);
					if (expected !== null) setResult(matchesSavedConfig(config, expected) && !isConfigDirty(config, form) ? {
						kind: "confirmed",
						message: "配置已保存并生效。"
					} : null);
				}).catch((error) => {
					if (!stopped) setLoadError(error instanceof Error ? error.message : String(error));
				}).finally(() => {
					if (!stopped) setLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				bindPhase,
				reload,
				replaceDraft
			]);
			const patch = (0, react.useCallback)((key, value) => {
				const current = draftRef.current;
				if (current === null) return;
				replaceDraft({
					...current,
					form: {
						...current.form,
						[key]: value
					}
				});
				setResult(null);
			}, [replaceDraft]);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				const current = draftRef.current;
				if (busy || current === null) return;
				const submitted = normalizeConfig(current.form);
				const changed = configPatch(current.baseline, submitted);
				if (Object.keys(changed).length === 0) {
					replaceDraft({
						baseline: current.baseline,
						form: submitted
					});
					return;
				}
				replaceDraft({
					baseline: current.baseline,
					form: submitted
				});
				const controller = new AbortController();
				saveController.current = controller;
				setBusy(true);
				setResult(null);
				fetchJson(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(changed),
					signal: controller.signal
				}).then(async (body) => {
					if (!body.ok) throw new Error(body.error ?? "保存失败，请重试。");
					if (!mounted.current || controller.signal.aborted) return;
					const expected = {
						appId: submitted.appId,
						changed
					};
					pendingConfirmation.current = expected;
					replaceDraft({
						baseline: submitted,
						form: submitted
					});
					setDraftNotice(null);
					const config = await confirmSavedConfig(expected, controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					if (config !== void 0) {
						pendingConfirmation.current = null;
						replaceDraft({
							baseline: config,
							form: config
						});
						setResult({
							kind: "confirmed",
							message: "配置已保存并生效。"
						});
					} else setResult({
						kind: "unconfirmed",
						message: "配置已保存，刷新配置核对生效结果。"
					});
				}).catch((error) => {
					if (mounted.current && !controller.signal.aborted) setResult({
						kind: "failed",
						message: `保存结果未确认：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或刷新配置核对。`
					});
				}).finally(() => {
					if (saveController.current === controller) {
						saveController.current = null;
						if (mounted.current) setBusy(false);
					}
				});
			}, [busy, replaceDraft]);
			const retry = () => {
				setReload((value) => value + 1);
			};
			const loadFeedback = loadError === null ? null : (0, react.createElement)("div", {
				className: "imqb2-feedback",
				role: "alert"
			}, (0, react.createElement)("p", { className: "imqb2-note imqb2-note--error" }, `配置加载失败：${loadError}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: retry,
				disabled: loading || busy
			}, loading ? "重试中…" : "重试"));
			if (draft === null) return (0, react.createElement)("div", { "aria-busy": loading }, loadFeedback, loading ? (0, react.createElement)("p", {
				className: "imqb2-hint",
				role: "status",
				style: { padding: "12px 0" }
			}, "正在加载配置…") : null);
			const { baseline, form } = draft;
			const dirty = isConfigDirty(baseline, form);
			const access = form.access ?? DEFAULT_ACCESS;
			const message = busy ? "正在保存配置…" : result?.message ?? (dirty ? draftNotice ?? "有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。" : "没有未保存的修改。");
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit,
				"aria-busy": busy
			}, loadFeedback, (0, react.createElement)("fieldset", {
				className: "imqb2-fields",
				disabled: busy
			}, (0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "私聊",
				value: access.c2cMode,
				options: MODE_OPTIONS,
				onChange: (value) => {
					patch("access", {
						...access,
						c2cMode: value
					});
				}
			}), access.c2cMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-c2c",
				title: "私聊白名单",
				enabled: bindPhase === "bound",
				hint: "生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。"
			}) : null, (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "群聊",
				value: access.groupMode,
				options: MODE_OPTIONS,
				onChange: (value) => {
					patch("access", {
						...access,
						groupMode: value
					});
				}
			}), access.groupMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-group",
				title: "群白名单",
				enabled: bindPhase === "bound",
				hint: "生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。"
			}) : null), (0, react.createElement)("div", { className: "imqb2-footer" }, (0, react.createElement)("p", {
				className: `imqb2-note${result === null ? "" : result.kind === "failed" ? " imqb2-note--error" : " imqb2-note--ok"}`,
				role: result?.kind === "failed" ? "alert" : "status",
				"aria-live": "polite"
			}, message), (0, react.createElement)("div", { className: "imqb2-footer-actions" }, pendingConfirmation.current !== null || result?.kind === "failed" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || loading,
				onClick: retry
			}, loading ? "刷新中…" : "刷新配置") : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || !dirty,
				onClick: () => {
					replaceDraft({
						baseline,
						form: baseline
					});
					setResult(null);
					setDraftNotice(null);
				}
			}, "撤销修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "保存中…" : "保存"))));
		}
		//#endregion
		//#region src/client/host-selectors.ts
		function record(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
		}
		function text(value) {
			return typeof value === "string" && value.trim() !== "" ? value : void 0;
		}
		/** Unwrap the host RemoteResult before projecting the fields used by the menu. */
		function remoteValue(response) {
			const result = record(response);
			if (result?.ok === false) throw new Error(text(record(result.error)?.message) ?? "宿主目录读取失败。");
			const value = result?.ok === true ? record(result.value) : void 0;
			if (value === void 0) throw new Error("宿主目录返回格式无效。");
			return value;
		}
		function parseModelCatalog(response) {
			const value = remoteValue(response);
			if (!Array.isArray(value.groups) || !Array.isArray(value.failures)) throw new Error("模型目录返回格式无效。");
			const groups = [];
			const failures = [];
			const seenProviders = /* @__PURE__ */ new Set();
			for (const candidate of value.groups) {
				const group = record(candidate);
				const id = text(group?.id);
				if (group === void 0 || id === void 0 || !Array.isArray(group.models) || seenProviders.has(id)) {
					failures.push("有提供方条目格式无效或重复");
					continue;
				}
				seenProviders.add(id);
				const models = [];
				const seenModels = /* @__PURE__ */ new Set();
				for (const candidateModel of group.models) {
					const model = record(candidateModel);
					const modelId = text(model?.id);
					if (model === void 0 || modelId === void 0 || seenModels.has(modelId)) {
						failures.push(`${text(group.name) ?? id} 有模型条目格式无效或重复`);
						continue;
					}
					seenModels.add(modelId);
					const reasoning = record(model.reasoning);
					const efforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts.flatMap((candidateEffort) => {
						const effort = record(candidateEffort);
						const effortId = text(effort?.id);
						if (effort === void 0 || effortId === void 0) return [];
						return [{
							id: effortId,
							name: text(effort.name) ?? effortId,
							...text(effort.description) === void 0 ? {} : { description: text(effort.description) }
						}];
					}) : [];
					models.push({
						provider: id,
						model: modelId,
						name: text(model.name) ?? modelId,
						description: text(model.description),
						efforts,
						defaultEffort: text(reasoning?.defaultEffort)
					});
				}
				groups.push({
					id,
					name: text(group.name) ?? id,
					models
				});
			}
			for (const candidate of value.failures) {
				const failure = record(candidate);
				failures.push(`${text(failure?.name) ?? text(failure?.id) ?? "未知提供方"}：${text(failure?.message) ?? "目录加载失败"}`);
			}
			const defaultValue = record(value.default);
			const provider = text(defaultValue?.provider);
			const model = text(defaultValue?.model);
			return {
				groups,
				failures: [...new Set(failures)],
				defaultModel: provider === void 0 || model === void 0 ? void 0 : {
					provider,
					model
				}
			};
		}
		function parseAgentPresets(response) {
			const value = remoteValue(response);
			if (!Array.isArray(value.presets)) throw new Error("Agent 预设目录返回格式无效。");
			const presets = [];
			const seen = /* @__PURE__ */ new Set();
			for (const candidate of value.presets) {
				const preset = record(candidate);
				const id = text(preset?.id);
				if (preset === void 0 || id === void 0 || seen.has(id)) throw new Error("Agent 预设目录含无效或重复的条目。");
				if (preset.broken !== void 0 && typeof preset.broken !== "string") throw new Error("Agent 预设状态格式无效。");
				seen.add(id);
				presets.push({
					id,
					name: text(preset.name) ?? id,
					description: text(preset.description),
					broken: typeof preset.broken === "string" ? preset.broken : void 0,
					isDefault: preset.isDefault === true
				});
			}
			return presets;
		}
		function modelChoiceId(selection) {
			return `model:${JSON.stringify([selection.provider, selection.model])}`;
		}
		function findModel(directory, selection) {
			return directory?.groups.find((group) => group.id === selection.provider)?.models.find((model) => model.model === selection.model);
		}
		/** Resolve a model route to a human label without an inherit fallback. */
		function routeLabel(directory, selection) {
			const model = findModel(directory, selection);
			const fallback = `${selection.provider || "未指定提供方"} / ${selection.model || "未指定模型"}`;
			return model === void 0 ? `${fallback}${directory === null ? "" : "（不可用）"}` : `${directory?.groups.find((group) => group.id === selection.provider)?.name ?? selection.provider} / ${model.name}`;
		}
		/** Label for "inherit": show the host's actual default route when it is known. */
		function defaultModelLabel(directory) {
			return directory?.defaultModel ? `DSH 默认：${routeLabel(directory, directory.defaultModel)}` : "DSH 默认";
		}
		/** Label for "inherit" preset: show the host's actual default preset when it is known. */
		function defaultPresetLabel(presets) {
			const preset = presets?.find((candidate) => candidate.isDefault);
			return preset ? `DSH 默认：${preset.name}` : "DSH 默认";
		}
		/** A catalog refresh resolves display labels only; a missing saved route stays selected. */
		function modelLabel(directory, selection) {
			if (selection.provider === "" && selection.model === "") return defaultModelLabel(directory);
			return routeLabel(directory, selection);
		}
		function presetLabel(presets, id) {
			if (id === "") return defaultPresetLabel(presets);
			const preset = presets?.find((candidate) => candidate.id === id);
			return preset === void 0 ? `${id}${presets === null ? "" : "（不可用）"}` : `${preset.name}${preset.broken === void 0 ? "" : "（不可用）"}`;
		}
		/**
		* The text one Workspace is labeled with. A Workspace still carrying the
		* automatic first-use title reads as the caller's localized default name; every
		* other title reads verbatim in every language. A title the user typed as
		* exactly {@link DEFAULT_WORKSPACE_DIRECTORY} is labeled as the default too;
		* nothing else depends on the distinction.
		* @param title - stored Workspace title.
		* @param localizedDefault - the default Workspace name in the active language.
		* @returns the title to display.
		*/
		function workspaceDisplayTitle(title, localizedDefault) {
			return title === "default-workspace" ? localizedDefault : title;
		}
		//#endregion
		//#region src/client/qq-controls.ts
		/** Public host menu and button semantics, shared by all QQ settings selectors. */
		function QQSelect({ label, value, onChange, options, placeholder = "请选择", disabled = false, onOpen }) {
			const [open, setOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (disabled) setOpen(false);
			}, [disabled]);
			const selected = options.find((option) => option.value === value);
			const missing = value !== "" && selected === void 0;
			const visible = selected?.label ?? (missing ? `${value}（当前值不可用）` : placeholder);
			const choices = missing ? [{
				value,
				label: visible,
				disabled: true
			}, ...options] : options;
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: open && !disabled,
				onClose: () => setOpen(false),
				portal: true,
				autoFocus: true,
				minWidthFromAnchor: true,
				className: "imqq-selectAnchor",
				listClassName: "imqq-selectMenu",
				selectedId: `option:${value}`,
				items: choices.length ? choices.map((option) => ({
					id: `option:${option.value}`,
					disabled: option.disabled,
					label: (0, react.createElement)("span", { className: "imqq-selectChoice" }, (0, react.createElement)("span", null, option.label), option.description ? (0, react.createElement)("span", { className: "imqq-selectDescription" }, option.description) : null)
				})) : [{
					id: "empty",
					label: "暂无可选项",
					disabled: true
				}],
				onSelect: (id) => {
					const option = options.find((item) => `option:${item.value}` === id);
					if (disabled || option === void 0 || option.disabled) return;
					onChange(option.value);
					setOpen(false);
				},
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					className: "imqq-select",
					disabled,
					"aria-label": `${label}：${visible}`,
					"aria-haspopup": "menu",
					"aria-expanded": open && !disabled,
					title: visible,
					onClick: () => {
						if (!open) onOpen?.();
						setOpen((current) => !current);
					}
				}, (0, react.createElement)("span", { className: "imqq-selectValue" }, visible), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 }))
			});
		}
		/** Callers supply common t('workspace.defaultName') from the standard locale seat. */
		function qqWorkspaceTitle(title, path, localizedDefault) {
			return workspaceDisplayTitle(title, localizedDefault) || path;
		}
		/** 统一的"工作目录"选择器：留空默认 → 各 DSH 工作区 → 添加工作区。三处（会话设置/新对话默认值/新建会话）共用。 */
		function WorkspaceCwdSelect({ value, workspaces, defaultCwd, defaultWorkspaceName = "默认工作区", disabled = false, label = "工作目录", onAddWorkspace, onChange }) {
			const ADD = "::add-workspace";
			const options = [
				{
					value: "",
					label: "不指定工作区（QQ 临时目录）",
					description: defaultCwd
				},
				...workspaces.map((ws) => ({
					value: ws.path,
					label: qqWorkspaceTitle(ws.title, ws.path, defaultWorkspaceName),
					description: ws.path
				})),
				...onAddWorkspace ? [{
					value: ADD,
					label: "＋ 添加工作区（选择文件夹…）"
				}] : []
			];
			const visible = value === "" || workspaces.some((ws) => ws.path === value) ? value : "";
			return (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, label), (0, react.createElement)(QQSelect, {
				label,
				value: visible,
				disabled,
				placeholder: "选择工作区",
				options,
				onChange: (id) => {
					if (id === ADD) {
						onAddWorkspace?.();
						return;
					}
					onChange(id);
				}
			}));
		}
		//#endregion
		//#region src/client/slash-command-list.ts
		/** 可折叠的斜杠命令清单：按 通用能力/QQ 内置 分组展示。会话设置表单与超管面板共用。 */
		function SlashCommandList({ commands }) {
			const visible = commands.filter((command) => command.hidden !== true);
			return (0, react.createElement)("details", { className: "imqc-cmdList" }, (0, react.createElement)("summary", null, `查看支持的斜杠命令（${visible.length} 个）`), visible.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "暂无可用命令。") : null, ...["agent", "qqbot"].map((category) => {
				const items = visible.filter((command) => command.category === category);
				if (items.length === 0) return null;
				return (0, react.createElement)("div", {
					className: "imqc-cmdGroup",
					key: category
				}, (0, react.createElement)("strong", null, category === "agent" ? "通用能力" : "QQ 内置"), ...items.map((command) => (0, react.createElement)("div", {
					className: "imqc-cmdRow",
					key: command.name
				}, (0, react.createElement)("code", null, `/${command.name}`), command.aliases.length ? (0, react.createElement)("span", { className: "imqc-hint" }, `（别名 /${command.aliases.join("、/")}）`) : null, (0, react.createElement)("span", { className: "imqc-hint" }, command.description))));
			}));
		}
		//#endregion
		//#region src/client/qq-agent-settings-form.ts
		const PERMISSIONS = [
			{
				value: "read-only",
				label: "仅可查看"
			},
			{
				value: "workspace-write",
				label: "工作区内修改"
			},
			{
				value: "danger-full-access",
				label: "完全权限"
			}
		];
		const CATEGORIES = {
			file: "文件",
			search: "搜索",
			network: "联网",
			execution: "命令与代码",
			mcp: "MCP",
			attachment: "附件与交付",
			other: "其他"
		};
		/** 只读工具模板：只勾选"不会改动文件/不执行命令"的只读工具，且仅对当前目录实际可用的工具生效。 */
		const TOOL_PRESETS = [{
			id: "read-files",
			label: "只读：文件与搜索",
			tools: [
				"skill",
				"read",
				"read_image",
				"grep",
				"glob",
				"qqbot_group_history"
			]
		}, {
			id: "read-web",
			label: "只读 + 网页",
			tools: [
				"skill",
				"read",
				"read_image",
				"grep",
				"glob",
				"qqbot_group_history",
				"web_search",
				"web_fetch"
			]
		}];
		/** 用户自建模板的本地存储键（按 store 维度不可用，模板是纯客户端偏好，存储在 localStorage）。 */
		const CUSTOM_PRESETS_KEY = "im-qqbot/tool-presets/v1";
		function loadCustomPresets() {
			try {
				const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CUSTOM_PRESETS_KEY);
				const parsed = raw === null ? null : JSON.parse(raw);
				if (!Array.isArray(parsed)) return [];
				return parsed.flatMap((item) => {
					if (item === null || typeof item !== "object") return [];
					const record = item;
					if (typeof record.id !== "string" || typeof record.label !== "string" || !Array.isArray(record.tools)) return [];
					return [{
						id: record.id,
						label: record.label,
						tools: record.tools.filter((tool) => typeof tool === "string")
					}];
				});
			} catch {
				return [];
			}
		}
		function saveCustomPresets(items) {
			try {
				if (typeof localStorage !== "undefined") {
					localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(items));
					return true;
				}
			} catch {}
			return false;
		}
		/** Draft fields only. The parent owns persistence, versions and conflict handling. */
		function QQAgentSettingsForm({ settings, tools, catalog, disabled = false, askTools = [], commands = [], onPickDirectory, workspaces = [], onCreateWorkspace, defaultWorkspaceName = "默认工作区", defaultCwd, scope = "conversation", chatScope = "group", onChange, onRefreshCatalog }) {
			const [cwdBusy, setCwdBusy] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [toolsOpen, setToolsOpen] = (0, react.useState)(false);
			const [toolGuideDismissed, setToolGuideDismissed] = (0, react.useState)(false);
			const [customPresets, setCustomPresets] = (0, react.useState)(() => loadCustomPresets());
			const [presetName, setPresetName] = (0, react.useState)("");
			const execution = settings.execution;
			const model = settings.model;
			const modelOptions = [{
				value: "inherit",
				label: defaultModelLabel(catalog.models)
			}];
			if (model && !findModel(catalog.models, model)) modelOptions.push({
				value: modelChoiceId(model),
				label: modelLabel(catalog.models, model),
				disabled: true
			});
			for (const group of catalog.models?.groups ?? []) for (const choice of group.models) modelOptions.push({
				value: modelChoiceId(choice),
				label: `${group.name} / ${choice.name}`,
				description: choice.description
			});
			const presetOptions = [{
				value: "",
				label: defaultPresetLabel(catalog.presets === null ? null : [...catalog.presets])
			}];
			if (settings.preset && !catalog.presets?.some((preset) => preset.id === settings.preset)) presetOptions.push({
				value: settings.preset,
				label: presetLabel(catalog.presets === null ? null : [...catalog.presets], settings.preset),
				disabled: true
			});
			for (const preset of catalog.presets ?? []) presetOptions.push({
				value: preset.id,
				label: `${preset.name}${preset.broken ? "（不可用）" : ""}`,
				description: preset.broken ?? preset.description,
				disabled: Boolean(preset.broken)
			});
			const selected = new Set(execution.kind === "custom" ? execution.tools : []);
			const search = query.trim().toLocaleLowerCase();
			const available = [...tools, ...[...selected].filter((id) => !tools.some((tool) => tool.id === id)).map((id) => ({
				id,
				name: id,
				description: "当前目录不可用，已保留原选择。",
				category: "other",
				constraint: "none",
				available: false
			}))];
			const [categoryFilter, setCategoryFilter] = (0, react.useState)(null);
			const [onlySelected, setOnlySelected] = (0, react.useState)(false);
			const [collapsedCats, setCollapsedCats] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const base0 = available.filter((tool) => `${tool.name} ${tool.id} ${tool.description}`.toLocaleLowerCase().includes(search));
			const visible = base0.filter((tool) => (categoryFilter === null || tool.category === categoryFilter) && (!onlySelected || selected.has(tool.id)));
			const categoryCounts = /* @__PURE__ */ new Map();
			for (const tool of base0) {
				const entry = categoryCounts.get(tool.category) ?? {
					total: 0,
					chosen: 0
				};
				entry.total += 1;
				if (selected.has(tool.id)) entry.chosen += 1;
				categoryCounts.set(tool.category, entry);
			}
			const toggleCategory = (category) => {
				const groupIds = available.filter((tool) => tool.category === category && tool.available).map((tool) => tool.id);
				const allChosen = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
				setTools(allChosen ? [...selected].filter((id) => !groupIds.includes(id)) : [...selected, ...groupIds]);
			};
			const toggleCollapsed = (category) => setCollapsedCats((prev) => {
				const next = new Set(prev);
				if (next.has(category)) next.delete(category);
				else next.add(category);
				return next;
			});
			const setExecution = (next) => onChange({
				...settings,
				execution: next
			});
			const setTools = (values) => setExecution({
				kind: "custom",
				permission: execution.permission,
				tools: [...new Set(values)].sort()
			});
			const persistCustomPresets = (next) => {
				setCustomPresets(next);
				saveCustomPresets(next);
			};
			const currentChoice = model ? findModel(catalog.models, model) : catalog.models?.defaultModel ? findModel(catalog.models, catalog.models.defaultModel) : void 0;
			const effortOptions = (currentChoice?.efforts ?? []).map((effort) => ({
				value: effort.id,
				label: effort.name,
				...effort.description === void 0 ? {} : { description: effort.description }
			}));
			const showEffort = effortOptions.length > 0;
			const selectedEffort = (model ? model.reasoningEffort : settings.reasoningEffort) ?? currentChoice?.defaultEffort ?? effortOptions[0]?.value ?? "";
			const setModelWithEffort = (next) => {
				if (next === null) {
					onChange({
						...settings,
						model: null
					});
					return;
				}
				const choice = findModel(catalog.models, next);
				const efforts = choice?.efforts ?? [];
				const effort = next.reasoningEffort ?? choice?.defaultEffort ?? efforts[0]?.id;
				onChange({
					...settings,
					model: {
						provider: next.provider,
						model: next.model,
						...effort ? { reasoningEffort: effort } : {}
					}
				});
			};
			const setEffort = (effort) => {
				if (model) onChange({
					...settings,
					model: {
						...model,
						reasoningEffort: effort
					}
				});
				else onChange({
					...settings,
					reasoningEffort: effort
				});
			};
			return (0, react.createElement)("div", { className: "imqc-agentSettings" }, (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, "模型"), (0, react.createElement)(QQSelect, {
				label: "模型",
				value: model ? modelChoiceId(model) : "inherit",
				options: modelOptions,
				disabled,
				onOpen: onRefreshCatalog,
				onChange: (value) => {
					if (value === "inherit") {
						onChange({
							...settings,
							model: null
						});
						return;
					}
					const choice = catalog.models?.groups.flatMap((group) => group.models).find((candidate) => modelChoiceId(candidate) === value);
					if (choice) setModelWithEffort({
						provider: choice.provider,
						model: choice.model
					});
				}
			})), showEffort ? (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, "推理强度"), (0, react.createElement)(QQSelect, {
				label: "推理强度",
				value: selectedEffort,
				options: effortOptions,
				disabled,
				onChange: setEffort
			})) : null, (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, "Agent 预设"), (0, react.createElement)(QQSelect, {
				label: "Agent 预设",
				value: settings.preset,
				options: presetOptions,
				disabled,
				onOpen: onRefreshCatalog,
				onChange: (preset) => onChange({
					...settings,
					preset
				})
			})), (0, react.createElement)("p", { className: "imqc-hint" }, "Agent 预设决定使用哪个 Agent；执行权限决定该 Agent 可执行的操作。"), (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, "执行权限"), (0, react.createElement)(QQSelect, {
				label: "执行权限",
				value: execution.kind === "custom" ? "custom" : execution.permission,
				disabled,
				options: [...PERMISSIONS, {
					value: "custom",
					label: "自定义工具"
				}],
				onChange: (value) => {
					if (value === "custom") {
						setExecution({
							kind: "custom",
							permission: execution.permission,
							tools: []
						});
						return;
					}
					const permission = PERMISSIONS.find((item) => item.value === value)?.value;
					if (permission) setExecution({
						kind: "native",
						permission
					});
				}
			})), execution.kind === "native" ? (0, react.createElement)("p", { className: "imqc-hint" }, "使用所选 Agent 的实际工具，并遵循 DSH 原生权限。") : (0, react.createElement)("section", {
				className: "imqc-fieldset imqc-customTools",
				"aria-label": scope === "defaults" ? "允许的工具（新对话默认）" : "本对话允许的工具"
			}, (0, react.createElement)("div", { className: "imqc-fieldsetTitle" }, scope === "defaults" ? "允许的工具（新对话默认）" : "本对话允许的工具"), !toolGuideDismissed ? (0, react.createElement)("div", { className: "imqc-toolGuide" }, (0, react.createElement)("p", null, scope === "defaults" ? "这里的勾选只决定之后新接入对话的初始工具；已接入的对话各自独立。" : "这里的勾选只对当前这个群/联系人生效，其它群各自独立。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => setToolGuideDismissed(true)
			}, "知道了")) : null, (0, react.createElement)("p", { className: "imqc-hint" }, "只开放下方勾选的工具；基础权限是这些工具之上的上限，文件、命令和网络操作仍受其限制，已有额外审批规则保留。"), (0, react.createElement)("div", { className: "imqc-presets" }, (0, react.createElement)("span", { className: "imqc-hint" }, "快速模板："), (0, react.createElement)("div", { className: "imqc-inline" }, ...TOOL_PRESETS.map((preset) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: preset.id,
				variant: "outline",
				size: "sm",
				disabled,
				onClick: () => setTools(preset.tools.filter((id) => available.some((tool) => tool.id === id && tool.available)))
			}, preset.label)), ...customPresets.map((preset) => (0, react.createElement)("span", {
				className: "imqc-presetUser",
				key: preset.id
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled,
				onClick: () => setTools(preset.tools.filter((id) => available.some((tool) => tool.id === id && tool.available)))
			}, preset.label), (0, react.createElement)("button", {
				type: "button",
				className: "imqc-presetDel",
				"aria-label": `删除模板 ${preset.label}`,
				disabled,
				onClick: () => persistCustomPresets(customPresets.filter((item) => item.id !== preset.id))
			}, "×")))), (0, react.createElement)("div", { className: "imqc-inline imqc-presetSave" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: presetName,
				disabled,
				placeholder: "把当前选择存为模板…",
				"aria-label": "新模板名称",
				onChange: (event) => setPresetName(event.target.value)
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: disabled || selected.size === 0 || presetName.trim() === "",
				onClick: () => {
					const label = presetName.trim();
					if (!label) return;
					persistCustomPresets([...customPresets, {
						id: `u${Date.now()}`,
						label,
						tools: [...selected].sort()
					}]);
					setPresetName("");
				}
			}, "存为模板"))), (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, "基础上限"), (0, react.createElement)(QQSelect, {
				label: "自定义工具的基础权限",
				value: execution.permission,
				options: PERMISSIONS,
				disabled,
				onChange: (value) => {
					const permission = PERMISSIONS.find((item) => item.value === value)?.value;
					if (permission) setExecution({
						...execution,
						permission
					});
				}
			})), (0, react.createElement)("div", { className: "imqc-field" }, (0, react.createElement)("span", null, `已允许的工具（${selected.size}）`), selected.size === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "尚未允许任何工具。点“选择工具”勾选。") : (0, react.createElement)("div", { className: "imqc-toolGrid imqc-selectedTools" }, ...available.filter((tool) => selected.has(tool.id)).map((tool) => (0, react.createElement)("div", {
				className: "imqc-toolRow imqc-toolRowStatic",
				key: tool.id,
				title: tool.description || void 0
			}, (0, react.createElement)("span", { className: "imqc-toolRowBody" }, (0, react.createElement)("span", { className: "imqc-toolRowName" }, tool.name, tool.id !== tool.name ? (0, react.createElement)("small", { className: "imqc-hint" }, tool.id) : null), tool.description ? (0, react.createElement)("span", { className: "imqc-toolRowDesc" }, tool.description) : null), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				className: "imqc-toolRemove",
				disabled,
				"aria-label": `移除${tool.name}`,
				onClick: () => setTools([...selected].filter((id) => id !== tool.id))
			}, "移除"))))), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled,
				onClick: () => setToolsOpen(true)
			}, `选择工具（已选 ${selected.size} 项）`), toolsOpen ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: "选择可用工具",
				closeLabel: "关闭工具选择",
				className: "imqc-toolModal",
				onClose: () => setToolsOpen(false),
				children: (0, react.createElement)("div", { className: "imqc imqc-toolPicker" }, (0, react.createElement)("div", { className: "imqc-toolPickerBar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					type: "search",
					value: query,
					disabled,
					placeholder: "搜索工具名称或标识",
					"aria-label": "搜索工具",
					onChange: (event) => setQuery(event.target.value)
				}), (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("span", { className: "imqc-hint" }, `已选 ${selected.size} 项`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: disabled || !visible.some((tool) => tool.available),
					onClick: () => setTools([...selected, ...visible.filter((tool) => tool.available).map((tool) => tool.id)])
				}, "全选当前筛选"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: disabled || selected.size === 0,
					onClick: () => setTools([])
				}, "清空选择"))), (0, react.createElement)("div", { className: "imqc-chips" }, (0, react.createElement)("span", { className: "imqc-hint" }, "分类："), ...Object.entries(CATEGORIES).filter(([category]) => (categoryCounts.get(category)?.total ?? 0) > 0).map(([category, label]) => {
					const count = categoryCounts.get(category);
					return (0, react.createElement)("button", {
						type: "button",
						key: category,
						className: "imqc-chip",
						"data-active": categoryFilter === category || void 0,
						onClick: () => setCategoryFilter(categoryFilter === category ? null : category)
					}, `${label} ${count?.chosen ?? 0}/${count?.total ?? 0}`);
				}), (0, react.createElement)("label", { className: "imqc-onlySelected" }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: onlySelected,
					disabled,
					onChange: (event) => setOnlySelected(event.target.checked)
				}), (0, react.createElement)("span", null, "仅看已选"))), (0, react.createElement)("div", { className: "imqc-toolChoices" }, ...Object.entries(CATEGORIES).map(([category, label]) => ({
					category,
					label,
					tools: visible.filter((tool) => tool.category === category)
				})).filter((group) => group.tools.length).map((group) => (0, react.createElement)("section", {
					key: group.category,
					className: "imqc-toolGroup"
				}, (0, react.createElement)("div", { className: "imqc-toolGroupHead" }, (0, react.createElement)("button", {
					type: "button",
					className: "imqc-toolGroupToggle",
					"aria-expanded": !collapsedCats.has(group.category),
					onClick: () => toggleCollapsed(group.category)
				}, collapsedCats.has(group.category) ? "▸" : "▾", (0, react.createElement)("strong", null, group.label)), (0, react.createElement)("button", {
					type: "button",
					className: "imqc-toolGroupAll",
					disabled,
					onClick: () => toggleCategory(group.category)
				}, "全选本类")), !collapsedCats.has(group.category) ? (0, react.createElement)("div", { className: "imqc-toolGrid" }, ...group.tools.map((tool) => {
					const isOn = selected.has(tool.id);
					return (0, react.createElement)("label", {
						className: "imqc-toolRow",
						key: tool.id,
						"data-on": isOn || void 0,
						"data-off": !tool.available && !isOn || void 0,
						title: tool.description || void 0
					}, (0, react.createElement)("input", {
						type: "checkbox",
						className: "imqc-toolRowInput",
						checked: isOn,
						disabled: disabled || !tool.available && !isOn,
						onChange: (event) => setTools(event.target.checked ? [...selected, tool.id] : [...selected].filter((id) => id !== tool.id))
					}), (0, react.createElement)("span", { className: "imqc-toolRowBody" }, (0, react.createElement)("span", { className: "imqc-toolRowName" }, tool.name, tool.id !== tool.name ? (0, react.createElement)("small", { className: "imqc-hint" }, tool.id) : null), tool.description ? (0, react.createElement)("span", { className: "imqc-toolRowDesc" }, tool.description) : null, (!tool.available ? (0, react.createElement)("small", { className: "imqc-hint" }, tool.reason ?? "当前不可用") : null) ?? null, askTools.includes(tool.id) ? (0, react.createElement)("small", { className: "imqc-hint" }, "需额外审批") : null));
				})) : null))), visible.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, onlySelected ? "还没有勾选任何工具。" : "没有匹配的工具。") : null, (0, react.createElement)("div", { className: "imqc-actions imqc-toolPickerFoot" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					onClick: () => setToolsOpen(false)
				}, "完成选择")))
			}) : null), (() => {
				const pickFolder = () => {
					if (!onPickDirectory) return;
					setCwdBusy(true);
					onPickDirectory().then(async (path) => {
						if (!path) return;
						if (onCreateWorkspace) try {
							const ws = await onCreateWorkspace(path);
							onChange({
								...settings,
								cwd: ws.path
							});
							return;
						} catch {}
						onChange({
							...settings,
							cwd: path
						});
					}).catch(() => {}).finally(() => setCwdBusy(false));
				};
				return (0, react.createElement)(WorkspaceCwdSelect, {
					value: settings.cwd,
					workspaces,
					defaultCwd,
					defaultWorkspaceName,
					disabled: disabled || cwdBusy,
					onAddWorkspace: onPickDirectory || onCreateWorkspace ? pickFolder : void 0,
					onChange: (path) => onChange({
						...settings,
						cwd: path
					})
				});
			})(), (() => {
				const field = (key, label) => (0, react.createElement)("label", {
					className: "imqc-field",
					key
				}, (0, react.createElement)("span", null, label), (0, react.createElement)("textarea", {
					rows: 4,
					value: settings[key],
					disabled,
					maxLength: 2e4,
					"aria-label": label,
					onChange: (event) => onChange({
						...settings,
						[key]: event.target.value
					})
				}));
				return scope === "defaults" ? [field("promptGroup", "群聊补充提示词"), field("promptDirect", "私聊补充提示词")] : chatScope === "group" ? field("promptGroup", "群聊补充提示词") : field("promptDirect", "私聊补充提示词");
			})(), (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("span", null, "斜杠命令"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label: "斜杠命令",
				checked: settings.slashCommands,
				disabled,
				onChange: (slashCommands) => onChange({
					...settings,
					slashCommands
				})
			})), (0, react.createElement)("p", { className: "imqc-hint" }, "关闭后，普通用户的 / 命令返回停用提示；机器人所有者仍可使用命令。"), (0, react.createElement)(SlashCommandList, { commands }), catalog.loading ? (0, react.createElement)("p", {
				role: "status",
				className: "imqc-hint"
			}, "正在读取宿主模型和 Agent 预设目录…") : null, [...catalog.errors, ...catalog.models?.failures ?? []].map((error, index) => (0, react.createElement)("p", {
				key: index,
				role: "alert",
				className: "imqc-error"
			}, error)), catalog.errors.length ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: disabled || catalog.loading,
				onClick: onRefreshCatalog
			}, "重试读取宿主目录") : null);
		}
		//#endregion
		//#region src/client/qq-agent-catalog.ts
		function useQQAgentCatalog(source) {
			const [value, setValue] = (0, react.useState)({
				models: null,
				presets: null,
				loading: true,
				errors: []
			});
			const [attempt, setAttempt] = (0, react.useState)(0);
			const generation = (0, react.useRef)(0);
			const refresh = (0, react.useCallback)(() => setAttempt((current) => current + 1), []);
			(0, react.useEffect)(() => {
				const request = ++generation.current;
				setValue((current) => ({
					...current,
					loading: true,
					errors: []
				}));
				const timeout = setTimeout(() => {
					if (generation.current !== request) return;
					generation.current += 1;
					setValue((current) => ({
						...current,
						loading: false,
						errors: ["宿主目录请求超时，请重试。"]
					}));
				}, 1e4);
				Promise.allSettled([source ? Promise.resolve().then(() => source.modelCatalog()).then(parseModelCatalog) : Promise.reject(/* @__PURE__ */ new Error("宿主模型目录暂不可用。")), source ? Promise.resolve().then(() => source.listAgentPresets()).then(parseAgentPresets) : Promise.reject(/* @__PURE__ */ new Error("宿主 Agent 预设目录暂不可用。"))]).then(([models, presets]) => {
					if (generation.current !== request) return;
					clearTimeout(timeout);
					setValue((current) => ({
						models: models.status === "fulfilled" ? models.value : current.models,
						presets: presets.status === "fulfilled" ? presets.value : current.presets,
						loading: false,
						errors: [models, presets].flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "宿主目录读取失败。"] : [])
					}));
				});
				return () => {
					generation.current += 1;
					clearTimeout(timeout);
				};
			}, [source, attempt]);
			return {
				...value,
				refresh
			};
		}
		//#endregion
		//#region src/shared/runtime-protocol.ts
		/** Read-only runtime snapshot shared by the Host and the QQ sidebar. */
		const RUNTIME_STATE_PATH = "/qqbot/im-qqbot/runtime";
		//#endregion
		//#region src/shared/conversation-protocol.ts
		const CONVERSATIONS_PATH = "/qqbot/im-qqbot/conversations";
		//#endregion
		//#region src/client/conversation-api.ts
		async function conversationAction(action) {
			return fetchJson(CONVERSATIONS_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(action)
			}, 15e3);
		}
		async function sendConversationAnswer(action) {
			return fetchJson(CONVERSATIONS_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(action)
			}, 15e3);
		}
		//#endregion
		//#region src/client/conversation-state.ts
		function conversationName(entry) {
			return entry.alias || entry.name || `${entry.scope === "group" ? "群聊" : "私聊"} · ${entry.peerId.slice(-8)}`;
		}
		//#endregion
		//#region src/client/qq-session-store.ts
		/** 侧栏浏览态的 localStorage 键（展开/收起/选中/折叠）。 */
		const SIDEBAR_STORAGE_KEY = "im-qqbot/sidebar/v1";
		/** One directory subscription serves the directory, row decorations and Session actions. */
		var QQSessionStore = class {
			navigation;
			state = {
				directory: null,
				runtime: null,
				loading: true,
				error: null,
				overlay: null,
				deliveryRevision: 0,
				deliveries: {},
				sidebar: {
					sidebarMode: "workspace",
					selectedSessionId: null,
					expandedPeers: [],
					collapsedScopes: [],
					showAllPeers: [],
					search: ""
				}
			};
			listeners = /* @__PURE__ */ new Set();
			sessions = /* @__PURE__ */ new Map();
			request = 0;
			refreshDirectory;
			navigate;
			navigationGeneration = 0;
			constructor(navigation) {
				this.navigation = navigation;
				this.state = {
					...this.state,
					sidebar: {
						...this.state.sidebar,
						...this.loadSidebar()
					}
				};
			}
			/** 读取持久化的侧栏浏览态（刷新后保留展开/收起/选中/折叠/搜索）。 */
			loadSidebar() {
				try {
					const raw = globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY);
					if (!raw) return {};
					const value = JSON.parse(raw);
					return {
						...Array.isArray(value.expandedPeers) ? { expandedPeers: value.expandedPeers.filter((x) => typeof x === "string") } : {},
						...Array.isArray(value.collapsedScopes) ? { collapsedScopes: value.collapsedScopes.filter((x) => x === "group" || x === "c2c") } : {},
						...Array.isArray(value.showAllPeers) ? { showAllPeers: value.showAllPeers.filter((x) => typeof x === "string") } : {},
						...typeof value.selectedSessionId === "string" || value.selectedSessionId === null ? { selectedSessionId: value.selectedSessionId } : {}
					};
				} catch {
					return {};
				}
			}
			saveSidebar() {
				try {
					const s = this.state.sidebar;
					globalThis.localStorage?.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({
						expandedPeers: s.expandedPeers,
						collapsedScopes: s.collapsedScopes,
						showAllPeers: s.showAllPeers,
						selectedSessionId: s.selectedSessionId
					}));
				} catch {}
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			getSnapshot = () => this.state;
			update(change) {
				this.state = {
					...this.state,
					...change
				};
				for (const listener of this.listeners) listener();
			}
			updateSidebar(change) {
				this.update({ sidebar: {
					...this.state.sidebar,
					...change
				} });
				this.saveSidebar();
			}
			setSidebarMode(sidebarMode) {
				if (this.state.sidebar.sidebarMode !== sidebarMode) {
					this.cancelNavigation();
					this.updateSidebar({ sidebarMode });
				}
			}
			cancelNavigation() {
				this.navigationGeneration += 1;
			}
			navigationIntent() {
				const generation = this.navigationGeneration;
				let active = true;
				return {
					current: () => active && generation === this.navigationGeneration,
					cancel: () => {
						active = false;
					}
				};
			}
			openActionResult(intent, result, key) {
				if (!intent.current()) return "superseded";
				const id = result.sessionId ?? result.snapshot?.conversations.find((entry) => entry.key === key)?.currentSessionId;
				if (!id) return "unavailable";
				this.openSession(id);
				return "opened";
			}
			selectSession(sessionId, options = {}) {
				const entry = this.entry(sessionId);
				if (!entry) return;
				const sidebar = this.state.sidebar;
				const historical = sessionId !== entry.currentSessionId;
				const reveal = historical && options.revealHistory !== false;
				this.updateSidebar({
					selectedSessionId: sessionId,
					expandedPeers: reveal && !sidebar.expandedPeers.includes(entry.key) ? [...sidebar.expandedPeers, entry.key] : sidebar.expandedPeers,
					search: historical && sessionId !== sidebar.selectedSessionId && !options.preserveVisibleFilter ? "" : sidebar.search,
					collapsedScopes: sidebar.collapsedScopes.filter((scope) => scope !== entry.scope)
				});
			}
			resumeSessionId() {
				const selected = this.state.sidebar.selectedSessionId;
				if (selected && this.entry(selected)) return selected;
				return [...this.state.directory?.conversations ?? []].sort((a, b) => b.lastActivity - a.lastActivity).find((entry) => entry.admitted && entry.currentSessionId)?.currentSessionId ?? null;
			}
			/** 最近可继续的会话及其对话名称（欢迎页"继续会话"入口用，便于显示跳到哪个群/私聊）。 */
			resumeTarget() {
				const sessionId = this.resumeSessionId();
				if (!sessionId) return null;
				const entry = this.entry(sessionId);
				return entry ? {
					sessionId,
					name: conversationName(entry)
				} : null;
			}
			togglePeer(key) {
				this.updateSidebar({ expandedPeers: toggleValue(this.state.sidebar.expandedPeers, key) });
			}
			toggleScope(scope) {
				this.updateSidebar({ collapsedScopes: toggleValue(this.state.sidebar.collapsedScopes, scope) });
			}
			/** 切换某 peer 的完整历史会话列表展开/收起（列表底部按钮）。 */
			showAllSessions(key) {
				this.updateSidebar({ showAllPeers: toggleValue(this.state.sidebar.showAllPeers, key) });
			}
			setSearch(search) {
				this.updateSidebar({ search });
			}
			installNavigation(navigate) {
				this.navigate = navigate;
				return () => {
					if (this.navigate === navigate) this.navigate = void 0;
				};
			}
			entry(sessionId) {
				return this.sessions.get(sessionId);
			}
			conversation(key) {
				return this.state.directory?.conversations.find((entry) => entry.key === key);
			}
			accept(directory) {
				this.request += 1;
				this.sessions.clear();
				for (const entry of directory.conversations) {
					for (const session of entry.sessions) this.sessions.set(session.sessionId, entry);
					if (entry.currentSessionId) this.sessions.set(entry.currentSessionId, entry);
				}
				this.update({
					directory,
					loading: false,
					error: null
				});
			}
			refresh = () => {
				this.refreshDirectory?.();
			};
			start() {
				const controller = new AbortController();
				const read = async () => {
					const request = ++this.request;
					this.update({ loading: true });
					try {
						const [directory, runtime] = await Promise.all([fetchJson(CONVERSATIONS_PATH, {
							cache: "no-store",
							signal: controller.signal
						}), fetchJson(RUNTIME_STATE_PATH, {
							cache: "no-store",
							signal: controller.signal
						}).catch(() => null)]);
						if (!Array.isArray(directory.conversations) || !Array.isArray(directory.tools) || !Array.isArray(directory.ownerIds)) throw new Error("会话目录返回格式无效");
						if (!controller.signal.aborted && request === this.request) {
							this.accept(directory);
							if (runtime) this.update({ runtime });
						}
					} catch (cause) {
						if (controller.signal.aborted || request !== this.request) return;
						const message = cause instanceof Error ? cause.message : "无法读取 QQ 会话";
						if (/404/.test(message)) {
							this.accept({
								conversations: [],
								tools: [],
								ownerIds: []
							});
							return;
						}
						this.update({
							loading: false,
							error: message
						});
					}
				};
				this.refreshDirectory = () => {
					read();
				};
				read();
				const timer = setInterval(() => {
					read();
				}, 1e4);
				return () => {
					controller.abort();
					this.request += 1;
					this.refreshDirectory = void 0;
					clearInterval(timer);
				};
			}
			open(entry) {
				if (entry.admitted && entry.currentSessionId) this.openSession(entry.currentSessionId);
				else this.openDrawer(entry);
			}
			openSession(sessionId, options = {}) {
				if (!sessionId) return;
				this.cancelNavigation();
				this.selectSession(sessionId, options);
				if (this.navigate) this.navigate(sessionId);
				else this.navigation.openSession(SessionId(sessionId));
			}
			openDrawer(entry, tab = "settings", sessionId = entry.currentSessionId) {
				this.cancelNavigation();
				this.update({ overlay: {
					kind: "drawer",
					target: {
						key: entry.key,
						sessionId,
						name: conversationName(entry),
						tab
					}
				} });
			}
			closeDrawer = () => {
				this.cancelNavigation();
				this.update({ overlay: null });
			};
			openOperation(entry, kind = "newSession") {
				if (kind === "alias") {
					this.openDrawer(entry);
					return;
				}
				this.cancelNavigation();
				const target = {
					kind: "newSession",
					key: entry.key,
					name: conversationName(entry),
					sessionId: entry.currentSessionId,
					workspaceId: entry.currentWorkspace?.id ?? entry.workspaceId ?? null,
					policyVersion: entry.policy.version,
					presetId: entry.nextPreset ?? entry.currentPreset
				};
				this.update({ overlay: {
					kind: "operation",
					target
				} });
			}
			previewAnswer(sessionId, messageId, text) {
				const entry = this.entry(sessionId);
				if (!entry?.admitted || entry.currentSessionId !== sessionId || !text.trim()) return;
				this.cancelNavigation();
				this.update({ overlay: {
					kind: "answer",
					preview: {
						key: entry.key,
						sessionId,
						messageId,
						name: conversationName(entry),
						text,
						operationId: crypto.randomUUID()
					}
				} });
			}
			closePreview = () => {
				this.update({ overlay: null });
			};
			canSend(preview) {
				const entry = this.conversation(preview.key);
				return Boolean(entry?.admitted && entry.currentSessionId === preview.sessionId);
			}
			async sendAnswer(preview) {
				if (!this.canSend(preview)) throw new Error("此 QQ 会话的授权或当前映射已变化");
				const result = await sendConversationAnswer({
					action: "send",
					key: preview.key,
					operationId: preview.operationId,
					text: preview.text,
					sourceSessionId: preview.sessionId,
					sourceMessageId: preview.messageId
				});
				if (result.delivery) this.acceptDelivery(result.delivery);
				if (result.snapshot) this.accept(result.snapshot);
				else this.refresh();
				return result;
			}
			async perform(action) {
				const result = await conversationAction(action);
				if (action.action === "deliveries" && result.deliveries) this.update({ deliveries: {
					...this.state.deliveries,
					[action.key]: result.deliveries
				} });
				if (result.snapshot) this.accept(result.snapshot);
				else if (action.action !== "deliveries" && action.action !== "messages" && action.action !== "timeline") this.refresh();
				return result;
			}
			acceptDelivery(delivery) {
				const previous = this.state.deliveries[delivery.key] ?? [];
				this.update({
					deliveryRevision: this.state.deliveryRevision + 1,
					deliveries: {
						...this.state.deliveries,
						[delivery.key]: [delivery, ...previous.filter((item) => item.id !== delivery.id)]
					}
				});
			}
		};
		function toggleValue(values, value) {
			return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
		}
		function useQQSessionStore(store) {
			return (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
		}
		//#endregion
		//#region src/client/qq-defaults-settings.ts
		const drafts$1 = /* @__PURE__ */ new WeakMap();
		function QQDefaultsSettings({ store, selectorSource, t, workspaces = [], defaultWorkspaceName }) {
			const state = useQQSessionStore(store);
			const defaults = state.directory?.defaults;
			if (!defaults) return (0, react.createElement)("section", {
				className: "imqc",
				"aria-label": "新对话默认设置"
			}, (0, react.createElement)("h3", null, "新对话默认设置"), (0, react.createElement)("p", {
				role: state.error ? "alert" : "status",
				className: state.error ? "imqc-error" : "imqc-hint"
			}, state.error ?? "正在读取新对话默认设置…"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: state.loading,
				onClick: store.refresh
			}, "刷新默认设置"));
			return (0, react.createElement)(DefaultsSettingsDraft, {
				store,
				selectorSource,
				defaults,
				t,
				workspaces,
				defaultWorkspaceName,
				tools: state.directory?.tools ?? [],
				commands: state.directory?.commands ?? []
			});
		}
		function DefaultsSettingsDraft({ store, selectorSource, defaults, t, tools, commands, workspaces = [], defaultWorkspaceName }) {
			const [retained, setRetained] = (0, react.useState)(() => drafts$1.get(store) ?? {
				draft: structuredClone(defaults),
				base: structuredClone(defaults)
			});
			const { draft, base } = retained;
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const pending = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			const catalog = useQQAgentCatalog(selectorSource);
			const dirty = JSON.stringify(draft.settings) !== JSON.stringify(base.settings);
			const conflict = base.version !== defaults.version;
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (dirty) drafts$1.set(store, retained);
				else drafts$1.delete(store);
			}, [
				store,
				retained,
				dirty
			]);
			(0, react.useEffect)(() => {
				if (!dirty && conflict) setRetained({
					draft: structuredClone(defaults),
					base: structuredClone(defaults)
				});
			}, [
				dirty,
				conflict,
				defaults
			]);
			const discard = () => {
				setRetained({
					draft: structuredClone(defaults),
					base: structuredClone(defaults)
				});
				drafts$1.delete(store);
				setError("");
				setNotice("");
			};
			const save = () => {
				if (pending.current || !dirty || conflict) return;
				pending.current = true;
				setBusy(true);
				setError("");
				setNotice("");
				store.perform({
					action: "defaults",
					expectedVersion: base.version,
					settings: draft.settings
				}).then((result) => {
					const saved = result.snapshot?.defaults;
					if (!saved) throw new Error("保存结果未确认，草稿已保留。请刷新默认设置核对。");
					drafts$1.delete(store);
					if (mounted.current) {
						setRetained({
							draft: structuredClone(saved),
							base: structuredClone(saved)
						});
						setNotice("新对话默认设置已保存，已接入的对话保持各自设置。");
					}
				}).catch((cause) => {
					if (mounted.current) setError(cause instanceof Error ? cause.message : "默认设置保存失败，草稿已保留。");
				}).finally(() => {
					pending.current = false;
					if (mounted.current) setBusy(false);
				});
			};
			const ttl = t ? t("defaults.title") : "新对话默认值";
			return (0, react.createElement)("section", {
				className: "imqc imqc-defaultsSettings",
				"aria-label": ttl,
				"aria-busy": busy
			}, (0, react.createElement)("h3", { className: "imqb-cardTitle" }, ttl), (0, react.createElement)("p", { className: "imqb-cardHint" }, t ? t("defaults.hint") : "之后首次接入的群聊和私聊复制这些设置。保存立即生效，不改动已接入的对话，也不会重载插件。"), (0, react.createElement)(QQAgentSettingsForm, {
				settings: draft.settings,
				tools,
				catalog,
				commands,
				scope: "defaults",
				onPickDirectory: selectorSource.pickDirectory,
				onCreateWorkspace: selectorSource.createWorkspace,
				workspaces,
				defaultWorkspaceName,
				defaultCwd: store.getSnapshot().directory?.defaultCwd,
				disabled: busy,
				onRefreshCatalog: catalog.refresh,
				onChange: (settings) => {
					setRetained((value) => ({
						...value,
						draft: {
							...value.draft,
							settings
						}
					}));
					setError("");
					setNotice("");
				}
			}), conflict && dirty ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, "默认设置已在其他位置更新。草稿保留，请放弃修改以载入最新设置。") : null, error ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, error) : null, notice ? (0, react.createElement)("p", {
				role: "status",
				className: "imqc-hint"
			}, notice) : null, (0, react.createElement)("div", { className: "imqc-actions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || !dirty,
				onClick: discard
			}, "放弃默认设置修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy || !dirty || conflict,
				onClick: save
			}, busy ? "保存中…" : t ? t("defaults.save") : "保存默认设置（即时生效）")));
		}
		//#endregion
		//#region src/client/qq-peer-settings.ts
		const drafts = /* @__PURE__ */ new Map();
		function current(entry, settings) {
			return {
				version: entry.policy.version,
				settings: structuredClone(settings),
				alias: entry.alias,
				receiveEnabled: entry.policy.receiveEnabled !== false
			};
		}
		function settingsChanged(base, draft) {
			return base.alias !== draft.alias || base.receiveEnabled !== draft.receiveEnabled || JSON.stringify(base.settings) !== JSON.stringify(draft.settings);
		}
		function QQPeerSettings({ entry, store, tools, commands = [], selectorSource, t, workspaces = [], defaultWorkspaceName, defaultCwd }) {
			if (!entry.settings) return (0, react.createElement)("p", {
				role: "status",
				className: "imqc-hint"
			}, "会话设置暂不可用，请刷新 QQ 目录。");
			return (0, react.createElement)(PeerSettingsDraft, {
				key: entry.key,
				entry,
				settings: entry.settings,
				store,
				tools,
				commands,
				selectorSource,
				t,
				workspaces,
				defaultWorkspaceName,
				defaultCwd
			});
		}
		function PeerSettingsDraft({ entry, settings, store, tools, commands = [], selectorSource, t, workspaces = [], defaultWorkspaceName, defaultCwd }) {
			const [retained, setRetained] = (0, react.useState)(() => drafts.get(entry.key) ?? (() => {
				const draft = current(entry, settings);
				return {
					draft,
					base: draft
				};
			})());
			const { draft, base } = retained;
			const catalog = useQQAgentCatalog(selectorSource);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const pending = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			const dirty = settingsChanged(base, draft);
			const settingsConflict = base.version !== entry.policy.version;
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (dirty) drafts.set(entry.key, retained);
				else drafts.delete(entry.key);
			}, [
				entry.key,
				retained,
				dirty
			]);
			(0, react.useEffect)(() => {
				if (!dirty && settingsConflict) {
					const value = current(entry, settings);
					setRetained({
						draft: value,
						base: value
					});
				}
			}, [
				dirty,
				settingsConflict,
				entry,
				settings
			]);
			const patch = (next) => {
				setRetained((value) => ({
					...value,
					draft: {
						...value.draft,
						...next
					}
				}));
				setError("");
				setNotice("");
			};
			const discard = () => {
				const value = current(entry, settings);
				setRetained({
					draft: value,
					base: value
				});
				drafts.delete(entry.key);
				setError("");
				setNotice("");
			};
			const clearRecords = () => {
				if (pending.current) return;
				if (typeof window !== "undefined" && !window.confirm("确定清空此对话的全部消息记录？此操作不可撤销（不影响 QQ 会话与去重）。")) return;
				pending.current = true;
				setBusy(true);
				setError("");
				setNotice("");
				store.perform({
					action: "clear-records",
					key: entry.key,
					expectedRecordingVersion: entry.recording?.version ?? 0
				}).then(() => {
					if (mounted.current) setNotice("消息记录已清空。");
				}).catch((cause) => {
					if (mounted.current) setError(cause instanceof Error ? cause.message : "清空失败");
				}).finally(() => {
					pending.current = false;
					if (mounted.current) setBusy(false);
				});
			};
			const admit = () => {
				if (pending.current) return;
				pending.current = true;
				setBusy(true);
				setError("");
				setNotice("");
				store.perform({
					action: "admit",
					key: entry.key,
					enabled: true
				}).then((result) => {
					if (mounted.current) setNotice(result.notice ?? "接入规则已保存，请等待目录确认接收状态。");
				}).catch((cause) => {
					if (mounted.current) setError(cause instanceof Error ? cause.message : "接入规则保存失败");
				}).finally(() => {
					pending.current = false;
					if (mounted.current) setBusy(false);
				});
			};
			const save = () => {
				if (pending.current || !dirty || entry.running || settingsConflict) return;
				pending.current = true;
				setBusy(true);
				setError("");
				setNotice("");
				store.perform({
					action: "settings",
					key: entry.key,
					expectedVersion: base.version,
					settings: draft.settings,
					alias: draft.alias,
					receiveEnabled: draft.receiveEnabled
				}).then((result) => {
					const saved = result.snapshot?.conversations.find((value) => value.key === entry.key);
					if (!saved?.settings) throw new Error("保存结果未确认，草稿已保留。请刷新目录核对。");
					const value = current(saved, saved.settings);
					drafts.delete(entry.key);
					if (mounted.current) {
						setRetained({
							draft: value,
							base: value
						});
						setNotice(result.notice ?? "会话设置已保存。补充提示词立即生效；Agent 预设与工作目录在下次新会话生效。");
					}
				}).catch((cause) => {
					if (mounted.current) setError(cause instanceof Error ? cause.message : "保存失败，草稿已保留。");
				}).finally(() => {
					pending.current = false;
					if (mounted.current) setBusy(false);
				});
			};
			return (0, react.createElement)("section", {
				className: "imqc-peerSettings",
				"aria-label": t("peer.settings.aria"),
				"aria-busy": busy
			}, (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("span", null, "接收此 QQ 对话"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label: "接收此 QQ 对话",
				checked: draft.receiveEnabled,
				disabled: busy,
				onChange: (receiveEnabled) => patch({ receiveEnabled })
			})), !entry.admitted && entry.policy.receiveEnabled !== false ? (0, react.createElement)("div", { className: "imqc-banner" }, (0, react.createElement)("p", { className: "imqc-hint" }, "此对话当前未获接收许可。接收开关仍受账号访问范围约束；加入访问名单后才能接收。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: admit
			}, "启用此对话并加入访问名单")) : null, (0, react.createElement)("label", { className: "imqc-field" }, (0, react.createElement)("span", null, "QQ 备注"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: draft.alias,
				maxLength: 100,
				disabled: busy,
				"aria-label": "QQ 备注",
				onChange: (event) => patch({ alias: event.target.value })
			})), (0, react.createElement)(QQAgentSettingsForm, {
				settings: draft.settings,
				tools,
				catalog,
				commands,
				chatScope: entry.scope,
				onPickDirectory: selectorSource.pickDirectory,
				workspaces,
				onCreateWorkspace: selectorSource.createWorkspace,
				defaultWorkspaceName,
				defaultCwd,
				disabled: busy,
				onChange: (value) => patch({ settings: value }),
				onRefreshCatalog: catalog.refresh,
				askTools: Object.entries(entry.policy.tools).filter(([, decision]) => decision === "ask").map(([id]) => id)
			}), (0, react.createElement)("div", { className: "imqc-inline" }, (0, react.createElement)("span", { className: "imqc-hint" }, "消息记录会全部保留，不会自动清理。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: clearRecords
			}, "清空消息记录")), (0, react.createElement)("p", { className: "imqc-hint" }, t("peer.deferred.hint")), entry.running ? (0, react.createElement)("p", {
				role: "status",
				className: "imqc-hint"
			}, "任务运行中，可继续编辑草稿；任务结束后再保存会话设置。") : null, settingsConflict && dirty ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, "设置已在其他位置更新。草稿保留，请放弃修改以载入最新设置。") : null, error ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, error) : null, notice ? (0, react.createElement)("p", {
				role: "status",
				className: "imqc-hint"
			}, notice) : null, (0, react.createElement)("div", { className: "imqc-actions imqc-saveBar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || !dirty,
				onClick: discard
			}, "放弃修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy || !dirty || entry.running || settingsConflict,
				onClick: () => save()
			}, busy ? "保存中…" : "保存会话设置"), (0, react.createElement)("span", {
				role: "status",
				className: "imqc-hint"
			}, dirty ? t("peer.saveHint.dirty") : t("peer.saveHint.saved"))));
		}
		//#endregion
		//#region src/client/delivery-feedback.ts
		const DELIVERY_LABELS = {
			pending: "待发送",
			sending: "发送中",
			accepted: "QQ 接口已接受",
			failed: "本次发送已结束：失败",
			unknown: "本次发送已结束：结果未知"
		};
		function passiveReplyFeedback(passiveReply, now) {
			if (passiveReply === void 0) return {
				summary: "被动回复窗口状态未知，当前目录未提供时限；发送时由 QQ 平台判定。",
				sendLabel: "确认发送到 QQ"
			};
			const sendLabel = "尝试主动发送到 QQ";
			if (passiveReply.expiresAt === null) return {
				sendLabel,
				summary: "暂无可用的被动回复来源，本次将尝试主动发送，是否允许取决于机器人权限。"
			};
			const deadline = new Date(passiveReply.expiresAt).toLocaleString();
			if (passiveReply.expiresAt <= now) return {
				sendLabel,
				summary: `被动回复窗口已过期（截止 ${deadline}）；本次将尝试主动发送，是否允许取决于机器人权限。`
			};
			const seconds = Math.ceil((passiveReply.expiresAt - now) / 1e3);
			return {
				summary: `被动回复窗口剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒（截止 ${deadline}）。发送仍以 QQ 平台返回结果为准。`,
				sendLabel: "确认发送到 QQ"
			};
		}
		function deliverySummary(delivery) {
			const accepted = delivery.parts.filter((part) => part.state === "accepted").length;
			return `${DELIVERY_LABELS[delivery.state]} · QQ 接口接受 ${accepted}/${delivery.parts.length || "未知"} 段`;
		}
		function deliveryExplanation(delivery) {
			if (delivery.state === "unknown") return "部分分段可能已经发送，请先核对 QQ。本次操作已结束，不会自动重发；关闭后可重新选择回答发起新的发送。";
			if (delivery.state === "failed") {
				const accepted = delivery.parts.filter((part) => part.state === "accepted").length;
				return `${accepted > 0 ? `已有 ${accepted} 段获 QQ 接口接受，后续分段发送失败。接口接受不代表消息已送达或已读，请先核对 QQ。` : "本次发送失败，没有分段获 QQ 接口接受。"}本次操作已结束，不会自动重发；关闭后可重新选择回答发起新的发送。`;
			}
			return "接口接受不代表消息已送达或已读。";
		}
		//#endregion
		//#region src/client/qq-timeline-state.ts
		function timelineIdentity(item) {
			return item.direction === "inbound" ? `in:${item.message.id}` : `out:${item.delivery.id}`;
		}
		function timelineMatches(item, query) {
			return (item.direction === "inbound" ? `${item.message.senderName}\n${item.message.text}` : item.delivery.text).toLocaleLowerCase().includes(query.toLocaleLowerCase());
		}
		/** Incremental delivery updates replace their previous row instead of duplicating it. */
		function mergeTimeline(previous, incoming, query = "") {
			const items = new Map(previous.map((item) => [timelineIdentity(item), item]));
			for (const item of incoming) {
				const key = timelineIdentity(item);
				const old = items.get(key);
				if (!old && timelineMatches(item, query) || old && item.change >= old.change) items.set(key, item);
			}
			return [...items.values()].sort((a, b) => a.order - b.order || timelineIdentity(a).localeCompare(timelineIdentity(b)));
		}
		//#endregion
		//#region src/client/qq-conversation-view.ts
		function tabFor(tab) {
			return tab === "messages" ? "messages" : "settings";
		}
		const tabs = [{
			value: "settings",
			label: "会话设置",
			id: "qq-settings-tab",
			panelId: "qq-settings-panel"
		}, {
			value: "messages",
			label: "消息记录",
			id: "qq-messages-tab",
			panelId: "qq-messages-panel"
		}];
		const TIMELINE_MARKDOWN_LABELS = {
			code: {
				copyLabel: "复制",
				copiedLabel: "已复制"
			},
			footnotes: "脚注"
		};
		/** 按附件类型渲染：图片/视频/语音内嵌，文件给下载链接；无 url 时退化为类型徽标+文件名。 */
		function renderAttachment(att, index) {
			const label = att.name || att.type || "附件";
			const kind = att.kind ?? (att.type.startsWith("image/") ? "image" : att.type.startsWith("video/") ? "video" : att.type.startsWith("audio/") ? "voice" : "file");
			if (!att.url) return (0, react.createElement)("span", {
				key: index,
				className: "imqc-attachChip"
			}, `[${kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "voice" ? "语音" : "文件"}] ${label}`);
			if (kind === "image") return (0, react.createElement)("img", {
				key: index,
				className: "imqc-attachImage",
				src: att.url,
				alt: label,
				loading: "lazy"
			});
			if (kind === "video") return (0, react.createElement)("video", {
				key: index,
				className: "imqc-attachVideo",
				src: att.url,
				controls: true,
				preload: "metadata"
			});
			if (kind === "voice") return (0, react.createElement)("audio", {
				key: index,
				className: "imqc-attachAudio",
				src: att.url,
				controls: true,
				preload: "metadata"
			});
			return (0, react.createElement)("a", {
				key: index,
				className: "imqc-attachFile",
				href: att.url,
				target: "_blank",
				rel: "noreferrer noopener"
			}, `📎 ${label}`);
		}
		function QQConversationView({ sessionId, store, selectorSource, t, useSessions, useWorkspaces, useProjection, conversationKey, initialTab, defaultWorkspaceName }) {
			const state = useQQSessionStore(store);
			const workspaceChoices = (useWorkspaces?.((snapshot) => snapshot.items) ?? []).map((item) => ({
				workspaceId: String(item.workspaceId),
				title: item.title,
				path: item.path
			}));
			const summaries = useSessions?.((snapshot) => snapshot.byId) ?? {};
			const projectedPreset = useProjection?.("agentPreset");
			const projectedPermissions = useProjection?.("permissions");
			const summary = sessionId ? summaries[SessionId(sessionId)] : void 0;
			const nativePreset = projectedPreset !== void 0 ? projectedPreset : summary?.projectionValues?.agentPreset;
			const nativePermission = (projectedPermissions ?? summary?.projectionValues?.permissions)?.currentValue;
			const rootRef = (0, react.useRef)(null);
			const entry = conversationKey ? store.conversation(conversationKey) : sessionId ? store.entry(sessionId) : void 0;
			const [tab, setTab] = (0, react.useState)(() => tabFor(initialTab));
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [unarchive, setUnarchive] = (0, react.useState)(false);
			const activeKey = (0, react.useRef)(entry?.key);
			activeKey.current = entry?.key;
			(0, react.useEffect)(() => {
				setTab(tabFor(initialTab));
				setError("");
				setUnarchive(false);
			}, [
				sessionId,
				conversationKey,
				initialTab
			]);
			(0, react.useEffect)(() => {
				const root = rootRef.current;
				if (!root) return;
				root.scrollTop = 0;
				const view = root.ownerDocument.defaultView;
				for (let parent = root.parentElement; parent; parent = parent.parentElement) {
					const overflow = view?.getComputedStyle(parent).overflowY;
					if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") parent.scrollTop = 0;
				}
			}, [
				sessionId,
				conversationKey,
				entry?.key
			]);
			if (!entry) return (0, react.createElement)("section", {
				ref: rootRef,
				className: "imqc imqc-full"
			}, (0, react.createElement)("p", { role: "status" }, "正在读取 QQ 对话…"));
			const historical = sessionId !== null && entry.currentSessionId !== sessionId;
			const restore = () => {
				if (busy || !entry.currentSessionId) return;
				const key = entry.key;
				setBusy(true);
				setError("");
				store.perform({
					action: "unarchive",
					key,
					sessionId: entry.currentSessionId
				}).then(() => {
					if (activeKey.current === key) setUnarchive(false);
				}).catch((cause) => {
					if (activeKey.current === key) setError(cause instanceof Error ? cause.message : "取消归档失败");
				}).finally(() => {
					if (activeKey.current === key) setBusy(false);
				});
			};
			return (0, react.createElement)("section", {
				ref: rootRef,
				className: "imqc imqc-settingsView",
				"aria-label": t("view.settings.title")
			}, (0, react.createElement)("header", { className: "imqc-viewHeading" }, (0, react.createElement)("h3", null, conversationName(entry)), (0, react.createElement)("span", { className: "imqc-hint" }, entry.scope === "group" ? "QQ 群聊" : "QQ 私聊")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
				className: "imqc-tabs",
				label: "QQ 会话设置类别",
				value: tab,
				items: tabs,
				size: "sm",
				onChange: setTab
			}), error ? (0, react.createElement)("p", {
				className: "imqc-error",
				role: "alert"
			}, error) : null, state.directory?.errors?.map((message) => (0, react.createElement)("p", {
				key: message,
				role: "alert",
				className: "imqc-error"
			}, message)), (0, react.createElement)("div", {
				id: `qq-${tab}-panel`,
				role: "tabpanel",
				"aria-labelledby": `qq-${tab}-tab`
			}, tab === "settings" ? historical ? (0, react.createElement)("div", {
				className: "imqc-banner",
				role: "status"
			}, (0, react.createElement)("strong", null, "这是历史会话，设置只读"), (0, react.createElement)("p", null, "历史会话的实际配置以原生轨迹为准。QQ 新消息进入当前会话。"), (0, react.createElement)("p", { className: "imqc-hint" }, `此会话 Agent 预设：${nativePreset === void 0 ? "未读取" : nativePreset ?? "未配置"}；权限：${nativePermission ?? "未读取"}。`), entry.currentSessionId ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => store.openSession(entry.currentSessionId ?? "")
			}, "返回当前会话") : null) : (0, react.createElement)("div", null, entry.archived ? (0, react.createElement)("div", {
				className: "imqc-banner",
				role: "status"
			}, (0, react.createElement)("strong", null, "当前 QQ 会话已归档"), (0, react.createElement)("p", null, "取消归档后继续接收，或新建会话。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: () => setUnarchive(true)
			}, "取消归档继续…"), unarchive ? (0, react.createElement)("div", { className: "imqc-actions" }, (0, react.createElement)("p", null, "确认取消归档并让 QQ 消息继续进入此会话？"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy,
				onClick: restore
			}, "确认取消归档"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy,
				onClick: () => setUnarchive(false)
			}, "取消")) : null) : null, (0, react.createElement)(QQPeerSettings, {
				key: entry.key,
				entry,
				store,
				tools: state.directory?.tools ?? [],
				commands: state.directory?.commands ?? [],
				selectorSource,
				t,
				workspaces: workspaceChoices,
				defaultWorkspaceName,
				defaultCwd: state.directory?.defaultCwd
			})) : null, tab === "messages" ? (0, react.createElement)(QQMessageTimeline, {
				key: entry.key,
				entry,
				store
			}) : null));
		}
		function QQMessageTimeline({ entry, store }) {
			const [query, setQuery] = (0, react.useState)("");
			const [search, setSearch] = (0, react.useState)("");
			const [items, setItems] = (0, react.useState)([]);
			const [page, setPage] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const generation = (0, react.useRef)(0);
			const pending = (0, react.useRef)(false);
			const cursor = (0, react.useRef)(void 0);
			const [now, setNow] = (0, react.useState)(Date.now);
			(0, react.useEffect)(() => {
				let timer;
				const tick = () => {
					const value = Date.now();
					setNow(value);
					const deadline = entry.passiveReply?.expiresAt;
					if (deadline !== null && deadline !== void 0 && deadline > value) timer = setTimeout(tick, Math.min(1e3, deadline - value));
				};
				tick();
				return () => {
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [entry.passiveReply?.expiresAt]);
			(0, react.useEffect)(() => {
				const request = ++generation.current;
				let active = true;
				pending.current = false;
				cursor.current = void 0;
				setItems([]);
				setPage(null);
				setError("");
				const load = async () => {
					if (pending.current) return;
					pending.current = true;
					setBusy(true);
					try {
						const result = await store.perform({
							action: "timeline",
							key: entry.key,
							query: search,
							...cursor.current === void 0 ? {} : { after: cursor.current }
						});
						if (!active || generation.current !== request) return;
						if (!result.timeline) throw new Error("消息记录返回格式无效");
						const next = result.timeline;
						if (cursor.current !== void 0 && page && next.snapshot < page.snapshot) {
							cursor.current = void 0;
							setItems([]);
							setPage(null);
							load();
							return;
						}
						setItems((previous) => mergeTimeline(previous, next.items, search));
						if (cursor.current === void 0) setPage(next);
						cursor.current = next.nextAfter ?? next.snapshot;
						setError("");
					} catch (cause) {
						if (active && generation.current === request) setError(cause instanceof Error ? cause.message : "无法读取消息记录");
					} finally {
						if (active && generation.current === request) {
							pending.current = false;
							setBusy(false);
						}
					}
				};
				load();
				const timer = setInterval(() => {
					load();
				}, 5e3);
				return () => {
					active = false;
					generation.current += 1;
					clearInterval(timer);
				};
			}, [
				entry.key,
				search,
				store
			]);
			const older = () => {
				if (pending.current || !page?.hasMore || page.nextBefore === void 0) return;
				const request = generation.current;
				pending.current = true;
				setBusy(true);
				setError("");
				store.perform({
					action: "timeline",
					key: entry.key,
					query: search,
					before: page.nextBefore,
					snapshot: page.snapshot
				}).then((result) => {
					if (generation.current !== request) return;
					if (!result.timeline) throw new Error("消息记录返回格式无效");
					setItems((previous) => mergeTimeline(previous, result.timeline?.items ?? [], search));
					setPage(result.timeline);
				}).catch((cause) => {
					if (generation.current === request) setError(cause instanceof Error ? cause.message : "无法读取更早记录");
				}).finally(() => {
					if (generation.current === request) {
						pending.current = false;
						setBusy(false);
					}
				});
			};
			const feedback = passiveReplyFeedback(entry.passiveReply, now);
			const visible = items.filter((item) => timelineMatches(item, search) && (item.direction === "inbound" ? item.message.bodyState : item.delivery.bodyState) !== "expired");
			return (0, react.createElement)("section", {
				className: "imqc-timeline",
				"aria-label": "QQ 消息记录",
				"aria-busy": busy
			}, (0, react.createElement)("p", { className: "imqc-hint" }, "收到的 QQ 消息在左，机器人回复在右；点每条右侧 ↗ 可在原生会话中查看该轮。"), feedback.summary ? (0, react.createElement)("p", { className: "imqc-hint imqc-timelineFeedback" }, feedback.summary) : null, (0, react.createElement)("form", {
				className: "imqc-inline",
				onSubmit: (event) => {
					event.preventDefault();
					setSearch(query.trim());
				}
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "search",
				value: query,
				"aria-label": "搜索消息记录",
				placeholder: "搜索已保存的消息正文…",
				onChange: (event) => setQuery(event.target.value)
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "submit",
				variant: "outline",
				size: "sm"
			}, "查询")), error ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, error) : null, page?.hasMore ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: older
			}, "读取更早记录") : null, (0, react.createElement)("div", { className: "imqc-timelineRows" }, ...visible.map((item) => {
				const incoming = item.direction === "inbound";
				const record = incoming ? item.message : item.delivery;
				const session = incoming ? item.message.sessionId : item.delivery.sourceSessionId;
				const body = record.bodyState === "expired" ? "正文已过期" : record.bodyState === "disabled" ? "正文未记录" : record.text || "无文本内容";
				const provenance = record.provenance === "web" ? "网页显式发送" : record.provenance === "automatic" ? "QQ 自动回复" : record.provenance === "command" ? "QQ 命令" : record.provenance === "interaction" ? "QQ 交互" : record.provenance === "legacy" ? "历史记录" : "QQ";
				const failed = !incoming && (item.delivery.state === "failed" || item.delivery.state === "unknown");
				return (0, react.createElement)("article", {
					key: timelineIdentity(item),
					className: "imqc-timelineMessage",
					"data-direction": item.direction,
					"data-failed": failed || void 0
				}, (0, react.createElement)("div", { className: "imqc-messageBody" }, (0, react.createElement)("div", { className: "imqc-messageMeta" }, (0, react.createElement)("span", { className: "imqc-messageWho" }, incoming ? item.message.senderName || item.message.senderId.slice(-8) : "机器人"), (0, react.createElement)("span", { className: "imqc-messageWhen" }, new Date(record.at).toLocaleString())), body ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text: body,
					labels: TIMELINE_MARKDOWN_LABELS,
					variant: "compact"
				}) : null, incoming && item.message.attachments.length ? (0, react.createElement)("div", { className: "imqc-attachRow" }, ...item.message.attachments.map((att, i) => renderAttachment(att, i))) : null, failed ? (0, react.createElement)("p", {
					className: "imqc-error imqc-messageWarn",
					role: "alert"
				}, item.delivery.state === "failed" ? "发送失败" : "结果未知（可能部分已发出，请核对 QQ）") : null), (0, react.createElement)("div", { className: "imqc-messageAside" }, failed ? (0, react.createElement)("details", { className: "imqc-msgInfo" }, (0, react.createElement)("summary", {
					title: "发送详情",
					"aria-label": "发送详情"
				}, "ⓘ"), (0, react.createElement)("div", { className: "imqc-msgInfoBody" }, (0, react.createElement)("p", { className: "imqc-hint" }, deliverySummary(item.delivery)), (0, react.createElement)("p", { className: "imqc-hint" }, deliveryExplanation(item.delivery)), (0, react.createElement)("p", { className: "imqc-hint" }, `来源：${provenance}`), ...item.delivery.parts.map((part) => (0, react.createElement)("p", {
					key: part.index,
					className: "imqc-hint"
				}, `分段 ${part.index + 1}：${part.state}`)), item.delivery.error ? (0, react.createElement)("p", {
					role: "alert",
					className: "imqc-error"
				}, item.delivery.error) : null)) : null, (() => {
					const target = session && store.entry(session) ? session : entry.currentSessionId;
					return target ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						className: "imqc-jumpTurn",
						"aria-label": "在原生会话中查看此消息",
						title: "在原生会话中查看此消息",
						onClick: () => store.openSession(target)
					}, "↗") : null;
				})()));
			})), page && visible.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "没有匹配的消息记录。开启记录后，仅保存机器人实际收到的 QQ 消息与投递。") : null);
		}
		//#endregion
		//#region src/client/qq-operation-dialog.ts
		/** Workspace and preset are committed together under one guarded operation identity. */
		function QQOperationDialog({ target, store, workspaces, selectorSource, defaultWorkspaceName }) {
			useQQSessionStore(store);
			const entry = store.conversation(target.key);
			const currentWorkspaceId = target.workspaceId ?? workspaces.find((workspace) => workspace.sessionIds.some((id) => id === target.sessionId))?.workspaceId ?? "";
			const currentCwd = workspaces.find((workspace) => workspace.workspaceId === currentWorkspaceId)?.path ?? "";
			const [cwdPath, setCwdPath] = (0, react.useState)(currentCwd);
			const [presetId, setPresetId] = (0, react.useState)(target.presetId ?? "");
			const [presets, setPresets] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(true);
			const [busy, setBusy] = (0, react.useState)(false);
			const pending = (0, react.useRef)(false);
			const operationId = (0, react.useRef)(crypto.randomUUID());
			const [error, setError] = (0, react.useState)(null);
			const intent = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => intent.current?.cancel(), []);
			(0, react.useEffect)(() => {
				let active = true;
				selectorSource.listAgentPresets().then(parseAgentPresets).then((items) => {
					if (active) setPresets(items);
				}).catch((cause) => {
					if (active) setError(cause instanceof Error ? cause.message : "无法读取预设");
				}).finally(() => {
					if (active) setLoading(false);
				});
				return () => {
					active = false;
				};
			}, [selectorSource]);
			const close = () => {
				intent.current?.cancel();
				store.closeDrawer();
			};
			const changed = entry?.currentSessionId !== target.sessionId || entry?.policy.version !== target.policyVersion;
			const presetCeiling = entry?.selectablePresets ?? entry?.policy.allowedPresets ?? [];
			const unrestricted = presetCeiling.length === 0;
			const allowedPresets = unrestricted ? presets.map((preset) => preset.id) : presetCeiling;
			const [wsBusy, setWsBusy] = (0, react.useState)(false);
			const addWorkspace = () => {
				if (!selectorSource.pickDirectory) return;
				setWsBusy(true);
				selectorSource.pickDirectory().then(async (path) => {
					if (!path || !selectorSource.createWorkspace) return;
					try {
						const ws = await selectorSource.createWorkspace(path);
						setCwdPath(ws.path);
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : "无法创建或采用工作区");
					}
				}).finally(() => setWsBusy(false));
			};
			const resolvedWorkspaceId = cwdPath === "" ? "" : workspaces.find((workspace) => workspace.path === cwdPath)?.workspaceId ?? "";
			const workspaceAvailable = cwdPath === "" || resolvedWorkspaceId !== "";
			const presetAvailable = allowedPresets.includes(presetId) && presets.some((preset) => preset.id === presetId && !preset.broken);
			const disabled = busy || loading || !entry?.admitted || entry.running || changed || !workspaceAvailable || !presetAvailable;
			const submit = (event) => {
				event.preventDefault();
				if (disabled || pending.current || !entry) return;
				pending.current = true;
				setBusy(true);
				setError(null);
				const navigation = store.navigationIntent();
				intent.current = navigation;
				store.perform({
					action: "create-session",
					key: target.key,
					operationId: operationId.current,
					expectedCurrentSessionId: target.sessionId,
					expectedPolicyVersion: target.policyVersion,
					workspaceId: resolvedWorkspaceId,
					presetId
				}).then((result) => {
					if (!navigation.current()) return;
					const outcome = store.openActionResult(navigation, result, target.key);
					if (outcome === "opened") close();
					else if (outcome === "unavailable") setError("会话操作已完成，请刷新目录确认当前会话。");
				}).catch((cause) => {
					if (navigation.current()) setError(cause instanceof Error ? cause.message : "新建失败；重试仍使用同一操作编号。");
				}).finally(() => {
					pending.current = false;
					setBusy(false);
				});
			};
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: close,
				title: "新建 QQ 会话",
				closeLabel: "关闭",
				className: "imqq-editModal",
				children: (0, react.createElement)("form", {
					className: "imqq-editForm",
					onSubmit: submit
				}, (0, react.createElement)("p", { className: "imqq-dialogHint" }, target.name), (0, react.createElement)("p", { className: "imqq-dialogHint" }, "工作区和 Agent 预设默认使用当前值。确认后 QQ 新消息进入新会话，旧历史保留；此操作不提交提问。"), !currentWorkspaceId ? (0, react.createElement)("p", {
					role: "status",
					className: "imqq-dialogHint"
				}, "当前会话尚未绑定可用的 DSH 工作区，请为新会话选择工作区。") : null, (0, react.createElement)(WorkspaceCwdSelect, {
					value: cwdPath,
					workspaces,
					defaultCwd: store.getSnapshot().directory?.defaultCwd,
					defaultWorkspaceName,
					disabled: busy || wsBusy,
					label: "工作区",
					onAddWorkspace: addWorkspace,
					onChange: setCwdPath
				}), (0, react.createElement)("label", { className: "imqc-field" }, (0, react.createElement)("span", null, "Agent 预设"), (0, react.createElement)(QQSelect, {
					label: "新 QQ 会话的 Agent 预设",
					value: presetId,
					onChange: setPresetId,
					disabled: busy || loading,
					placeholder: loading ? "读取预设…" : "选择 Agent 预设",
					options: presets.map((preset) => ({
						value: preset.id,
						label: preset.name,
						description: preset.broken ?? (!unrestricted && !allowedPresets.includes(preset.id) ? "此对话未授权" : preset.description),
						disabled: Boolean(preset.broken) || !unrestricted && !allowedPresets.includes(preset.id)
					}))
				})), null, changed ? (0, react.createElement)("p", {
					role: "alert",
					className: "imqq-dialogHint"
				}, "当前 QQ 会话或策略已变化，请关闭后重新打开操作。") : entry?.running ? (0, react.createElement)("p", { className: "imqq-dialogHint" }, "当前会话正在回复，结束后可新建会话。") : !entry?.admitted ? (0, react.createElement)("p", { className: "imqq-dialogHint" }, "请先授权此 QQ 对话。") : null, workspaces.length === 0 ? (0, react.createElement)("p", {
					role: "status",
					className: "imqq-dialogHint"
				}, "还没有可用工作区，请先在 DSH 工作区导航中添加工作区。") : null, error ? (0, react.createElement)("p", {
					role: "alert",
					className: "imqq-error"
				}, error) : null, (0, react.createElement)("div", { className: "imqq-dialogActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: close
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "submit",
					variant: "primary",
					size: "sm",
					disabled
				}, busy ? "新建中…" : "确认新建会话")))
			});
		}
		//#endregion
		//#region src/client/conversation-panel.ts
		const PHASE_LABELS = {
			unbound: "等待绑定",
			connecting: "正在连接",
			ready: "已连接",
			reconnecting: "正在重连",
			failed: "连接失败",
			stopped: "已停止"
		};
		function ConversationPanel({ onOpenSettings, store }) {
			const bind = useBindState();
			const directory = useQQSessionStore(store);
			const entries = directory.directory?.conversations ?? [];
			const resumable = store.resumeTarget();
			return (0, react.createElement)("section", {
				className: "imqc imqq-welcome",
				"aria-label": "QQ 会话"
			}, (0, react.createElement)("svg", {
				viewBox: "0 0 24 24",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			})), (0, react.createElement)("div", { className: "imqq-welcomeTitle" }, (0, react.createElement)("h3", null, "QQ 会话"), (0, react.createElement)("span", {
				className: "imqc-state imqq-welcomeState",
				role: "status"
			}, directory.runtime ? PHASE_LABELS[directory.runtime.phase] : "读取连接状态…")), (0, react.createElement)("p", { className: "imqc-hint" }, entries.length ? "在左侧选择群聊或联系人，继续当前会话或查看历史。" : "收到 QQ 消息后，群聊和联系人会出现在左侧。可先管理账号和授权范围。"), (0, react.createElement)("p", { className: "imqc-hint" }, "会话使用原生聊天页的输入框、模型和权限控件。选择目录中的对话不会自动创建任务。"), bind.state?.phase !== "bound" ? (0, react.createElement)(BindPanelBody, bind) : null, directory.error ? (0, react.createElement)("p", {
				className: "imqc-error",
				role: "alert"
			}, directory.error) : null, (0, react.createElement)("div", { className: "imqq-welcomeActions" }, resumable ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => store.openSession(resumable.sessionId)
			}, `继续与「${resumable.name}」的会话`) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: onOpenSettings
			}, "账号设置")), resumable ? (0, react.createElement)("p", { className: "imqc-hint" }, `「继续」会打开最近活跃对话「${resumable.name}」的当前会话；要开新会话，请在左侧该对话的「＋」或菜单里新建。`) : null);
		}
		function QQAccountOwners({ store, t, bound = true }) {
			const title = t ? t("owners.title") : "斜杠命令超管";
			const commands = useQQSessionStore(store).directory?.commands ?? [];
			return (0, react.createElement)("section", {
				className: "imqc",
				"aria-label": title
			}, (0, react.createElement)("h3", null, title), (0, react.createElement)("p", { className: "imqc-hint" }, t ? t("owners.hint") : "在任何 QQ 会话里都能使用斜杠命令（含 /model、/preset、/permission 等改动类命令）、审批工具调用、回答机器人提问与中止任务。它不开放工具、也不绕过执行权限——工具与权限仍在会话设置里配置。"), (0, react.createElement)(PairClaimPanel, {
				purpose: "owner",
				title,
				enabled: bound,
				hint: "点「添加…」生成一次性配对码，然后在 QQ 里直接给机器人发送这个码；对方点「确认」后即可加入。"
			}), commands.length > 0 ? (0, react.createElement)(SlashCommandList, { commands }) : null);
		}
		function errorMessage(cause) {
			return cause instanceof Error ? cause.message : "操作失败";
		}
		function usePassiveReplyFeedback(passiveReply) {
			const [now, setNow] = (0, react.useState)(Date.now);
			const expiresAt = passiveReply?.expiresAt;
			(0, react.useEffect)(() => {
				let timer;
				const update = () => {
					const current = Date.now();
					setNow(current);
					if (expiresAt !== void 0 && expiresAt !== null && expiresAt > current) timer = setTimeout(update, Math.min(1e3, expiresAt - current));
				};
				update();
				return () => {
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [expiresAt]);
			return passiveReplyFeedback(passiveReply, now);
		}
		function QQConversationOverlay({ store, selectorSource, t, useWorkspaces, useSessions, defaultWorkspaceName }) {
			const state = useQQSessionStore(store);
			const workspaces = useWorkspaces((snapshot) => snapshot.items);
			const overlay = state.overlay;
			if (overlay?.kind === "drawer") {
				const target = overlay.target;
				const entry = store.conversation(target.key);
				return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					key: `${target.key}/${target.sessionId}`,
					title: `${target.name} · QQ 设置`,
					open: true,
					closeLabel: "关闭",
					className: "imqq-settingsModal",
					contentClassName: "imqq-settingsContent",
					onClose: store.closeDrawer,
					children: entry ? (0, react.createElement)(QQConversationView, {
						sessionId: target.sessionId,
						conversationKey: target.key,
						initialTab: target.tab,
						store,
						selectorSource,
						t,
						useSessions,
						useWorkspaces,
						defaultWorkspaceName
					}) : (0, react.createElement)("p", { role: "alert" }, "此 QQ 对话已不可用，请刷新目录。")
				});
			}
			if (overlay?.kind === "operation") return (0, react.createElement)(QQOperationDialog, {
				key: `${overlay.target.kind}/${overlay.target.key}`,
				target: overlay.target,
				store,
				selectorSource,
				workspaces,
				defaultWorkspaceName
			});
			if (overlay?.kind === "answer") return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				key: overlay.preview.operationId,
				title: `发送到 ${overlay.preview.name}`,
				open: true,
				closeLabel: "关闭",
				className: "imqq-answerPreview",
				onClose: store.closePreview,
				children: (0, react.createElement)(AnswerPreview, {
					preview: overlay.preview,
					store
				})
			});
			return null;
		}
		function AnswerPreview({ preview, store }) {
			useQQSessionStore(store);
			const replyFeedback = usePassiveReplyFeedback(store.conversation(preview.key)?.passiveReply);
			const [busy, setBusy] = (0, react.useState)(false);
			const [delivery, setDelivery] = (0, react.useState)(null);
			const [attempted, setAttempted] = (0, react.useState)(false);
			const pending = (0, react.useRef)(false);
			const [error, setError] = (0, react.useState)(null);
			const valid = store.canSend(preview);
			return (0, react.createElement)("div", null, (0, react.createElement)("p", { className: "imqc-hint" }, `目标 ${preview.name} · 会话 ${preview.sessionId.slice(-8)}`), (0, react.createElement)("p", { className: "imqc-hint" }, replyFeedback.summary), (0, react.createElement)("p", { className: "imqc-hint" }, "仅发送以下最终回答。"), (0, react.createElement)("pre", { className: "imqc-messageText" }, preview.text), !valid ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, "此对话的授权或当前会话已变化，请关闭预览并重新选择回答。") : null, error ? (0, react.createElement)("p", {
				role: "alert",
				className: "imqc-error"
			}, error) : null, delivery ? (0, react.createElement)("div", { role: "status" }, (0, react.createElement)("p", null, deliverySummary(delivery)), (0, react.createElement)("p", { className: "imqc-hint" }, deliveryExplanation(delivery)), delivery.error ? (0, react.createElement)("p", { className: "imqc-error" }, delivery.error) : null) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy || !valid || attempted,
				onClick: () => {
					if (!store.canSend(preview) || pending.current || attempted) return;
					pending.current = true;
					setAttempted(true);
					setBusy(true);
					setError(null);
					store.sendAnswer(preview).then((result) => {
						if (result.delivery) setDelivery(result.delivery);
						else setError("未确认发送结果，请查看发送记录。");
					}).catch((cause) => setError(`发送结果未确认：${errorMessage(cause)}。请查看发送记录并核对 QQ，本次操作不会重发。`)).finally(() => {
						pending.current = false;
						setBusy(false);
					});
				}
			}, busy ? "提交中…" : attempted ? "本次发送已提交" : replyFeedback.sendLabel));
		}
		//#endregion
		//#region src/client/qq-conversation-registration.ts
		/** Native view rosters are global; own the registration only while a QQ main/history session is selected. */
		function installQQConversationViewRegistration({ current, store, register }) {
			let stopView;
			const sync = () => {
				const key = current.getSnapshot().key;
				if (key && store.entry(key)) stopView ??= register();
				else {
					stopView?.();
					stopView = void 0;
				}
			};
			const stopCurrent = current.subscribe(sync);
			const stopDirectory = store.subscribe(sync);
			sync();
			return () => {
				stopDirectory();
				stopCurrent();
				stopView?.();
				stopView = void 0;
			};
		}
		//#endregion
		//#region src/client/conversation-styles.ts
		/** QQ surfaces share the host's aliases, typography and compact control geometry. */
		function installConversationStyles() {
			const previous = document.getElementById("imqc-styles");
			const style = previous instanceof HTMLStyleElement ? previous : document.createElement("style");
			style.id = "imqc-styles";
			style.textContent = `
.imqc { font: 13px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-primary); min-width: 0; box-sizing: border-box; padding: 16px; width: 100%; }
.imqc *, .imqc-readonly * { box-sizing: border-box; }
.imqc h3, .imqc h4 { margin: 0; font-size: 14px; font-weight: 600; }
.imqc p { margin: 6px 0; overflow-wrap: anywhere; }
.imqc textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; line-height: 1.5; font: inherit; color: inherit; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 7px 9px; background: var(--dsw-alias-bg-layer-3); }
.imqc textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
.imqc-header { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.imqc-header > svg { flex: none; width: 24px; height: 24px; }
.imqc-headerTitle { flex: 1; min-width: 0; }
.imqc-hint { display: block; color: var(--dsw-alias-label-tertiary); font-size: 12px; overflow-wrap: anywhere; }
.imqc-state { display: flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.imqc-dot[data-ready=true] { background: var(--dsw-alias-state-success-primary); }
.imqc-error { color: var(--dsw-alias-state-error-primary); padding: 8px 0; overflow-wrap: anywhere; }
.imqc-tabs { margin: 10px 0 14px; max-width: 100%; }
.imqc-list { display: flex; flex-direction: column; gap: 3px; margin: 8px -5px; }
.imqc-row { width: 100%; padding: 11px 8px; text-align: left; border: 0; border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; }
.imqc-row:hover { background: var(--dsw-alias-bg-layer-1); }
.imqc-row[aria-pressed=true] { background: var(--dsw-alias-bg-layer-2); }
.imqc-rowTop { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
.imqc-rowName { font-weight: 500; overflow-wrap: anywhere; min-width: 0; }
.imqc-rowMeta { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqc-rowText { display: block; color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
.imqc-section { border-top: 1px solid var(--dsw-alias-border-l2); padding: 14px 0; }
.imqc-section:first-child { border-top: 0; }
.imqc-actions, .imqc-inline { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.imqc-actions { padding: 10px 0; }
.imqc-selectorRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 7px 0; }
.imqc-selectorRow > :last-child { min-width: 0; width: min(72%, 300px); }
.imqc-field { display: grid; gap: 5px; margin: 11px 0; }
.imqc-field > span:first-child { color: var(--dsw-alias-label-secondary); }
.imqc-check { display: flex; align-items: flex-start; gap: 7px; margin: 7px 0; overflow-wrap: anywhere; }
.imqc-toolChoices { max-height: min(56vh, 540px); overflow-y: auto; overscroll-behavior: contain; padding-right: 8px; }
.imqc-toolPickerBar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.imqc-toolPickerBar > :first-child { flex: 1; min-width: 200px; }
.imqc-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 6px; }
.imqc-chip { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.imqc-chip[data-active] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-secondary); }
.imqc-onlySelected { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.imqc-toolGroupHead { display: flex; align-items: center; gap: 8px; }
.imqc-toolGroupToggle { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 2px 0; text-align: left; }
.imqc-toolGroupAll { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); cursor: pointer; }
.imqc-toolGroupAll:disabled { opacity: .5; cursor: default; }
.imqc-toolGrid { display: grid; grid-template-columns: minmax(0,1fr); gap: 4px; margin: 6px 0 2px; }
.imqc-toolRow { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: var(--dsw-radius-md); cursor: pointer; border: 1px solid transparent; }
.imqc-toolRow:hover { background: var(--dsw-alias-bg-layer-1); }
.imqc-toolRow[data-on] { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.imqc-toolRow[data-off] { opacity: .5; cursor: default; }
.imqc-toolRowStatic { cursor: default; align-items: center; border-color: var(--dsw-alias-border-l2); }
.imqc-toolRowStatic:hover { background: transparent; }
.imqc-toolRowStatic .imqc-toolRowBody { flex: 1; }
.imqc-toolRemove { flex: none; }
.imqc-toolRowInput { margin-top: 2px; width: 15px; height: 15px; flex: none; }
.imqc-toolRowBody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.imqc-toolRowName { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.imqc-toolRowDesc { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.imqc-toolPickerFoot { margin-top: 12px; }
/* 工具选择弹窗：默认 Modal 只有 380px，这里放宽以便两列排布 */
.imqc-toolModal { width: min(760px, calc(100vw - 32px)); max-width: min(760px, calc(100vw - 32px)); }
.imqc-toolModal > * { min-width: 0; }
@media (min-width: 560px) { .imqc-toolGrid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
.imqc-toolGroup { padding: 13px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.imqc-fieldset { margin: 12px 0; padding: 10px 14px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }
.imqc-fieldsetTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 2px 0 6px; }
.imqc-fieldset > .imqc-hint { margin-bottom: 8px; }
.imqc-fieldset .imqc-field { margin: 8px 0; }
.imqc-cmdList { margin: 6px 0 2px; }
.imqc-cmdList > summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.imqc-cmdGroup { margin: 8px 0 4px; }
.imqc-cmdGroup > strong { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.imqc-cmdRow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 2px 0; }
.imqc-cmdRow code { font-size: 12px; color: var(--dsw-alias-label-primary); }
.imqc-toolGuide { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0 8px; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqc-toolGuide > p { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.imqc-presets { margin: 2px 0 8px; display: flex; flex-direction: column; gap: 6px; }
.imqc-presets > .imqc-hint { flex: none; }
.imqc-presetUser { display: inline-flex; align-items: center; gap: 2px; }
.imqc-presetDel { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px; }
.imqc-presetDel:disabled { opacity: .4; cursor: default; }
.imqc-presetSave { flex-wrap: nowrap; }
.imqc-presetSave > :first-child { flex: 1; min-width: 120px; }
.imqc-tool { display: grid; grid-template-columns: minmax(0,1fr) 90px; gap: 10px; align-items: start; padding-top: 12px; }
.imqc-toolCheckbox > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.imqc-tool small { margin-top: 2px; }
.imqc-preview { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 12px; margin-top: 10px; background: var(--dsw-alias-bg-layer-1); }
.imqc-pair { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }
.imqc-pair > .imqc-inline { justify-content: space-between; }
.imqc-pairCode { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqc-pairDialog { display: flex; flex-direction: column; gap: 8px; }
.imqc-pairSectionTitle { margin: 10px 0 2px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqc-pairSteps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.imqc-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); font-size: 12px; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); }
.imqc-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqc-pairModal { width: min(560px, calc(100vw - 32px)); }
.imqc-cmdList { margin: 6px 0; font-size: 12px; }
.imqc-cmdList > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.imqc-cmdGroup { margin: 8px 0 4px; display: flex; flex-direction: column; gap: 3px; }
.imqc-cmdGroup > strong { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-cmdRow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.imqc-cmdRow > code { font-size: 12px; padding: 0 5px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.imqc-pairManual { flex-wrap: nowrap; }
.imqc-pairManual > :first-child { flex: 1; min-width: 120px; }
.imqc-pairCodeCard { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.imqc-pairCodeMain { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.imqc-pairCodeValue { font-size: 24px; font-weight: 700; letter-spacing: 4px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.imqc-pairCodeMeta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.imqc-pairCodeActions { display: flex; align-items: center; gap: 8px; flex: none; }
.imqc-pairMembers { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.imqc-pairMember { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.imqc-pairMemberMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.imqc-pairMemberName { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqc-pairMemberMeta { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqc-pairMemberActions, .imqc-pairMemberEdit { flex: none; }
.imqc-pairMemberEdit > :first-child { width: 140px; }
.imqc-preview pre, .imqc-messageText { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 7px 0; }
.imqc-history { display: grid; gap: 5px; }
.imqc-history button { text-align: left; overflow-wrap: anywhere; }
.imqc-message { border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 10px 0; }
.imqc-messageMeta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-readonly { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 15px; margin: 8px 0; color: var(--dsw-alias-label-secondary); font: 13px/1.5 var(--dsw-font-family); background: var(--dsw-alias-bg-base); }
.imqc-readonly strong { display: block; color: var(--dsw-alias-label-primary); margin-bottom: 4px; }
.imqc-readonly .imqc-actions { padding-bottom: 0; }
.imqc-readonly .imqc-error { margin-top: 7px; }
.imqc-source { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.imqc-full { max-width: 900px; margin: 0 auto; padding: 24px; }
@media(max-width:420px) { .imqc { padding: 12px; } .imqc-tool { grid-template-columns: minmax(0,1fr) 82px; gap: 7px; } }

.imqc-directory { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 16px; background: var(--dsw-alias-bg-base); }
.imqc-directory .imqc-list { margin: 8px 0; }
.imqc-directoryRow { display: flex; align-items: center; gap: 4px; }
.imqc-directoryRow > .imqc-row { flex: 1; min-width: 0; }
.imqc-listScroll { flex: 1; overflow-y: auto; min-height: 80px; }
.imqc-listFooter { display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqc-row { display: flex; align-items: center; gap: 10px; }
.imqc-avatar { display: flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-weight: 600; }
.imqc-rowBody { flex: 1; min-width: 0; }
.imqc-rowName, .imqc-rowText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imqc-status { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqc-sessionBadge { color: var(--dsw-alias-label-tertiary); font: 10px/1.2 var(--dsw-font-family); white-space: nowrap; }
.imqc-sessionSource { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.imqc-sessionUtilities { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font: 12px/1.5 var(--dsw-font-family); }
.imqc-answerAction { font: 12px/1.5 var(--dsw-font-family); }
.imqc-answerModal { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 20px; }
.imqc-answerPreview { position: relative; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); width: min(580px, 100%); max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgb(0 0 0 / 12%); }
.imqq-sidebar { display: flex; flex-direction: column; flex: 1; width: 100%; min-width: 0; min-height: 0; overflow: hidden; padding: 0 var(--dsh-sidebar-inline-padding, 8px); font: 13px/1.4 var(--dsw-font-family); color: var(--dsw-alias-label-primary); box-sizing: border-box; }
.imqq-sidebar *, .imqq-editForm * { box-sizing: border-box; }
.imqq-heading { display: flex; align-items: center; gap: 3px; min-height: 40px; flex: none; }
.imqq-headingTitle { flex: 1; min-width: 0; font-weight: 500; padding-left: 5px; }
.imqq-heading .imqq-back { font-size: 11px; padding-inline: 5px; gap: 2px; color: var(--dsw-alias-label-secondary); }
.imqq-search { margin: 3px 3px 9px; flex: none; }
.imqq-search > span { display: flex; width: 100%; }
.imqq-tree { flex: 1; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
.imqq-scope { margin-bottom: 10px; }
/* 一级：分组标题（群聊/私聊）——更醒目、不缩进，chevron 属这一级 */
.imqq-scopeToggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px var(--dsh-sidebar-row-padding, 12px) 4px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 600 12px/1.3 var(--dsw-font-family); cursor: pointer; text-align: left; }
.imqq-count { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
/* 二级：具体对话——向右缩进，表达从属于上面的分组 */
.imqq-peerRow { display: flex; align-items: center; min-width: 0; min-height: 34px; border-radius: var(--dsw-radius-md); padding-left: 20px; padding-right: 2px; }
.imqq-peerRow:hover, .imqq-sessionRow:hover { background: var(--dsw-alias-bg-layer-1); }
.imqq-peerRow[data-selected=true] { background: var(--dsw-alias-bg-layer-2); }
.imqq-peerRow[data-selected=true] .imqq-peerName { font-weight: 500; }
.imqq-toggle, .imqq-toggleSpace { width: 21px; flex: none; }
.imqq-toggle { min-height: 30px; display: flex; justify-content: center; align-items: center; padding: 0; border: 0; color: var(--dsw-alias-label-tertiary); background: transparent; cursor: pointer; }
.imqq-peerOpen { display: flex; align-items: center; gap: var(--dsh-sidebar-label-gap, 6px); flex: 1; min-width: 0; min-height: 38px; padding: 6px 0; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.imqq-peerOpen > svg { flex: none; color: var(--dsw-alias-label-secondary); }
.imqq-peerText { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.imqq-peerName, .imqq-peerSummary { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqq-peerSummary { color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.4; }
.imqq-tag { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.imqq-running { flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.imqq-currentTags { flex: none; display: inline-flex; align-items: center; gap: 4px; }
.imqq-current { flex: none; font-size: 10px; line-height: 1.3; padding: 0 5px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-secondary, transparent); }
.imqq-sessionRow[data-current=true] .imqq-sessionTitle { color: var(--dsw-alias-label-primary); font-weight: 500; }
.imqq-sessionCurrent { flex: none; font-size: 9px; line-height: 1.3; padding: 0 5px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.imqq-sidebar .imqq-menuTrigger { padding-inline: 4px; min-width: 24px; width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); letter-spacing: 1px; }
.imqq-sidebar .imqq-quickAdd { flex: none; padding-inline: 4px; min-width: 24px; width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); }
.imqq-sidebar .imqq-quickAdd:disabled { opacity: .35; cursor: default; }
.imqq-sessions { margin-left: 52px; padding-left: 8px; }
.imqq-sessionRow { display: flex; align-items: center; min-width: 0; border-radius: var(--dsw-radius-md); padding-right: 2px; margin: 2px 0; }
.imqq-sessionRow[data-selected=true] { background: var(--dsw-alias-bg-layer-2); }
.imqq-sessionOpen { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: transparent; text-align: left; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); padding: 6px; cursor: pointer; }
.imqq-sessionTitle { display: flex; align-items: center; gap: 5px; width: 100%; min-width: 0; }
.imqq-sessionTitleText, .imqq-workspace { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
.imqq-workspace { width: 100%; }
.imqq-copied { flex: none; font-size: 10px; color: var(--dsw-alias-state-success-primary); }
.imqq-sessionMeta { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.imqq-workspace { flex: 1; min-width: 0; }
.imqq-more { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 11px/1.4 var(--dsw-font-family); padding: 8px 6px; cursor: pointer; text-align: left; }
.imqq-more:hover { color: var(--dsw-alias-label-primary); }
.imqq-empty { margin: 5px 12px 10px 25px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.imqq-footer { display: flex; flex: none; justify-content: space-between; align-items: center; padding: 8px 6px; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.imqq-error { color: var(--dsw-alias-state-error-primary); font: 12px/1.5 var(--dsw-font-family); overflow-wrap: anywhere; margin: 8px; }
.imqq-rail { align-items: center; padding-inline: 0; gap: 6px; padding-top: 6px; }
.imqq-editModal { width: min(440px, calc(100vw - 32px)); }
.imqq-editForm { display: grid; gap: 14px; font: 13px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-primary); }
.imqq-editForm .imqc-field { margin: 0; }
.imqq-dialogHint { margin: 0 0 10px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.imqq-dialogActions { display: flex; justify-content: flex-end; gap: 8px; }
.imqq-welcome { margin: auto; max-width: 560px; padding: 32px; text-align: center; }
.imqq-welcome > svg { width: 36px; height: 36px; margin-bottom: 12px; color: var(--dsw-alias-label-secondary); }
.imqq-welcomeActions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.imqq-welcomeTitle { display: flex; align-items: center; justify-content: center; gap: 8px; }
.imqq-welcomeTitle > h3 { margin: 0; }
.imqq-welcomeState { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.imqq-welcomeState::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); display: inline-block; }
.imqc fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqc-field > span, .imqc-inline > span { min-width: 0; width: 100%; }
.imqc-inline > span { flex: 1; }
.imqq-selectAnchor { display: flex; width: 100%; max-width: 100%; min-width: 0; }
.imqq-select { width: 100%; min-width: 0; justify-content: space-between; text-align: left; }
.imqq-selectValue { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqq-select svg { flex: none; }
.imqq-selectMenu { max-width: min(520px, calc(100vw - 24px)); }
.imqq-selectChoice { display: flex; flex-direction: column; gap: 2px; white-space: normal; overflow-wrap: anywhere; }
.imqq-selectDescription { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
.imqb2-selector-head > .imqq-selectAnchor { width: min(65%, 360px); }
.imqq-answerPreview { width: min(580px, calc(100vw - 32px)); }
@media(max-width:480px) { .imqb2-selector-head > .imqq-selectAnchor { width: 100%; } .imqc-tabs { overflow-x: auto; } }

.imqc-settingsView { padding: 20px max(16px, calc((100% - 920px) / 2)); padding-bottom: calc(var(--dsh-composer-height, 0px) + 24px); }
.imqc-viewHeading { display: flex; align-items: baseline; gap: 10px; }
.imqc-summary { padding: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); }
.imqc-banner { margin: 12px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.imqc-advanced { border-top: 1px solid var(--dsw-alias-border-l2); padding-block: 14px; }
.imqc-advanced > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.imqc-advanced > summary:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 3px; }
.imqc-saveBar { position: sticky; bottom: var(--dsh-composer-height, 0px); z-index: 1; background: var(--dsw-alias-bg-base); border-top: 1px solid var(--dsw-alias-border-l2); padding: 12px 0; }
.imqc-saveBar > .imqc-hint { width: 100%; }
.imqc-historyRow { display: grid; gap: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 12px; color: inherit; background: var(--dsw-alias-bg-layer-1); font: inherit; cursor: pointer; }
.imqc-historyRow:hover { background: var(--dsw-alias-bg-layer-2); }
.imqc-currentBadge { font-size: 11px; color: var(--dsw-alias-state-success-primary); }
.imqc-partDetails { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.imqc-partDetails > summary { cursor: pointer; }
.imqc-receiptId { display: block; overflow-wrap: anywhere; font-size: 11px; }
.imqc-timelineRows { display: flex; flex-direction: column; gap: 12px; margin: 14px 0; }
.imqc-timelineMessage { max-width: 85%; width: fit-content; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); display: flex; align-items: flex-start; gap: 8px; }
.imqc-timelineMessage[data-failed] { border-color: var(--dsw-alias-state-error-primary); }
.imqc-attachRow { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }
.imqc-attachChip { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.imqc-attachImage { max-width: 260px; max-height: 260px; border-radius: var(--dsw-radius-md); display: block; }
.imqc-attachVideo { max-width: 320px; border-radius: var(--dsw-radius-md); display: block; }
.imqc-attachAudio { width: 260px; }
.imqc-attachFile { font-size: 12px; color: var(--dsw-alias-label-link, var(--dsw-alias-label-secondary)); word-break: break-all; }
.imqc-timelineMessage[data-direction=outbound] { align-self: flex-end; background: var(--dsw-alias-bg-layer-2); }
.imqq-settingsModal { width: min(1000px, calc(100vw - 32px)); height: min(900px, calc(100dvh - 32px)); }
/* 弹窗内容列限高，让 body 成为滚动容器（flex 滚动经典解法 min-height:0） */
.imqq-settingsContent { min-height: 0; }
.imqq-settingsContent > :last-child { min-height: 0; overflow-y: auto; overflow-x: hidden; }
.imqq-settingsModal .imqc-settingsView { height: auto; overflow: visible; padding: 0; }
.imqq-settingsModal .imqc-saveBar { bottom: 0; }
.imqq-settingsModal .imqc-peerSettings { padding-bottom: 8px; }
@media(max-width:600px) { .imqc-timelineMessage { max-width: 96%; } .imqc-settingsView { padding: 12px; padding-bottom: calc(var(--dsh-composer-height, 0px) + 16px); } .imqc-tool { grid-template-columns: minmax(0, 1fr) 76px; } }
`;
			if (!style.isConnected) document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/conversation-answer-action.ts
		/** Read only finalized text blocks from the public Chat projection; never forward reasoning/tool output. */
		function finalizedAnswer(snapshot, messageId) {
			for (const node of snapshot.nodes.values()) {
				if (node.kind !== "turn-tail" || !node.data || typeof node.data !== "object" || !("closing" in node.data)) continue;
				const closing = node.data.closing;
				if (!closing || typeof closing !== "object" || !("status" in closing) || closing.status !== "settled" || !("finalNode" in closing) || !("blocks" in closing)) continue;
				const finalNode = closing.finalNode;
				if (!finalNode || typeof finalNode !== "object" || !("messageId" in finalNode) || finalNode.messageId !== messageId || !Array.isArray(closing.blocks)) continue;
				return closing.blocks.filter((block) => Boolean(block) && typeof block === "object" && block.kind === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
			}
			return "";
		}
		function createQQAnswerAction(store) {
			return function QQAnswerAction({ sessionId, messageId, useChat }) {
				useQQSessionStore(store);
				const text = useChat((snapshot) => finalizedAnswer(snapshot, messageId));
				const entry = store.entry(sessionId);
				if (!entry?.admitted || entry.currentSessionId !== sessionId || !text.trim()) return null;
				return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "toolbar",
					size: "sm",
					className: "imqc-answerAction",
					onClick: () => store.previewAnswer(sessionId, messageId, text)
				}, "发送到 QQ");
			};
		}
		//#endregion
		//#region src/client/conversation-native.ts
		function installNativeQQConversation(ctx, store, selectorSource, t) {
			installConversationStyles();
			ctx.effect(() => store.start(), "im-qqbot.conversation-directory");
			const Badge = ({ sessionId }) => {
				useQQSessionStore(store);
				const entry = store.entry(sessionId);
				if (!entry) return null;
				const current = entry.currentSessionId === sessionId;
				return (0, react.createElement)("span", {
					className: "imqc-sessionBadge",
					title: `${conversationName(entry)} · ${current ? "当前 QQ 会话" : "历史 QQ 会话"}`
				}, current ? "QQ" : "QQ·历史");
			};
			const Hover = ({ sessionId }) => {
				useQQSessionStore(store);
				const entry = store.entry(sessionId);
				return entry ? (0, react.createElement)("div", { className: "imqc-sessionSource" }, `${entry.scope === "group" ? "QQ 群聊" : "QQ 私聊"} · ${conversationName(entry)} · ${entry.currentSessionId === sessionId ? "当前会话" : "历史会话"}`) : null;
			};
			ctx.slots.inject("sidebar.session.row.trailing", () => ctx.slots.register({
				name: "sidebar.session.row.trailing",
				id: "qqbot-source",
				order: 30
			}, Badge));
			ctx.slots.inject("sidebar.session.row.hover", () => ctx.slots.register({
				name: "sidebar.session.row.hover",
				id: "qqbot-source",
				order: 30
			}, Hover));
			ctx.inject(["uiSession"], (viewCtx) => {
				return viewCtx.slots.inject("conversation.view", () => installQQConversationViewRegistration({
					current: viewCtx.uiSession.adapter.current,
					store,
					register: () => viewCtx.slots.register({
						name: "conversation.view",
						id: "qqbot-settings",
						order: 20,
						label: t("view.settings.title")
					}, (props) => (0, react.createElement)(QQConversationView, {
						store,
						selectorSource,
						t,
						sessionId: props.sessionId,
						useProjection: props.useProjection,
						useSessions: props.useSessions,
						useWorkspaces: props.useWorkspaces,
						defaultWorkspaceName: ctx.locale.bind("common")("workspace.defaultName")
					}))
				}));
			});
			ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
				name: "conversation.chat.assistant-actions",
				id: "qqbot-send-answer",
				order: 30
			}, createQQAnswerAction(store)));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "qqbot-conversation"
			}, (props) => (0, react.createElement)(QQConversationOverlay, {
				store,
				selectorSource,
				t,
				useWorkspaces: props.useWorkspaces,
				useSessions: props.useSessions,
				defaultWorkspaceName: ctx.locale.bind("common")("workspace.defaultName")
			})));
		}
		//#endregion
		//#region src/client/qq-sidebar-model.ts
		function qqSidebarPeers(entries, summaries, workspaces, query, defaultWorkspaceName = "默认工作区") {
			const term = query.trim().toLocaleLowerCase();
			return [...entries].sort((a, b) => b.lastActivity - a.lastActivity || a.key.localeCompare(b.key)).flatMap((entry) => {
				const name = conversationName(entry);
				const history = new Map(entry.sessions.map((session) => [session.sessionId, session]));
				if (entry.currentSessionId && !history.has(entry.currentSessionId)) history.set(entry.currentSessionId, {
					sessionId: entry.currentSessionId,
					startedAt: entry.lastActivity
				});
				const sessions = [...history.values()].map((session) => {
					const native = summaries[session.sessionId];
					const current = session.sessionId === entry.currentSessionId;
					const workspace = workspaces.find((item) => item.sessionIds.some((id) => id === session.sessionId));
					const path = native?.cwd || workspace?.path || (current ? entry.currentWorkspace?.path : null) || null;
					const workspaceTitle = (workspace?.path === path ? workspace?.title : "") || (current && path === entry.currentWorkspace?.path ? entry.currentWorkspace?.title : "");
					const nativeTitle = native?.title?.trim() ? native.title : null;
					return {
						sessionId: session.sessionId,
						nativeTitle,
						title: nativeTitle?.trim() || sessionDateTitle(session.startedAt),
						activity: native?.updatedAt ?? session.startedAt,
						workspace: qqWorkspaceName(workspaceTitle, path, defaultWorkspaceName),
						path
					};
				}).sort((a, b) => b.activity - a.activity || a.sessionId.localeCompare(b.sessionId));
				const currentSession = sessions.find((session) => session.sessionId === entry.currentSessionId) ?? null;
				const historySessions = sessions.filter((session) => session.sessionId !== entry.currentSessionId);
				const peerMatches = `${entry.name} ${entry.alias} ${entry.peerId}`.toLocaleLowerCase().includes(term);
				const matching = !term || peerMatches ? historySessions : historySessions.filter((session) => session.title.toLocaleLowerCase().includes(term));
				const currentMatches = currentSession?.title.toLocaleLowerCase().includes(term);
				const currentTitle = currentSession?.nativeTitle?.trim();
				const redundantTitle = currentTitle && [
					name,
					entry.name,
					entry.alias
				].filter(Boolean).some((label) => currentTitle === label || currentTitle.replace(/^QQ\s*[·•.]\s*/i, "") === label);
				const currentSummary = currentSession ? [currentTitle && !redundantTitle ? currentTitle : "", currentSession.workspace].filter(Boolean).join(" · ") : null;
				return !term || peerMatches || currentMatches || matching.length ? [{
					entry,
					name,
					currentSession,
					currentSummary,
					historySessions: matching
				}] : [];
			});
		}
		function sessionDateTitle(timestamp) {
			if (!Number.isFinite(timestamp) || timestamp <= 0) return "未命名会话";
			return `会话 · ${new Date(timestamp).toLocaleString("zh-CN", {
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			})}`;
		}
		function visibleQQSessions(peer, showAll) {
			return showAll ? peer.historySessions : peer.historySessions.slice(0, 5);
		}
		function qqWorkspaceName(title, path, defaultWorkspaceName = "默认工作区") {
			const label = title?.trim();
			if (label && !/[\\/]/.test(label)) return workspaceDisplayTitle(label, defaultWorkspaceName);
			return (path || label || "").split(/[\\/]/).filter(Boolean).at(-1) || (path ? "根目录" : "工作目录未知");
		}
		function qqScopeCollapsed(scope, collapsedScopes, query) {
			return !query.trim() && collapsedScopes.includes(scope);
		}
		//#endregion
		//#region src/client/qq-native-catalog.ts
		/** Re-read cold native rows after a live Agent's removal withdraws its catalog entry. */
		var QQNativeCatalogRehydrator = class {
			source;
			missing = "";
			generation = 0;
			constructor(source) {
				this.source = source;
			}
			update(entries, summaries, phase) {
				if (phase !== "ready") return;
				const ids = new Set(entries.flatMap((entry) => [...entry.sessions.map((session) => session.sessionId), ...entry.currentSessionId ? [entry.currentSessionId] : []]));
				const missing = JSON.stringify([...ids].filter((id) => summaries[id] === void 0).sort());
				if (missing === this.missing) return;
				this.missing = missing;
				const generation = ++this.generation;
				return missing === "[]" ? void 0 : this.rehydrate(ids, generation);
			}
			async rehydrate(ids, generation) {
				await this.source.refresh();
				if (generation !== this.generation) return;
				if ([...ids].some((id) => this.source.summaries()[id] === void 0)) await this.source.refresh();
			}
		};
		//#endregion
		//#region src/client/qq-sidebar.ts
		function QQSidebar({ store, actions, t, defaultWorkspaceName, wide, expandSidebar, useSessions, useWorkspaces }) {
			const state = useQQSessionStore(store);
			const native = useSessions((snapshot) => snapshot);
			const workspaces = useWorkspaces((snapshot) => snapshot.items);
			const [dialog, setDialog] = (0, react.useState)(null);
			const [catalog] = (0, react.useState)(() => new QQNativeCatalogRehydrator(actions.nativeCatalog));
			(0, react.useEffect)(() => {
				catalog.update(state.directory?.conversations ?? [], native.byId, native.phase)?.catch(() => {});
			}, [
				catalog,
				state.directory,
				native.byId,
				native.phase
			]);
			const sidebar = state.sidebar;
			const peers = qqSidebarPeers(state.directory?.conversations ?? [], native.byId, workspaces, sidebar.search, defaultWorkspaceName);
			const refresh = () => {
				store.refresh();
				actions.nativeCatalog.refresh().catch(() => {});
			};
			if (!wide) return (0, react.createElement)("div", { className: "imqq-sidebar imqq-rail" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: expandSidebar,
				"aria-label": "展开 QQ 会话导航",
				title: "展开 QQ 会话导航"
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular, { size: 18 })), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: actions.onExit,
				"aria-label": "返回工作区",
				title: "返回工作区"
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 18 })));
			return (0, react.createElement)("section", {
				className: "imqq-sidebar",
				"aria-label": "QQ 会话导航"
			}, (0, react.createElement)("header", { className: "imqq-heading" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				className: "imqq-back",
				onClick: actions.onExit,
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 14 }),
				title: "返回原生工作区导航"
			}, "工作区"), (0, react.createElement)("span", { className: "imqq-headingTitle" }, "QQ 会话"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: actions.onOpenSettings,
				"aria-label": "QQ 账号设置",
				title: "QQ 账号设置"
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: 16 }))), (0, react.createElement)("div", { className: "imqq-search" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "search",
				value: sidebar.search,
				placeholder: "搜索 QQ 或会话标题",
				"aria-label": "搜索 QQ 名称、备注或会话标题",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: 14 }),
				onChange: (event) => store.setSearch(event.target.value)
			})), state.error ? (0, react.createElement)("p", {
				className: "imqq-error",
				role: "alert"
			}, state.error) : null, (0, react.createElement)("div", { className: "imqq-tree" }, ...["group", "c2c"].map((scope) => {
				const scoped = peers.filter((peer) => peer.entry.scope === scope);
				const collapsed = qqScopeCollapsed(scope, sidebar.collapsedScopes, sidebar.search);
				const title = scope === "group" ? "群聊" : "私聊";
				return (0, react.createElement)("section", {
					key: scope,
					className: "imqq-scope",
					"aria-label": title
				}, (0, react.createElement)("button", {
					type: "button",
					className: "imqq-scopeToggle",
					"aria-expanded": !collapsed,
					onClick: () => store.toggleScope(scope)
				}, (0, react.createElement)(collapsed ? _deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular : _deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 }), (0, react.createElement)("span", null, title), (0, react.createElement)("span", { className: "imqq-count" }, scoped.length)), !collapsed ? scoped.length ? scoped.map((peer) => (0, react.createElement)(PeerRow, {
					key: peer.entry.key,
					peer,
					store,
					t,
					expanded: Boolean(sidebar.search.trim()) || sidebar.expandedPeers.includes(peer.entry.key),
					showAll: sidebar.showAllPeers.includes(peer.entry.key),
					selectedSessionId: sidebar.selectedSessionId,
					onDialog: setDialog
				})) : (0, react.createElement)("p", { className: "imqq-empty" }, state.loading && !state.directory ? "正在读取…" : sidebar.search ? "无匹配结果" : scope === "group" ? "尚未发现群聊" : "尚未发现联系人") : null);
			})), (0, react.createElement)("footer", { className: "imqq-footer" }, (0, react.createElement)("span", { role: "status" }, state.runtime?.phase === "ready" ? "QQ 已连接" : state.runtime?.phase === "unbound" ? "等待绑定" : state.runtime?.phase === "failed" ? "连接失败" : "QQ 连接状态待确认"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: refresh,
				disabled: state.loading,
				"aria-label": "刷新 QQ 会话",
				title: "刷新 QQ 会话"
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }))), dialog ? (0, react.createElement)(SidebarEditDialog, {
				key: dialog.sessionId,
				target: dialog,
				store,
				actions,
				onClose: () => setDialog(null)
			}) : null);
		}
		function PeerRow({ peer, store, t, expanded, showAll, selectedSessionId, onDialog }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const { entry, name, currentSession } = peer;
			const selected = currentSession !== null && currentSession.sessionId === selectedSessionId;
			const sessions = visibleQQSessions(peer, showAll);
			const hasHistory = peer.historySessions.length > 0;
			const expandable = hasHistory;
			const currentTooltip = [
				name,
				entry.alias && entry.name ? entry.name : "",
				currentSession?.title,
				currentSession?.workspace,
				currentSession?.path
			].filter(Boolean).join("\n");
			return (0, react.createElement)("div", { className: "imqq-peer" }, (0, react.createElement)("div", {
				className: "imqq-peerRow",
				"data-selected": selected
			}, expandable ? (0, react.createElement)("button", {
				type: "button",
				className: "imqq-toggle",
				"aria-label": `${expanded ? "收起" : "展开"}${name}的会话`,
				"aria-expanded": expanded,
				onClick: () => store.togglePeer(entry.key)
			}, (0, react.createElement)(expanded ? _deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular : _deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 12 })) : (0, react.createElement)("span", {
				className: "imqq-toggleSpace",
				"aria-hidden": true
			}), (0, react.createElement)("button", {
				type: "button",
				className: "imqq-peerOpen",
				"aria-current": selected ? "page" : void 0,
				onClick: () => store.open(entry),
				title: currentTooltip
			}, (0, react.createElement)(entry.scope === "group" ? _deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular : _deepseek_ai_dsh_client_ui_primitives.IconUserOutlineRegular, { size: 15 }), (0, react.createElement)("span", { className: "imqq-peerText" }, (0, react.createElement)("span", { className: "imqq-peerName" }, name), peer.currentSummary ? (0, react.createElement)("span", { className: "imqq-peerSummary" }, peer.currentSummary) : null), !entry.admitted ? (0, react.createElement)("span", { className: "imqq-tag" }, "待授权") : !currentSession ? (0, react.createElement)("span", { className: "imqq-tag" }, "未开始") : entry.running ? (0, react.createElement)("span", {
				className: "imqq-running",
				title: t("sidebar.receiving"),
				"aria-label": t("sidebar.receiving")
			}) : null), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				className: "imqq-quickAdd",
				"aria-label": t("sidebar.newSession.aria", { name }),
				title: t("sidebar.newSession"),
				disabled: !entry.admitted || entry.running,
				onClick: () => store.openOperation(entry)
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 14 })), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: menuOpen,
				onClose: () => setMenuOpen(false),
				portal: true,
				align: "end",
				compact: true,
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqq-menuTrigger",
					"aria-label": `管理${name}`,
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: () => setMenuOpen(!menuOpen)
				}, "···"),
				items: [
					{
						type: "label",
						id: "current-label",
						text: "当前会话"
					},
					{
						id: "rename",
						label: "重命名当前会话…",
						disabled: !currentSession
					},
					{
						id: "settings",
						label: "当前会话设置…"
					},
					{
						type: "separator",
						id: "qq-separator"
					},
					{
						type: "label",
						id: "qq-label",
						text: entry.scope === "group" ? "QQ 群聊" : "QQ 联系人"
					},
					{
						id: "messages",
						label: "消息记录…"
					}
				],
				onSelect: (id) => {
					setMenuOpen(false);
					if (id === "rename" && currentSession) onDialog({
						kind: "rename",
						sessionId: currentSession.sessionId,
						title: currentSession.nativeTitle ?? ""
					});
					else store.openDrawer(entry, id === "messages" ? "messages" : "settings");
				}
			})), expanded && (hasHistory || currentSession) ? (0, react.createElement)("div", {
				className: "imqq-sessions",
				"aria-label": `${name}的会话`
			}, currentSession ? (0, react.createElement)(SessionRow, {
				key: currentSession.sessionId,
				session: currentSession,
				entry,
				store,
				t,
				selected: selectedSessionId === currentSession.sessionId,
				current: true,
				onDialog
			}) : null, ...sessions.map((session) => (0, react.createElement)(SessionRow, {
				key: session.sessionId,
				session,
				entry,
				store,
				t,
				selected: selectedSessionId === session.sessionId,
				onDialog
			})), showAll && peer.historySessions.length > 0 ? (0, react.createElement)("button", {
				type: "button",
				className: "imqq-more",
				"aria-expanded": true,
				onClick: () => store.showAllSessions(entry.key)
			}, "收起历史") : null, !showAll && peer.historySessions.length > sessions.length ? (0, react.createElement)("button", {
				type: "button",
				className: "imqq-more",
				"aria-expanded": false,
				onClick: () => store.showAllSessions(entry.key)
			}, `查看更多历史 · 还有 ${peer.historySessions.length - sessions.length} 条`) : null) : null);
		}
		function SessionRow({ session, entry, store, t, selected, current = false, onDialog }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const copySessionId = () => {
				const text = session.sessionId;
				const done = () => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				};
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
					else fallbackCopy(text, done);
				} catch {
					fallbackCopy(text, done);
				}
			};
			return (0, react.createElement)("div", {
				className: "imqq-sessionRow",
				"data-selected": selected,
				"data-current": current
			}, (0, react.createElement)("button", {
				type: "button",
				className: "imqq-sessionOpen",
				"aria-current": selected ? "page" : void 0,
				onClick: () => store.openSession(session.sessionId, { preserveVisibleFilter: true }),
				title: `${session.title}\n${current ? "当前生效会话" : "历史会话"}\n${session.workspace}${session.path && session.path !== session.workspace ? `\n${session.path}` : ""}`
			}, (0, react.createElement)("span", { className: "imqq-sessionTitle" }, (0, react.createElement)("span", {
				className: "imqq-sessionTitleText",
				title: session.title
			}, session.title), current ? (0, react.createElement)("span", {
				className: "imqq-sessionCurrent",
				title: t("sidebar.current.title")
			}, t("sidebar.current")) : null), (0, react.createElement)("span", { className: "imqq-sessionMeta" }, (0, react.createElement)("span", { className: "imqq-workspace" }, session.workspace), copied ? (0, react.createElement)("span", { className: "imqq-copied" }, "已复制") : null)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: menuOpen,
				onClose: () => setMenuOpen(false),
				portal: true,
				align: "end",
				compact: true,
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqq-menuTrigger",
					"aria-label": `会话菜单 ${session.title}`,
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: () => setMenuOpen(!menuOpen)
				}, "···"),
				items: [
					{
						type: "label",
						id: "history-label",
						text: "此历史会话"
					},
					{
						id: "rename",
						label: "重命名历史会话…"
					},
					{
						id: "copyId",
						label: "复制 Session ID"
					},
					{
						type: "separator",
						id: "current-separator"
					},
					{
						id: "newSession",
						label: "新建会话…",
						disabled: !entry.admitted || entry.running
					}
				],
				onSelect: (id) => {
					setMenuOpen(false);
					if (id === "rename") onDialog({
						kind: "rename",
						sessionId: session.sessionId,
						title: session.nativeTitle ?? ""
					});
					else if (id === "copyId") copySessionId();
					else if (id === "newSession") store.openOperation(entry);
				}
			}));
		}
		/** Clipboard fallback for browsers/contexts without the async Clipboard API. */
		function fallbackCopy(text, done) {
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.style.position = "fixed";
				area.style.opacity = "0";
				document.body.appendChild(area);
				area.select();
				document.execCommand("copy");
				document.body.removeChild(area);
				done();
			} catch {}
		}
		function SidebarEditDialog({ target, store, actions, onClose }) {
			const [value, setValue] = (0, react.useState)(target.title);
			const [busy, setBusy] = (0, react.useState)(false);
			const submitting = (0, react.useRef)(false);
			const [error, setError] = (0, react.useState)(null);
			const intent = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => intent.current?.cancel(), []);
			const close = () => {
				intent.current?.cancel();
				onClose();
			};
			const submit = (event) => {
				event.preventDefault();
				if (busy || !value.trim() || submitting.current) return;
				submitting.current = true;
				setBusy(true);
				setError(null);
				const navigation = store.navigationIntent();
				intent.current = navigation;
				actions.renameSession(target.sessionId, value.trim()).then(() => {
					if (navigation.current()) close();
				}).catch((cause) => {
					if (navigation.current()) setError(cause instanceof Error ? cause.message : "保存失败");
				}).finally(() => {
					submitting.current = false;
					setBusy(false);
				});
			};
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: close,
				title: "重命名会话",
				closeLabel: "关闭",
				className: "imqq-editModal",
				children: (0, react.createElement)("form", {
					className: "imqq-editForm",
					onSubmit: submit
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value,
					disabled: busy,
					"aria-label": "会话标题",
					"data-modal-autofocus": true,
					maxLength: 200,
					onChange: (event) => setValue(event.target.value)
				}), error ? (0, react.createElement)("p", {
					className: "imqq-error",
					role: "alert"
				}, error) : null, (0, react.createElement)("div", { className: "imqq-dialogActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: close
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "submit",
					variant: "primary",
					size: "sm",
					disabled: busy || !value.trim()
				}, busy ? "保存中…" : "保存")))
			});
		}
		//#endregion
		//#region src/client/qq-locale.ts
		const QQ_LOCALE_NS = "qqbot";
		/** 命名空间全部键（zh 作为类型基准；en 必须提供同键）。导出仅供测试构造 t。 */
		const ZH = {
			"view.settings.title": "QQ 会话设置",
			"peer.settings.aria": "会话设置",
			"peer.deferred.hint": "补充提示词立即生效；Agent 预设与工作目录在下次新会话生效；模型与权限可在原生输入区调整。",
			"peer.saveHint.dirty": "有未保存修改。",
			"peer.saveHint.saved": "已保存。",
			"sidebar.newSession": "新建会话",
			"sidebar.newSession.aria": "为{name}新建会话",
			"sidebar.current": "当前",
			"sidebar.current.title": "当前生效会话",
			"sidebar.receiving": "正在接收 QQ 消息",
			"defaults.title": "新对话默认值",
			"defaults.hint": "之后首次接入的群聊和私聊复制这些设置。保存立即生效，不改动已接入的对话，也不会重载插件。",
			"defaults.save": "保存默认设置（即时生效）",
			"account.title": "账号与访问",
			"account.hint": "这一栏决定外部 QQ 用户能否触发本机 DSH、以及谁算管理员，只能在 DSH Web 配置。DSH 本身没有白名单——能打开本页面的人就是本机操作者。",
			"owners.title": "斜杠命令超管",
			"owners.hint": "在任何 QQ 会话里都能使用斜杠命令（含 /model、/preset、/permission 等改动类命令）、审批工具调用、回答机器人提问与中止任务。它不开放工具、也不绕过执行权限——工具与权限仍在会话设置里配置。",
			"owners.count": "{count} 个 OpenID。斜杠命令超管见下方说明。"
		};
		const EN = {
			"view.settings.title": "QQ chat settings",
			"peer.settings.aria": "Chat settings",
			"peer.deferred.hint": "Extra prompt applies immediately; agent preset and working directory apply to the next new session; model and permission can be changed in the native composer.",
			"peer.saveHint.dirty": "Unsaved changes.",
			"peer.saveHint.saved": "Saved.",
			"sidebar.newSession": "New session",
			"sidebar.newSession.aria": "Start a new session for {name}",
			"sidebar.current": "Current",
			"sidebar.current.title": "Current session",
			"sidebar.receiving": "Receiving QQ messages",
			"defaults.title": "New-conversation defaults",
			"defaults.hint": "Newly admitted group and private chats copy these settings. Saving takes effect immediately, leaves admitted chats unchanged, and does not reload the plugin.",
			"defaults.save": "Save defaults (instant)",
			"account.title": "Account & access",
			"account.hint": "This section decides whether external QQ users can drive this local DSH, and who counts as an admin. It is configured only in DSH Web. DSH itself has no allowlist — anyone who can open this page is the local operator.",
			"owners.title": "Slash-command superadmin",
			"owners.hint": "Can use slash commands in any QQ chat (including mutating ones like /model, /preset, /permission), approve tool calls, answer bot questions, and stop tasks. This does not open tools or bypass execution permission — tools and permissions are configured in each chat settings.",
			"owners.count": "{count} OpenID(s). See the note below for what slash-command superadmin can do."
		};
		/** 注册 qqbot 命名空间（在 apply 的 effect 内调用；返回 disposer）。 */
		function registerQQLocale(ctx) {
			return ctx.locale.register("qqbot", "zh", ZH) && ctx.locale.register("qqbot", "en", EN);
		}
		/** 绑定 qqbot 命名空间的翻译函数（类型退化为通用 key，仅本模块保证键存在）。 */
		function bindQQ(ctx) {
			return ctx.locale.bind(QQ_LOCALE_NS);
		}
		//#endregion
		//#region src/client/qq-sidebar-navigation.ts
		const QQ_MAIN_PANEL_ID = "im-qqbot";
		/** Own navigation keeps QQ browsing active; a native navigation restores the workspace browser. */
		function installQQSidebarNavigation({ store, layout, currentSession, navigation, mountSidebar }) {
			let disposed = false;
			let ownNavigation = false;
			let pendingRestore = false;
			let stopLease;
			let stopSidebar;
			let currentKey = currentSession.getSnapshot().key;
			let panelId = layout.panelInfo.getSnapshot().activePanelId;
			const disarm = () => {
				stopLease?.();
				stopLease = void 0;
			};
			const exit = () => {
				pendingRestore = false;
				disarm();
				store.cancelNavigation();
				store.setSidebarMode("workspace");
			};
			const arm = () => {
				disarm();
				if (layout.panelInfo.getSnapshot().activePanelId !== null) return;
				const signal = layout.beginNavigation();
				signal.addEventListener("abort", exit, { once: true });
				stopLease = () => signal.removeEventListener("abort", exit);
			};
			const showQQ = () => {
				store.setSidebarMode("qq");
			};
			const openSession = (sessionId) => {
				pendingRestore = false;
				disarm();
				ownNavigation = true;
				try {
					showQQ();
					navigation.openSession(SessionId(sessionId));
				} finally {
					ownNavigation = false;
				}
				arm();
			};
			const enter = (restore = true) => {
				if (disposed) return;
				pendingRestore = restore && store.getSnapshot().directory === null;
				showQQ();
				const id = restore ? store.resumeSessionId() : null;
				if (id) store.openSession(id, { revealHistory: false });
				else arm();
			};
			const openSettings = () => {
				pendingRestore = false;
				store.cancelNavigation();
				disarm();
				ownNavigation = true;
				try {
					showQQ();
					layout.selectPanel(QQ_MAIN_PANEL_ID);
				} finally {
					ownNavigation = false;
				}
				arm();
			};
			const stopNavigation = store.installNavigation(openSession);
			const syncSidebar = () => {
				if (store.getSnapshot().sidebar.sidebarMode === "qq") stopSidebar ??= mountSidebar();
				else {
					stopSidebar?.();
					stopSidebar = void 0;
				}
				if (pendingRestore && store.getSnapshot().directory) {
					pendingRestore = false;
					const id = store.resumeSessionId();
					if (id && store.getSnapshot().sidebar.sidebarMode === "qq") store.openSession(id, { revealHistory: false });
				}
			};
			const stopStore = store.subscribe(syncSidebar);
			const stopPanel = layout.panelInfo.subscribe(() => {
				const id = layout.panelInfo.getSnapshot().activePanelId;
				if (id === panelId) return;
				const previous = panelId;
				panelId = id;
				if (ownNavigation) return;
				if (id === "im-qqbot") enter();
				else if (id !== null || previous === "im-qqbot") exit();
			});
			const stopCurrent = currentSession.subscribe(() => {
				const next = currentSession.getSnapshot().key;
				if (next === currentKey) return;
				currentKey = next;
				if (ownNavigation) return;
				store.cancelNavigation();
				queueMicrotask(() => {
					if (disposed || currentSession.getSnapshot().key !== next || layout.panelInfo.getSnapshot().activePanelId !== null) return;
					if (next && store.entry(next)) {
						store.selectSession(next, { revealHistory: false });
						enter(false);
					} else exit();
				});
			});
			syncSidebar();
			if (layout.panelInfo.getSnapshot().activePanelId === "im-qqbot") enter();
			return {
				enter,
				exit,
				openSettings,
				dispose: () => {
					disposed = true;
					store.cancelNavigation();
					disarm();
					stopCurrent();
					stopPanel();
					stopStore();
					stopNavigation();
					stopSidebar?.();
					stopSidebar = void 0;
					store.setSidebarMode("workspace");
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"remote",
			"remote.session",
			"remote.workspace",
			"remote.agentPresets",
			"remote.permissionPresets",
			"locale",
			"uiWorkspace"
		];
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = QQ_MAIN_PANEL_ID;
		const EMPTY_WORKSPACES = [];
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		function QQBotSettingsSection({ selectorSource, store, t, workspaces, defaultWorkspaceName }) {
			const { state, gone, error, recheck } = useBindState();
			return (0, react.createElement)("div", { className: "imqb-cards" }, (0, react.createElement)("section", {
				className: "imqb-card",
				"aria-label": t("account.title")
			}, (0, react.createElement)("h2", { className: "imqb-cardTitle" }, t("account.title")), (0, react.createElement)("p", { className: "imqb-cardHint" }, t("account.hint")), (0, react.createElement)(BindPanelBody, {
				state,
				gone,
				error,
				recheck
			}), (0, react.createElement)(ConfigPanel, {
				bindPhase: state?.phase,
				selectorSource,
				t
			}), (0, react.createElement)(QQAccountOwners, {
				store,
				t,
				bound: state?.phase === "bound"
			})), (0, react.createElement)("section", {
				className: "imqb-card",
				"aria-label": "新对话默认值"
			}, (0, react.createElement)(QQDefaultsSettings, {
				store,
				selectorSource,
				t,
				workspaces,
				defaultWorkspaceName
			})));
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage({ selectorSource, store, t, initialSettings, installSettingsHandler, workspaces, defaultWorkspaceName }) {
			const [settings, setSettings] = (0, react.useState)(initialSettings);
			(0, react.useEffect)(() => {
				installSettingsHandler(() => setSettings(true));
				return () => installSettingsHandler(void 0);
			}, [installSettingsHandler]);
			return (0, react.createElement)("div", { style: {
				height: "100%",
				minHeight: 0,
				position: "relative",
				display: "flex",
				flexDirection: "column"
			} }, !settings ? (0, react.createElement)(ConversationPanel, {
				store,
				onOpenSettings: () => setSettings(true)
			}) : null, settings ? (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => setSettings(false)
			}, "‹ 返回 QQ 会话"), (0, react.createElement)("h1", { className: "imqb-pageTitle" }, "QQ 机器人"), (0, react.createElement)("p", { className: "imqb-pageDescription" }, "管理机器人账号、可对话范围与新对话默认值"), (0, react.createElement)(QQBotSettingsSection, {
				selectorSource,
				store,
				t,
				workspaces,
				defaultWorkspaceName
			}))) : null);
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function QqBotSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			ctx.effect(() => registerQQLocale(ctx), "qqbot-locale: dictionaries");
			const t = bindQQ(ctx);
			const selectorSource = {
				permissionCatalog: () => ctx.remote.permissionPresets.catalog(),
				modelCatalog: () => ctx.remote.session.modelCatalog(),
				pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
				createWorkspace: async (path) => {
					const result = await ctx.remote.workspace.create({ path });
					if (!result.ok) throw new Error(result.error.message);
					return {
						workspaceId: String(result.value.workspace.workspaceId),
						title: result.value.workspace.title,
						path: result.value.workspace.path
					};
				},
				listAgentPresets: async () => {
					const result = await ctx.remote.agentPresets.list();
					if (!result.ok) return result;
					const copy = ctx.locale.bind("settings.agentPreset");
					return {
						...result,
						value: {
							...result.value,
							presets: result.value.presets.map((preset) => ({
								...preset,
								...presetDisplayText(preset, copy)
							}))
						}
					};
				}
			};
			const store = new QQSessionStore(ctx.uiWorkspace);
			const defaultWorkspaceName = ctx.locale.bind("common")("workspace.defaultName");
			const workspacesSource = ctx.get?.("workspaces");
			const useWorkspacesList = () => {
				const list = workspacesSource?.list;
				return (0, react.useSyncExternalStore)((listener) => list ? list.subscribe(listener) : () => {}, () => list ? list.getSnapshot().items : EMPTY_WORKSPACES);
			};
			const SettingsSection = () => (0, react.createElement)(QQBotSettingsSection, {
				selectorSource,
				store,
				t,
				workspaces: useWorkspacesList(),
				defaultWorkspaceName
			});
			let settingsRequested = false;
			let showSettings;
			const installSettingsHandler = (handler) => {
				showSettings = handler;
			};
			const initialSettings = () => {
				const value = settingsRequested;
				settingsRequested = false;
				return value;
			};
			const MainPage = () => (0, react.createElement)(QQBotPage, {
				selectorSource,
				store,
				t,
				initialSettings,
				installSettingsHandler,
				workspaces: useWorkspacesList(),
				defaultWorkspaceName
			});
			const slots = ctx.slots;
			const disposers = [];
			installNativeQQConversation(ctx, store, selectorSource, t);
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, SettingsSection)));
			ctx.inject([
				"layout",
				"uiSession",
				"sessions"
			], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, MainPage));
				const showAccountSettings = () => {
					settingsRequested = !showSettings;
					showSettings?.();
					navigation.openSettings();
				};
				const actions = {
					onExit: () => {
						navigation.exit();
						layout.selectPanel(null);
					},
					onOpenSettings: showAccountSettings,
					nativeCatalog: {
						refresh: () => pageCtx.sessions.refresh(),
						summaries: () => pageCtx.sessions.list.getSnapshot().byId
					},
					renameSession: async (sessionId, title) => {
						await pageCtx.sessions.using(SessionId(sessionId), { source: "qqbotOperation" }, async (reference) => {
							const result = await reference.binding.session.rename(title);
							if (!result.ok) throw new Error(result.error.message);
						});
					}
				};
				const navigation = installQQSidebarNavigation({
					store,
					layout,
					currentSession: pageCtx.uiSession.adapter.current,
					navigation: pageCtx.uiWorkspace,
					mountSidebar: () => pageSlots.inject("sidebar.workspaces", () => pageSlots.register({
						name: "sidebar.workspaces",
						priority: -1
					}, (props) => (0, react.createElement)(QQSidebar, {
						...props,
						store,
						actions,
						t,
						defaultWorkspaceName: ctx.locale.bind("common")("workspace.defaultName")
					})))
				});
				const detailSlots = pageSlots;
				const stopActions = detailSlots.inject("plugins.detail.actions", () => detailSlots.register({
					name: "plugins.detail.actions",
					id: "im-qqbot-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: showAccountSettings
					})
				}, OpenQqBotAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "QQ 机器人"
				}, QqBotSidebarIcon));
				return () => {
					navigation.dispose();
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.binding");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map