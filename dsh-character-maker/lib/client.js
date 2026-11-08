window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-character-maker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/ui-kit.ts
		/**
		* dsh-workbench-kit / ui-kit
		*
		* 五个面板共用的设计变量与基础样式。
		*
		* 配色原则：只依赖 DSH 已提供的 `--dsh-fg / --dsh-bg-alt / --dsh-border`，
		* 其余层级全部用 `color-mix()` 从前景色派生——深色主题自动变亮、浅色主题自动变暗，
		* 不写死 #26262e 这类深色底，避免浅色主题下出现「黑卡片」。
		*
		* ⚠️ 自动生成到各插件，源文件在 shared/dsh-workbench-kit/src/ui-kit.ts。
		*/
		/** 面板根节点（各插件自己的根类名） */
		const ROOTS = ":where(.nw-root, .dl-root, .mf-root, .ci-root, .cm-root, .dub-root)";
		const WB_KIT_CSS = `
${ROOTS} {
  --wb-fg: var(--dsh-fg, #e8e8ee);
  --wb-surface: var(--dsh-bg-alt, color-mix(in srgb, var(--wb-fg) 5%, transparent));
  --wb-surface-2: color-mix(in srgb, var(--wb-fg) 9%, transparent);
  --wb-line: var(--dsh-border, color-mix(in srgb, var(--wb-fg) 14%, transparent));
  --wb-line-soft: color-mix(in srgb, var(--wb-fg) 8%, transparent);
  --wb-dim: color-mix(in srgb, var(--wb-fg) 74%, transparent);
  --wb-faint: color-mix(in srgb, var(--wb-fg) 50%, transparent);
  --wb-accent: var(--dsh-accent, #7f6df2);
  --wb-accent-weak: color-mix(in srgb, var(--wb-accent) 15%, transparent);
  --wb-accent-text: color-mix(in srgb, var(--wb-accent) 62%, var(--wb-fg));
  --wb-danger: #e2606f;
  --wb-danger-weak: rgba(226, 96, 111, .14);
  --wb-ok: #4bbd85;
  --wb-radius: 10px;
  --wb-radius-sm: 7px;
  --wb-shadow: 0 1px 2px rgba(0, 0, 0, .14), 0 12px 28px -20px rgba(0, 0, 0, .55);
  --wb-shadow-lg: 0 28px 80px -28px rgba(0, 0, 0, .72);
  color: var(--wb-fg);
  font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
  font-size: 13px;
  line-height: 1.62;
  font-feature-settings: "kern" 1;
  -webkit-font-smoothing: antialiased;
}
${ROOTS} * { box-sizing: border-box; }
${ROOTS} :is(button, select, input, textarea) { font-family: inherit; font-size: inherit; color: inherit; }
${ROOTS} :is(button, select, input[type="checkbox"], input[type="range"]) { accent-color: var(--wb-accent); }
${ROOTS} :is(button, [role="button"], label, .nw-tab, .cm-tab) { -webkit-tap-highlight-color: transparent; }
${ROOTS} :is(button, select, input, textarea, [tabindex]):focus-visible {
  outline: 2px solid color-mix(in srgb, var(--wb-accent) 62%, transparent);
  outline-offset: 1px;
}
${ROOTS} ::-webkit-scrollbar { width: 10px; height: 10px; }
${ROOTS} ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--wb-fg) 16%, transparent);
  border: 3px solid transparent; background-clip: padding-box; border-radius: 99px;
}
${ROOTS} ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--wb-fg) 28%, transparent); background-clip: padding-box; }
${ROOTS} ::-webkit-scrollbar-track { background: transparent; }
${ROOTS} ::selection { background: color-mix(in srgb, var(--wb-accent) 34%, transparent); }
${ROOTS} :is(button, .nw-tab, .cm-tab) { transition: background-color .14s ease, border-color .14s ease, color .14s ease, box-shadow .14s ease, transform .14s ease; }
${ROOTS} :is(button, .nw-tab, .cm-tab):active { transform: translateY(.5px); }
${ROOTS} :is(button, input, select, textarea):disabled { opacity: .5; cursor: not-allowed; }
${ROOTS} :is(button, .nw-tab, .cm-tab, [role="button"]) { touch-action: manipulation; }
@media (prefers-reduced-motion: reduce) {
  ${ROOTS} *, ${ROOTS} *::before, ${ROOTS} *::after { transition-duration: .001ms !important; animation-duration: .001ms !important; }
}
`;
		//#endregion
		//#region src/client/workbench-context.ts
		/**
		* dsh-workbench-kit / workbench-context
		*
		* 跨面板共享的「当前项目 / 章节 / 角色」上下文。
		*
		* ⚠️ 本文件是唯一源文件，由 `tools/sync-workbench-kit.mjs` 复制到各插件的
		*    `src/client/workbench-context.ts`。**不要直接改插件里的副本**，
		*    改这里后跑：node tools/sync-workbench-kit.mjs
		*
		* 为什么不用插件间 API：面板可能被渲染在不同文档里，也可能同文档。
		*  - 同文档：localStorage 的 `storage` 事件不触发，用 CustomEvent；
		*  - 跨文档：CustomEvent 不跨文档，用 `storage` 事件。
		* 两条通道都监听，写入时都发，天然覆盖两种情况。
		*/
		const STORAGE_KEY = "dsh-workbench-ctx-v1";
		const EVENT_NAME = "dsh-workbench-ctx-change";
		const EMPTY = {
			projectId: "",
			chapterId: "",
			characterId: "",
			characterName: "",
			updatedAt: 0,
			source: ""
		};
		function normalize(raw) {
			if (!raw || typeof raw !== "object") return { ...EMPTY };
			const o = raw;
			const str = (v) => typeof v === "string" ? v : "";
			return {
				projectId: str(o.projectId),
				chapterId: str(o.chapterId),
				characterId: str(o.characterId),
				characterName: str(o.characterName),
				updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
				source: str(o.source)
			};
		}
		/** 读取当前共享上下文（localStorage 不可用时返回空值） */
		function readContext() {
			try {
				return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
			} catch {
				return { ...EMPTY };
			}
		}
		/** 落盘 + 广播（内部使用） */
		function commit(next) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {}
			try {
				window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
			} catch {}
		}
		/**
		* 切换「当前项目」：项目变了就顺带清空章节/角色。
		* 一次写入完成，避免先清后设产生两个中间态事件。
		*/
		function setProjectContext(projectId, source) {
			if (!projectId) return;
			const cur = readContext();
			if (cur.projectId === projectId) return;
			commit({
				...cur,
				projectId,
				chapterId: "",
				characterId: "",
				characterName: "",
				updatedAt: Date.now(),
				source
			});
		}
		/**
		* 合并写入共享上下文。
		* 只覆盖传入的非空字段；值无变化时不写、不发事件（避免面板之间来回刷）。
		*/
		function patchContext(patch, source) {
			const cur = readContext();
			const next = { ...cur };
			let changed = false;
			for (const key of [
				"projectId",
				"chapterId",
				"characterId",
				"characterName"
			]) {
				const v = patch[key];
				if (typeof v === "string" && v && v !== cur[key]) {
					next[key] = v;
					changed = true;
				}
			}
			if (!changed) return;
			next.updatedAt = Date.now();
			next.source = source;
			commit(next);
		}
		/** 订阅共享上下文变化，返回取消订阅函数 */
		function subscribeContext(fn) {
			const onCustom = (e) => {
				const detail = e.detail;
				fn(detail ? normalize(detail) : readContext());
			};
			const onStorage = (e) => {
				if (e.key !== null && e.key !== STORAGE_KEY) return;
				fn(readContext());
			};
			window.addEventListener(EVENT_NAME, onCustom);
			window.addEventListener("storage", onStorage);
			return () => {
				window.removeEventListener(EVENT_NAME, onCustom);
				window.removeEventListener("storage", onStorage);
			};
		}
		/**
		* React hook：拿到共享上下文，并在其他面板改动时重渲染。
		* `source` 用于标记本面板写入来源；返回的第二个值是写入函数。
		*/
		function useWorkbenchContext(source) {
			const [ctx, setCtx] = (0, react.useState)(() => readContext());
			(0, react.useEffect)(() => subscribeContext(setCtx), []);
			const publish = (patch) => patchContext(patch, source);
			return [ctx, publish];
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-character-maker — client 面板（conversation.view slot）。
		* 角色设定工作坊 UI：本地角色卡库 + dsh-novel-writer 联动浏览 + 一键生成六节角色详析
		* + 新增「关系网」：角色互动分析的可视化关系图（SVG force 布局）+ 互动深析管理。
		*
		* ⚠️ 必坑：
		*  ① apply 用 ctx.slots 必须 export const inject = ['slots']；
		*  ② register 必须带 name 字段（= slot 名），否则报 "slot undefined is not declared"；
		*  ③ web 端 slot 渲染器是 React，react 由 ModuleLoader 提供——本面板组件是 React 组件，
		*    用 createElement 直写（不引 JSX/TSX），避免额外构建配置。
		*
		* ⚠️ 数据同步：server 以 store.revision 递增标记一切写操作，本面板每 3s 轮询 /revision，
		* 发现版本变化即整体刷新——保证 agent 在对话里用 character_* / character_interaction_*
		* 产生的任何更新（角色、详析、互动）都会自动同步到 UI，无需手动点刷新。
		*/
		const inject = ["slots"];
		const PANEL_ID = "dsh-character-maker";
		const API = "/@dsh-external/dsh-character-maker/api";
		const CSS = WB_KIT_CSS + `
/* ── 角色工作坊 ── */
.cm-root { padding: 14px 16px 30px; height: 100%; overflow-y: auto; }

.cm-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.cm-bar select, .cm-bar button {
  height: 28px; padding: 0 11px;
  background: var(--wb-surface); color: var(--wb-fg);
  border: 1px solid var(--wb-line); border-radius: var(--wb-radius-sm);
  font-size: 12px; cursor: pointer;
}
.cm-bar select:hover, .cm-bar button:hover {
  background: var(--wb-surface-2);
  border-color: color-mix(in srgb, var(--wb-accent) 45%, var(--wb-line));
}
.cm-tabs {
  position: sticky; top: 0; z-index: 15;
  display: flex; flex-wrap: wrap; gap: 2px;
  padding: 3px; margin-bottom: 12px;
  background: var(--wb-surface);
  border: 1px solid var(--wb-line-soft);
  border-radius: calc(var(--wb-radius-sm) + 2px);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.cm-tab { padding: 5px 12px; border-radius: var(--wb-radius-sm); font-size: 12px; color: var(--wb-dim); cursor: pointer; user-select: none; white-space: nowrap; }
.cm-tab:hover { color: var(--wb-fg); background: var(--wb-surface-2); }
.cm-tab.on { color: var(--wb-fg); background: var(--wb-surface-2); box-shadow: inset 0 0 0 1px var(--wb-line), 0 1px 2px rgba(0, 0, 0, .16); }

.cm-sec {
  display: flex; align-items: center; gap: 8px;
  margin: 14px 0 8px; font-size: 11.5px; font-weight: 600;
  letter-spacing: .04em; color: var(--wb-dim);
}
.cm-sec::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--wb-accent); }

.cm-card, .cm-novelcard {
  background: var(--wb-surface); border: 1px solid var(--wb-line-soft);
  border-radius: var(--wb-radius); padding: 10px 13px; margin-bottom: 9px;
  transition: border-color .14s ease, box-shadow .14s ease;
}
.cm-card:hover, .cm-novelcard:hover { border-color: color-mix(in srgb, var(--wb-fg) 18%, transparent); }
.cm-card h4 { margin: 0 0 5px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cm-card h4 .grow { flex: 1; min-width: 0; }

.cm-badge {
  display: inline-block; margin-left: 4px; padding: 1px 7px;
  font-size: 10px; line-height: 1.7; border-radius: 99px;
  color: var(--wb-accent-text); background: var(--wb-accent-weak);
  border: 1px solid color-mix(in srgb, var(--wb-accent) 22%, transparent);
}
.cm-tag {
  display: inline-block; margin-left: 4px; padding: 1px 8px;
  font-size: 10.5px; line-height: 1.7; border-radius: 99px;
  color: var(--wb-dim); background: color-mix(in srgb, var(--wb-fg) 5%, transparent);
  border: 1px solid var(--wb-line-soft);
}
.cm-sub { margin-top: 4px; font-size: 11.5px; line-height: 1.7; color: var(--wb-faint); white-space: pre-wrap; }
.cm-note { margin-top: 6px; font-size: 11.5px; line-height: 1.75; color: var(--wb-faint); }
.cm-sync { margin-left: auto; font-size: 10.5px; color: var(--wb-faint); white-space: nowrap; }
.cm-line { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; line-height: 1.85; white-space: pre-wrap; color: var(--wb-dim); }

.cm-empty {
  padding: 26px 18px; text-align: center; font-size: 12px; color: var(--wb-faint);
  background: color-mix(in srgb, var(--wb-fg) 2.5%, transparent);
  border: 1px dashed var(--wb-line); border-radius: var(--wb-radius);
}

.cm-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 7px; }
.cm-btn {
  height: 24px; padding: 0 9px;
  background: var(--wb-surface); color: var(--wb-dim);
  border: 1px solid var(--wb-line); border-radius: 6px;
  font-size: 11.5px; cursor: pointer;
}
.cm-btn:hover:not(:disabled) { color: var(--wb-fg); border-color: color-mix(in srgb, var(--wb-accent) 50%, var(--wb-line)); }
.cm-btn.primary { background: var(--wb-accent); border-color: transparent; color: #fff; font-weight: 600; }
.cm-btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.cm-btn.danger { color: var(--wb-danger); border-color: color-mix(in srgb, var(--wb-danger) 55%, transparent); }
.cm-btn.danger:hover:not(:disabled) { background: var(--wb-danger-weak); border-color: var(--wb-danger); }
.cm-probar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 9px; }
.cm-probar select {
  height: 30px; padding: 0 10px;
  background: color-mix(in srgb, var(--wb-fg) 4%, transparent); color: var(--wb-fg);
  border: 1px solid var(--wb-line); border-radius: var(--wb-radius-sm); font-size: 12px;
}

/* 关系网 */
.cm-net { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.cm-graph {
  flex: 1 1 420px; min-width: 320px; padding: 8px;
  background: color-mix(in srgb, var(--wb-fg) 3%, transparent);
  border: 1px solid var(--wb-line-soft); border-radius: var(--wb-radius);
}
.cm-graph svg { display: block; width: 100%; height: auto; user-select: none; }
.cm-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; font-size: 10.5px; color: var(--wb-dim); }
.cm-legend .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.cm-edge-tip { cursor: pointer; }
.cm-detail { flex: 1 1 300px; min-width: 260px; }

/* 表单 */
.cm-form {
  margin-top: 9px; padding: 11px 13px;
  background: color-mix(in srgb, var(--wb-fg) 3%, transparent);
  border: 1px solid var(--wb-line-soft); border-radius: var(--wb-radius);
}
.cm-form label { display: block; margin: 6px 0 3px; font-size: 11px; color: var(--wb-dim); }
.cm-form input, .cm-form select {
  width: 100%; min-height: 30px; padding: 4px 8px;
  background: color-mix(in srgb, var(--wb-fg) 4%, transparent); color: var(--wb-fg);
  border: 1px solid var(--wb-line); border-radius: 6px; font-size: 12px;
}
.cm-form .row { display: flex; gap: 10px; }
.cm-form .row > div { flex: 1; }

/* 问卷 */
.cm-quizbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 9px; font-size: 11.5px; color: var(--wb-dim); }
.cm-quizq {
  margin-bottom: 8px; padding: 10px 12px;
  background: var(--wb-surface); border: 1px solid var(--wb-line-soft);
  border-radius: var(--wb-radius);
}
.cm-quizstem { margin-bottom: 6px; font-size: 12.5px; line-height: 1.65; }
.cm-quizq .cm-btn { display: block; width: 100%; height: auto; padding: 6px 10px; margin-top: 4px; text-align: left; line-height: 1.6; }
.cm-quizq .cm-btn.primary { text-align: left; }

`;
		const ROLE_LABEL = {
			protagonist: "主角",
			supporting: "配角",
			antagonist: "反派",
			minor: "路人"
		};
		const NODE_FILL = {
			0: "#7c6cf0",
			1: "#4a90d9",
			2: "#e05656",
			3: "#667",
			4: "#888"
		};
		const STANCE_COLOR = [
			[/敌|仇|对立|宿敌|情敌/i, "#e05656"],
			[/利用|支配|臣服|依附/i, "#e0a24a"],
			[/恋|暧昧|亲近|亲密|爱|依恋/i, "#e07bd0"],
			[/盟友|同盟|伙伴|合作|恩|师生|师徒|血亲|挚友|知交/i, "#4ab07a"],
			[/复杂|纠缠/i, "#b08ae0"],
			[/敬畏|惧|戒备|疏远/i, "#7f8ca3"]
		];
		function stanceColor(s) {
			for (const [re, c] of STANCE_COLOR) if (re.test(String(s))) return c;
			return "#888";
		}
		/** 简单 force-directed 布局：返回 {id:{x,y}} */
		function layoutGraph(nodes, edges) {
			const W = 760, H = 520;
			const pos = {};
			const vel = {};
			const n = nodes.length;
			nodes.forEach((nd, i) => {
				const ang = i / Math.max(1, n) * Math.PI * 2;
				pos[nd.id] = {
					x: W / 2 + Math.cos(ang) * Math.min(W, H) * .38,
					y: H / 2 + Math.sin(ang) * Math.min(W, H) * .38
				};
				vel[nd.id] = {
					x: 0,
					y: 0
				};
			});
			const R = 3200, K = .02, C = .012;
			const iterations = n > 80 ? 24 : n > 40 ? 45 : n > 20 ? 70 : 90;
			for (let iter = 0; iter < iterations; iter++) {
				nodes.forEach((a) => {
					nodes.forEach((b) => {
						if (a.id === b.id) return;
						const dx = pos[a.id].x - pos[b.id].x, dy = pos[a.id].y - pos[b.id].y;
						let d2 = dx * dx + dy * dy;
						if (d2 < 1) d2 = 1;
						const f = R / d2;
						const d = Math.sqrt(d2);
						vel[a.id].x += dx / d * f;
						vel[a.id].y += dy / d * f;
					});
					vel[a.id].x += (W / 2 - pos[a.id].x) * C;
					vel[a.id].y += (H / 2 - pos[a.id].y) * C;
				});
				edges.forEach((e) => {
					const a = pos[e.source], b = pos[e.target];
					if (!a || !b) return;
					const dx = b.x - a.x, dy = b.y - a.y;
					const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
					const f = K * (d - 140);
					const fx = dx / d * f, fy = dy / d * f;
					vel[e.source].x += fx;
					vel[e.source].y += fy;
					vel[e.target].x -= fx;
					vel[e.target].y -= fy;
				});
				nodes.forEach((nd) => {
					vel[nd.id].x *= .85;
					vel[nd.id].y *= .85;
					pos[nd.id].x += vel[nd.id].x;
					pos[nd.id].y += vel[nd.id].y;
				});
			}
			return pos;
		}
		function CharacterPanel() {
			const [tab, setTab] = (0, react.useState)("local");
			const [locals, setLocals] = (0, react.useState)([]);
			const [projects, setProjects] = (0, react.useState)([]);
			const [projId, setProjId] = (0, react.useState)("");
			const [novelChars, setNovelChars] = (0, react.useState)([]);
			const [expanded, setExpanded] = (0, react.useState)("");
			const [cardMap, setCardMap] = (0, react.useState)({});
			const [analyzing, setAnalyzing] = (0, react.useState)("");
			const [analyzeMap, setAnalyzeMap] = (0, react.useState)({});
			const [netScope, setNetScope] = (0, react.useState)("");
			const [graph, setGraph] = (0, react.useState)({
				nodes: [],
				edges: []
			});
			const [interactions, setInteractions] = (0, react.useState)([]);
			const [selNode, setSelNode] = (0, react.useState)("");
			const [edgeDetail, setEdgeDetail] = (0, react.useState)(null);
			const [netBusy, setNetBusy] = (0, react.useState)("");
			const [netMsg, setNetMsg] = (0, react.useState)("");
			const [form, setForm] = (0, react.useState)({
				a: "",
				b: "",
				type: "盟友",
				stance: "复杂",
				weight: 5,
				summary: ""
			});
			const [syncedAt, setSyncedAt] = (0, react.useState)("");
			const lastRev = (0, react.useRef)(-1);
			const netScopeRef = (0, react.useRef)("");
			const [sharedCtx] = useWorkbenchContext(PANEL_ID);
			const sharedRef = (0, react.useRef)(sharedCtx);
			const [qBanks, setQBanks] = (0, react.useState)([]);
			const [qKind, setQKind] = (0, react.useState)("");
			const [qQuestions, setQQuestions] = (0, react.useState)([]);
			const [qAnswers, setQAnswers] = (0, react.useState)({});
			const [qCharId, setQCharId] = (0, react.useState)("");
			const [qBusy, setQBusy] = (0, react.useState)(false);
			const [qResult, setQResult] = (0, react.useState)("");
			const [qMsg, setQMsg] = (0, react.useState)("");
			const [qPage, setQPage] = (0, react.useState)({
				from: 1,
				size: 20
			});
			const [qHistory, setQHistory] = (0, react.useState)([]);
			const [qRecord, setQRecord] = (0, react.useState)(null);
			const api = async (path, opts) => {
				const res = await fetch(API + path, opts);
				const j = await res.json().catch(() => ({}));
				if (!res.ok || j.ok === false) throw new Error(j?.error ?? "HTTP " + res.status);
				return j;
			};
			const refreshLocal = () => {
				api("/characters").then((j) => setLocals(Array.isArray(j.characters) ? j.characters : [])).catch(() => setLocals([]));
			};
			const refreshProjects = () => {
				api("/novel-projects").then((j) => {
					const list = Array.isArray(j.projects) ? j.projects : [];
					setProjects(list);
					const want = readContext().projectId;
					if (want && list.some((p) => p.id === want)) setProjId((prev) => prev && list.some((p) => p.id === prev) ? prev : want);
				}).catch(() => setProjects([]));
			};
			const loadChars = (id) => {
				if (!id) {
					setNovelChars([]);
					return;
				}
				api("/novel-characters?projectId=" + encodeURIComponent(id)).then((j) => setNovelChars(Array.isArray(j.characters) ? j.characters : [])).catch(() => setNovelChars([]));
			};
			const refreshNet = async (scope) => {
				const g = await api("/relationship-graph" + (scope ? "?projectId=" + encodeURIComponent(scope) : ""));
				const it = await api("/interactions" + (scope ? "?projectId=" + encodeURIComponent(scope) : ""));
				setGraph(g.graph ?? {
					nodes: [],
					edges: []
				});
				setInteractions(Array.isArray(it.interactions) ? it.interactions : []);
				setEdgeDetail((prev) => prev && it.interactions.some((x) => x.id === prev.id) ? prev : null);
			};
			const loadBanks = () => {
				api("/quiz-banks").then((j) => setQBanks(Array.isArray(j.banks) ? j.banks : [])).catch(() => setQBanks([]));
			};
			const loadQuestions = async (kind, page) => {
				if (!kind) {
					setQQuestions([]);
					return;
				}
				const p = page ?? qPage;
				setQMsg("载入题目…");
				try {
					const j = await api(`/quiz-questions?kind=${encodeURIComponent(kind)}&from=${p.from}&to=${p.from + p.size - 1}`);
					setQQuestions(Array.isArray(j.items) ? j.items : []);
					setQMsg(`已载入第 ${p.from}-${p.from + (j.items?.length ?? 1) - 1} 题 / 共 ${j.total} 题`);
				} catch (e) {
					setQQuestions([]);
					setQMsg("❌ " + String(e).slice(0, 160));
				}
			};
			const loadHistory = () => {
				api("/quiz-history?limit=50").then((j) => setQHistory(Array.isArray(j.records) ? j.records : [])).catch(() => setQHistory([]));
			};
			const submitQuiz = async (allowPartial) => {
				if (!qKind) {
					setQMsg("请先选择问卷");
					return;
				}
				setQBusy(true);
				setQResult("");
				setQMsg("计分中…");
				try {
					const j = await api("/quiz-score", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							kind: qKind,
							answers: qAnswers,
							characterId: qCharId || void 0,
							allowPartial
						})
					});
					setQResult(`${j.summary}\n\n${j.detail}`);
					setQMsg(`✅ 已计分（记录 ${j.recordId}）`);
					loadHistory();
					refreshLocal();
				} catch (e) {
					setQMsg("❌ " + String(e).slice(0, 300));
				} finally {
					setQBusy(false);
				}
			};
			const openRecord = async (id) => {
				try {
					const j = await api("/quiz-record?id=" + encodeURIComponent(id));
					setQRecord(j.record ?? null);
				} catch {
					setQRecord(null);
				}
			};
			const toggleCard = async (cid) => {
				const key = "local-" + cid;
				if (expanded === key) {
					setExpanded("");
					return;
				}
				setExpanded(key);
				if (cardMap[cid]) return;
				try {
					const r = await api("/card?id=" + encodeURIComponent(cid));
					setCardMap((m) => ({
						...m,
						[cid]: r.card ?? "（无卡片）"
					}));
				} catch (e) {
					setCardMap((m) => ({
						...m,
						[cid]: "角色卡载入失败: " + String(e).slice(0, 160)
					}));
				}
			};
			const doAnalyze = async (pid, cid) => {
				setAnalyzing(cid);
				setAnalyzeMap((m) => ({
					...m,
					[cid]: "生成中（需几十秒，LLM 深度画像）…"
				}));
				try {
					const r = await api("/analyze", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							projectId: pid,
							characterId: cid,
							depth: "standard",
							persist: true
						})
					});
					setAnalyzeMap((m) => ({
						...m,
						[cid]: r.card ?? r.narrative ?? "生成完成"
					}));
					setNovelChars((prev) => prev.map((c) => c.id === cid ? {
						...c,
						personalityProfile: r.narrative
					} : c));
				} catch (e) {
					setAnalyzeMap((m) => ({
						...m,
						[cid]: "❌ " + String(e).slice(0, 200)
					}));
				} finally {
					setAnalyzing("");
				}
			};
			(0, react.useEffect)(() => {
				netScopeRef.current = netScope;
			}, [netScope]);
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = async () => {
					try {
						const j = await api("/revision" + (netScopeRef.current ? "?projectId=" + encodeURIComponent(netScopeRef.current) : ""));
						if (!alive) return;
						if (lastRev.current < 0) lastRev.current = j.revision ?? 0;
						if ((j.revision ?? 0) !== lastRev.current) {
							lastRev.current = j.revision ?? 0;
							setSyncedAt((/* @__PURE__ */ new Date()).toLocaleTimeString());
							refreshLocal();
							refreshProjects();
							if (netScopeRef.current !== null) refreshNet(netScopeRef.current).catch(() => {});
						}
					} catch {}
				};
				tick();
				const iv = setInterval(tick, 3e3);
				return () => {
					alive = false;
					clearInterval(iv);
				};
			}, []);
			(0, react.useEffect)(() => {
				refreshLocal();
				refreshProjects();
				loadBanks();
				loadHistory();
			}, []);
			(0, react.useEffect)(() => {
				loadChars(projId);
			}, [projId]);
			(0, react.useEffect)(() => {
				refreshNet(netScope).catch(() => {});
			}, [netScope]);
			(0, react.useEffect)(() => {
				if (projId) setProjectContext(projId, PANEL_ID);
			}, [projId]);
			(0, react.useEffect)(() => {
				const prev = sharedRef.current;
				sharedRef.current = sharedCtx;
				if (!prev || !sharedCtx.updatedAt || sharedCtx.updatedAt === prev.updatedAt) return;
				if (sharedCtx.source === PANEL_ID) return;
				if (!sharedCtx.projectId || sharedCtx.projectId === projId) return;
				if (projects.length > 0 && !projects.some((p) => p.id === sharedCtx.projectId)) return;
				setProjId(sharedCtx.projectId);
				setNetScope(sharedCtx.projectId);
			}, [
				sharedCtx,
				projId,
				projects
			]);
			const selectedNode = graph.nodes.find((nd) => nd.id === selNode);
			const nodeEdges = selectedNode ? interactions.filter((it) => it.aKey === selNode || it.bKey === selNode) : [];
			const openEdge = async (id) => {
				setSelNode("");
				const found = (await api("/interaction?id=" + encodeURIComponent(id)).catch(() => null))?.interaction ?? interactions.find((x) => x.id === id) ?? null;
				setEdgeDetail(found);
			};
			const toggleSelNode = (id) => {
				setSelNode((prev) => prev === id ? "" : id);
				setEdgeDetail(null);
			};
			const runAnalyze = async (a, b, scope) => {
				setNetBusy("analyzing");
				setNetMsg(`分析 ${a} ↔ ${b}…`);
				try {
					const r = await api("/interactions/analyze", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							a,
							b,
							projectId: scope || void 0,
							persist: true
						})
					});
					setNetMsg("分析完成，网络已同步。");
					await refreshNet(scope);
					if (r.savedId) {
						setEdgeDetail(r);
						openEdge(r.savedId);
					}
				} catch (e) {
					setNetMsg("❌ " + String(e).slice(0, 160));
				} finally {
					setNetBusy("");
				}
			};
			const runAnalyzeAll = async (scope) => {
				setNetBusy("analyze-all");
				setNetMsg("正在批量分析所有角色两两互动（需数分钟，会逐对调用 LLM）…");
				try {
					const r = await api("/interactions/analyze-all", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							projectId: scope || void 0,
							persist: true,
							force: false,
							maxPairs: 20
						})
					});
					setNetMsg(`✅ 本次新增分析 ${r.count ?? 0} 对互动${r.failed ? `（${r.failed} 对失败）` : ""}。`);
					await refreshNet(scope);
				} catch (e) {
					setNetMsg("❌ " + String(e).slice(0, 160));
				} finally {
					setNetBusy("");
				}
			};
			const deleteEdge = async (id) => {
				if (!window.confirm("删除这条互动记录？此操作不可恢复。")) return;
				try {
					await api("/interactions/delete?id=" + encodeURIComponent(id), { method: "DELETE" });
					setEdgeDetail(null);
					setNetMsg("已删除互动。");
					await refreshNet(netScope);
				} catch (e) {
					setNetMsg("❌ " + String(e).slice(0, 120));
				}
			};
			const submitAdd = async () => {
				if (!form.a.trim() || !form.b.trim()) {
					setNetMsg("请填写角色 A 与 B。");
					return;
				}
				setNetBusy("add");
				try {
					await api("/interactions", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...form,
							weight: Number(form.weight) || 5,
							projectId: netScope || void 0
						})
					});
					setForm({
						a: "",
						b: "",
						type: "盟友",
						stance: "复杂",
						weight: 5,
						summary: ""
					});
					setNetMsg("已登记互动。");
					await refreshNet(netScope);
				} catch (e) {
					setNetMsg("❌ " + String(e).slice(0, 120));
				} finally {
					setNetBusy("");
				}
			};
			const renderLocal = () => {
				if (locals.length === 0) return (0, react.createElement)("div", { className: "cm-empty" }, "暂无本地角色。让 AI 助手用 character_new / character_profile 创建。");
				return (0, react.createElement)("div", null, locals.map((c) => {
					const isOpen = expanded === "local-" + c.id;
					const en = c.enneagram ?? {};
					const badge = [
						en.core ? `${en.core}号` : "",
						en.wing ? en.wing : "",
						en.wingNick ? en.wingNick : "",
						c.mbti ? c.mbti : "",
						en.subtypeLabel ? en.subtypeLabel : "",
						en.levelBand ? en.levelBand + "档" : ""
					].filter(Boolean);
					return (0, react.createElement)("div", {
						key: c.id,
						className: "cm-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, c.name, (0, react.createElement)("span", { className: "cm-badge" }, ROLE_LABEL[c.role] ?? c.role)), c.source ? (0, react.createElement)("span", { className: "cm-tag" }, "← novel") : null, badge.slice(0, 5).map((b, i) => (0, react.createElement)("span", {
						key: i,
						className: "cm-badge"
					}, b))), c.goal ? (0, react.createElement)("div", { className: "cm-sub" }, `目标：${c.goal}`) : null, (0, react.createElement)("div", { className: "cm-acts" }, (0, react.createElement)("button", {
						className: "cm-btn",
						onClick: () => void toggleCard(c.id)
					}, isOpen ? "收起" : "展开角色卡")), isOpen ? (0, react.createElement)("div", {
						className: "cm-line",
						style: { marginTop: 6 }
					}, cardMap[c.id] ?? "载入角色卡…") : null);
				}));
			};
			const renderNovel = () => {
				if (projects.length === 0) return (0, react.createElement)("div", { className: "cm-empty" }, "未发现 novel-writer 项目（需 dsh-novel-writer 运行且有项目）。");
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "cm-probar" }, (0, react.createElement)("select", {
					value: projId,
					onChange: (e) => setProjId(e.target.value)
				}, (0, react.createElement)("option", {
					value: "",
					disabled: true
				}, "选择项目…"), projects.map((p) => (0, react.createElement)("option", {
					key: p.id,
					value: p.id
				}, `${p.name}（${p.genre} · 人物${p.characterCount}）`)))), (0, react.createElement)("div", { className: "cm-note" }, "从小说项目拉取人物，点击「生成角色详析」即可产出完整角色卡（九型内核 + MBTI 解析 + 大五解析 + 六节深度画像），并自动写回 novel-writer 的 personalityProfile。若角色尚无 MBTI / 大五数据，AI 会依其资料模拟作答这两项测试（标注「AI 推断」）；已跑过问卷的以实测数据为准。"), !projId || novelChars.length === 0 ? (0, react.createElement)("div", { className: "cm-empty" }, !projId ? "请选择上方项目" : "该项目暂无人物档案") : novelChars.map((c) => {
					const isOpen = expanded === "novel-" + c.id;
					const note = analyzeMap[c.id];
					const showing = note ? note : isOpen ? c.personalityProfile ?? "（尚无角色详析，点击按钮生成）" : "";
					return (0, react.createElement)("div", {
						key: c.id,
						className: "cm-novelcard"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, c.name), (0, react.createElement)("span", { className: "cm-badge" }, ROLE_LABEL[c.role] ?? c.role), c.personalityProfile ? (0, react.createElement)("span", { className: "cm-tag" }, "✓有详析") : (0, react.createElement)("span", { className: "cm-tag" }, "待生成")), c.goal ? (0, react.createElement)("div", { className: "cm-sub" }, `目标：${c.goal}`) : null, (0, react.createElement)("div", { className: "cm-acts" }, (0, react.createElement)("button", {
						className: "cm-btn primary",
						onClick: () => void doAnalyze(projId, c.id),
						disabled: analyzing === c.id
					}, analyzing === c.id ? "生成中…" : "⚡ 生成角色详析"), (0, react.createElement)("button", {
						className: "cm-btn",
						onClick: () => setExpanded(isOpen ? "" : "novel-" + c.id)
					}, isOpen || note ? "收起" : "查看已有")), showing ? (0, react.createElement)("div", {
						className: "cm-line",
						style: { marginTop: 6 }
					}, showing) : null);
				}));
			};
			const positions = (0, react.useMemo)(() => layoutGraph(graph.nodes, graph.edges), [graph]);
			const svgChildren = [];
			svgChildren.push((0, react.createElement)("defs", { key: "d" }, (0, react.createElement)("marker", {
				id: "cm-arrow",
				viewBox: "0 0 8 8",
				refX: 8,
				refY: 4,
				markerWidth: 6,
				markerHeight: 6,
				orient: "auto-start-reverse"
			}, (0, react.createElement)("path", {
				d: "M0,0 L8,4 L0,8 Z",
				fill: "#888"
			}))));
			for (const e of graph.edges) {
				const a = positions[e.source], b = positions[e.target];
				if (!a || !b) continue;
				const c = stanceColor(e.stance);
				const w = 1 + Math.min(3.5, (e.weight || 5) / 3);
				let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, arrow = false;
				if (e.direction === "a->b") {
					x1 = a.x;
					y1 = a.y;
					x2 = b.x;
					y2 = b.y;
					arrow = true;
				} else if (e.direction === "b->a") {
					x1 = b.x;
					y1 = b.y;
					x2 = a.x;
					y2 = a.y;
					arrow = true;
				}
				const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2 - 8;
				svgChildren.push((0, react.createElement)("line", {
					key: "e" + e.id,
					x1,
					y1,
					x2,
					y2,
					stroke: c,
					strokeWidth: w,
					strokeOpacity: .85,
					strokeDasharray: e.direction === "a<->b" ? "4 3" : void 0,
					markerEnd: arrow ? "url(#cm-arrow)" : void 0,
					className: "cm-edge-tip",
					onMouseEnter: () => openEdge(e.id),
					onClick: () => openEdge(e.id)
				}));
				if (e.type) svgChildren.push((0, react.createElement)("text", {
					key: "t" + e.id,
					x: midX,
					y: midY,
					fill: c,
					fontSize: 10,
					textAnchor: "middle",
					opacity: .9,
					style: {
						pointerEvents: "none",
						userSelect: "none"
					}
				}, String(e.type).slice(0, 6)));
			}
			for (const nd of graph.nodes) {
				const p = positions[nd.id];
				if (!p) continue;
				const fill = NODE_FILL[nd.group ?? 4] ?? "#888";
				const active = selNode === nd.id || edgeDetail && (edgeDetail.aKey === nd.id || edgeDetail.bKey === nd.id);
				const label = nodesLabel(nd.name);
				svgChildren.push((0, react.createElement)("circle", {
					key: "n" + nd.id,
					cx: p.x,
					cy: p.y,
					r: active ? 17 : 14,
					fill,
					stroke: active ? "#fff" : "#fff3",
					strokeWidth: active ? 2.5 : 1,
					className: "cm-edge-tip",
					onClick: (ev) => {
						ev.stopPropagation();
						toggleSelNode(nd.id);
					}
				}), (0, react.createElement)("text", {
					key: "nl" + nd.id,
					x: p.x,
					y: p.y + 27,
					fill: "#ddd",
					fontSize: 10.5,
					textAnchor: "middle",
					style: { pointerEvents: "none" }
				}, label));
			}
			const renderNet = () => {
				const selectedIt = edgeDetail;
				return (0, react.createElement)("div", { className: "cm-net" }, (0, react.createElement)("div", {
					className: "cm-probar",
					style: { width: "100%" }
				}, (0, react.createElement)("select", {
					value: netScope,
					onChange: (e) => setNetScope(e.target.value),
					style: { minWidth: 200 }
				}, (0, react.createElement)("option", { value: "" }, "本地角色 / 全场"), projects.map((p) => (0, react.createElement)("option", {
					key: p.id,
					value: p.id
				}, p.name))), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => refreshNet(netScope).catch(() => {})
				}, "重算布局"), (0, react.createElement)("button", {
					className: "cm-btn primary",
					disabled: netBusy !== "",
					onClick: () => void runAnalyzeAll(netScope)
				}, netBusy === "analyze-all" ? "批量分析中…" : "⚡ 一键全项目互动分析"), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => {
						setSelNode("");
						setEdgeDetail(null);
						setNetMsg("");
					}
				}, "清空选择")), (0, react.createElement)("div", { className: "cm-graph" }, graph.nodes.length === 0 ? (0, react.createElement)("div", { className: "cm-empty" }, "暂无数据。请先创建角色，或点击「一键全项目互动分析」生成关系网。") : (0, react.createElement)("svg", { viewBox: "0 0 760 520" }, ...svgChildren), (0, react.createElement)("div", { className: "cm-legend" }, (0, react.createElement)("span", null, (0, react.createElement)("span", {
					className: "sw",
					style: { background: "#7c6cf0" }
				}), "主角"), (0, react.createElement)("span", null, (0, react.createElement)("span", {
					className: "sw",
					style: { background: "#4a90d9" }
				}), "配角"), (0, react.createElement)("span", null, (0, react.createElement)("span", {
					className: "sw",
					style: { background: "#e05656" }
				}), "反派"), (0, react.createElement)("span", null, (0, react.createElement)("span", {
					className: "sw",
					style: { background: "#4ab07a" }
				}), "亲和/同盟"), (0, react.createElement)("span", null, (0, react.createElement)("span", {
					className: "sw",
					style: { background: "#e0a24a" }
				}), "利用/支配"), (0, react.createElement)("span", null, "实线=单向(带箭头) · 虚线=双向对等 ｜ 悬停连线看互动")), netMsg ? (0, react.createElement)("div", {
					className: "cm-note",
					style: { color: "#9d8ff5" }
				}, netMsg) : null), (0, react.createElement)("div", { className: "cm-detail" }, selectedNode ? (0, react.createElement)("div", { className: "cm-card" }, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, selectedNode.name), (0, react.createElement)("span", { className: "cm-badge" }, ROLE_LABEL[selectedNode.role ?? ""] ?? selectedNode.role ?? ""), selectedNode.core ? (0, react.createElement)("span", { className: "cm-badge" }, `${selectedNode.core}号` + (selectedNode.coreName ? ` ${selectedNode.coreName}` : "")) : null), (0, react.createElement)("div", { className: "cm-sub" }, nodeEdges.length ? `参与 ${nodeEdges.length} 组互动：` : "该角色暂无登记互动。"), nodeEdges.map((it) => {
					const other = it.aKey === selNode ? it.bName : it.aName;
					const st = it.type ? it.type : "互动";
					return (0, react.createElement)("div", {
						key: it.id,
						className: "cm-acts"
					}, (0, react.createElement)("button", {
						className: "cm-btn",
						onClick: () => void openEdge(it.id)
					}, `${st}${it.stance ? "(" + it.stance + ")" : ""} ↔ ${other}`));
				})) : null, selectedIt && !selectedNode ? (0, react.createElement)("div", { className: "cm-card" }, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, `${selectedIt.aName} ↔ ${selectedIt.bName}`)), (0, react.createElement)("div", null, (0, react.createElement)("span", { className: "cm-tag" }, `类型：${selectedIt.type || "互动"}`), (0, react.createElement)("span", { className: "cm-tag" }, `立场：${selectedIt.stance || "复杂"}`), (0, react.createElement)("span", { className: "cm-tag" }, `方向：${selectedIt.direction === "a<->b" ? "对等" : selectedIt.direction === "a->b" ? "A→B" : "B→A"}`), (0, react.createElement)("span", { className: "cm-tag" }, `强度：${selectedIt.weight ?? 5}/10`)), selectedIt.summary ? (0, react.createElement)("div", { className: "cm-sub" }, selectedIt.summary) : null, selectedIt.tags && selectedIt.tags.length ? (0, react.createElement)("div", { className: "cm-sub" }, selectedIt.tags.map((x) => "#" + x).join(" ")) : null, selectedIt.analysis ? (0, react.createElement)("div", {
					className: "cm-line",
					style: { marginTop: 6 }
				}, selectedIt.analysis) : (0, react.createElement)("div", { className: "cm-note" }, "（尚无深析，点击「✨ 互动深析」让 AI 分析这段关系）"), (0, react.createElement)("div", { className: "cm-acts" }, (0, react.createElement)("button", {
					className: "cm-btn primary",
					disabled: netBusy !== "",
					onClick: () => void runAnalyze(selectedIt.aName, selectedIt.bName, netScope)
				}, netBusy === "analyzing" ? "分析中…" : "✨ 互动深析（重新生成）"), (0, react.createElement)("button", {
					className: "cm-btn danger",
					onClick: () => void deleteEdge(selectedIt.id)
				}, "删除"))) : null, (0, react.createElement)("div", { className: "cm-form" }, (0, react.createElement)("div", { className: "cm-sec" }, "登记互动"), (0, react.createElement)("datalist", { id: "cm-char-list" }, graph.nodes.map((nd) => (0, react.createElement)("option", {
					key: nd.id,
					value: nd.name
				})), locals.map((c) => (0, react.createElement)("option", {
					key: "l" + c.id,
					value: c.name
				}))), (0, react.createElement)("label", null, "角色 A"), (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("div", null, (0, react.createElement)("input", {
					value: form.a,
					placeholder: "名字或 id（可下拉选）",
					list: "cm-char-list",
					onChange: (e) => setForm({
						...form,
						a: e.target.value
					})
				})), (0, react.createElement)("div", null, (0, react.createElement)("input", {
					value: form.b,
					placeholder: "名字或 id（可下拉选）",
					list: "cm-char-list",
					onChange: (e) => setForm({
						...form,
						b: e.target.value
					})
				}))), (0, react.createElement)("label", null, "角色 B"), (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("div", null, (0, react.createElement)("input", {
					value: form.type,
					placeholder: "关系类型（敌手/恋人/师徒…）",
					onChange: (e) => setForm({
						...form,
						type: e.target.value
					})
				})), (0, react.createElement)("div", null, (0, react.createElement)("input", {
					value: form.stance,
					placeholder: "立场（敌对/亲近/利用…）",
					onChange: (e) => setForm({
						...form,
						stance: e.target.value
					})
				}))), (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("div", null, (0, react.createElement)("label", null, "强度 0-10"), (0, react.createElement)("input", {
					type: "number",
					min: 0,
					max: 10,
					value: form.weight,
					onChange: (e) => setForm({
						...form,
						weight: Number(e.target.value)
					})
				})), (0, react.createElement)("div", null, (0, react.createElement)("label", null, "一句话概括"), (0, react.createElement)("input", {
					value: form.summary,
					placeholder: "可选",
					onChange: (e) => setForm({
						...form,
						summary: e.target.value
					})
				}))), (0, react.createElement)("div", { className: "cm-acts" }, (0, react.createElement)("button", {
					className: "cm-btn primary",
					disabled: netBusy !== "",
					onClick: () => void submitAdd()
				}, netBusy === "add" ? "登记中…" : "新增互动"), (0, react.createElement)("button", {
					className: "cm-btn",
					disabled: !form.a.trim() || !form.b.trim() || netBusy !== "",
					onClick: () => void runAnalyze(form.a, form.b, netScope)
				}, "分析这段关系")))));
			};
			const renderQuiz = () => {
				const answeredCount = Object.keys(qAnswers).length;
				const lastNo = qQuestions.length ? qQuestions[qQuestions.length - 1].no : 0;
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "cm-bar" }, (0, react.createElement)("select", {
					value: qKind,
					style: { minWidth: 240 },
					onChange: (e) => {
						const k = e.target.value;
						setQKind(k);
						setQAnswers({});
						setQResult("");
						setQRecord(null);
						const pg = {
							from: 1,
							size: qPage.size
						};
						setQPage(pg);
						loadQuestions(k, pg);
					}
				}, (0, react.createElement)("option", { value: "" }, "选择问卷…"), qBanks.map((b) => (0, react.createElement)("option", {
					key: b.id,
					value: b.id
				}, `${b.name}（${b.count} 题）`))), (0, react.createElement)("select", {
					value: qCharId,
					style: { minWidth: 160 },
					onChange: (e) => setQCharId(e.target.value)
				}, (0, react.createElement)("option", { value: "" }, "不绑定角色（只出分）"), locals.map((c) => (0, react.createElement)("option", {
					key: c.id,
					value: c.id
				}, `写回：${c.name}`))), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => {
						loadBanks();
						loadHistory();
					}
				}, "刷新")), qMsg ? (0, react.createElement)("div", {
					className: "cm-note",
					style: { color: "#9d8ff5" }
				}, qMsg) : null, qQuestions.length === 0 ? (0, react.createElement)("div", { className: "cm-empty" }, qKind ? "暂无题目" : "请选择问卷开始作答。也可让 AI 助手用 character_questionnaire 代跑（agent 代传 answers）。") : (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "cm-quizbar" }, (0, react.createElement)("span", null, `本页 ${qQuestions.length} 题（到第 ${lastNo} 题）· 已答 ${answeredCount}`), (0, react.createElement)("button", {
					className: "cm-btn",
					disabled: qPage.from <= 1,
					onClick: () => {
						const pg = {
							...qPage,
							from: Math.max(1, qPage.from - qPage.size)
						};
						setQPage(pg);
						loadQuestions(qKind, pg);
					}
				}, "‹ 上一页"), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => {
						const pg = {
							...qPage,
							from: qPage.from + qPage.size
						};
						setQPage(pg);
						loadQuestions(qKind, pg);
					}
				}, "下一页 ›"), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => {
						const add = {};
						for (const q of qQuestions) if (q.type === "bool") add[q.no] = true;
						else if (q.type === "ab") add[q.no] = "a";
						else add[q.no] = Math.round(((q.scaleMin ?? 1) + (q.scaleMax ?? 5)) / 2);
						setQAnswers((a) => ({
							...a,
							...add
						}));
					}
				}, "本页取中值"), (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => setQAnswers({})
				}, "清空作答")), qQuestions.map((q) => (0, react.createElement)("div", {
					key: String(q.no),
					className: "cm-quizq"
				}, (0, react.createElement)("div", { className: "cm-quizstem" }, `${q.no}. ${q.text}`, q.dimension ? (0, react.createElement)("span", { className: "cm-badge" }, q.dimension) : null), (0, react.createElement)("div", { className: "cm-acts" }, q.type === "bool" ? [true, false].map((v) => (0, react.createElement)("button", {
					key: String(v),
					className: "cm-btn" + (qAnswers[q.no] === v ? " primary" : ""),
					onClick: () => setQAnswers((a) => ({
						...a,
						[q.no]: v
					}))
				}, v ? "是" : "否")) : q.type === "ab" ? ["a", "b"].map((k) => (0, react.createElement)("button", {
					key: k,
					className: "cm-btn" + (qAnswers[q.no] === k ? " primary" : ""),
					onClick: () => setQAnswers((a) => ({
						...a,
						[q.no]: k
					}))
				}, `${k.toUpperCase()}. ${k === "a" ? q.a ?? "" : q.b ?? ""}`)) : Array.from({ length: Math.max(1, (q.scaleMax ?? 5) - (q.scaleMin ?? 1) + 1) }, (_, i) => (q.scaleMin ?? 1) + i).map((v) => (0, react.createElement)("button", {
					key: v,
					className: "cm-btn" + (Number(qAnswers[q.no]) === v ? " primary" : ""),
					title: q.scaleLabels?.[v - (q.scaleMin ?? 1)] ?? "",
					onClick: () => setQAnswers((a) => ({
						...a,
						[q.no]: v
					}))
				}, String(v)))))), (0, react.createElement)("div", {
					className: "cm-acts",
					style: { marginTop: 12 }
				}, (0, react.createElement)("button", {
					className: "cm-btn primary",
					disabled: qBusy,
					onClick: () => void submitQuiz(false)
				}, qBusy ? "计分中…" : "✅ 提交计分（缺题>10% 会拒绝）"), (0, react.createElement)("button", {
					className: "cm-btn",
					disabled: qBusy,
					onClick: () => void submitQuiz(true)
				}, "强制按部分作答计分"))), qResult ? (0, react.createElement)("div", { className: "cm-card" }, (0, react.createElement)("h4", null, "计分结果"), (0, react.createElement)("div", { className: "cm-line" }, qResult)) : null, (0, react.createElement)("div", { className: "cm-sec" }, `作答历史（${qHistory.length}）`), qHistory.length === 0 ? (0, react.createElement)("div", { className: "cm-empty" }, "暂无作答记录") : (0, react.createElement)("div", null, qHistory.slice(0, 30).map((r) => (0, react.createElement)("div", {
					key: r.id,
					className: "cm-card"
				}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, `${r.kind}${r.characterName ? " · " + r.characterName : ""}`), (0, react.createElement)("span", { className: "cm-tag" }, String(r.finishedAt ?? "").replace("T", " ").slice(0, 19)), r.missingCount ? (0, react.createElement)("span", { className: "cm-badge" }, `缺${r.missingCount}题`) : null, r.hasAnswers ? (0, react.createElement)("span", { className: "cm-tag" }, "✓原始作答") : null), (0, react.createElement)("div", { className: "cm-sub" }, r.summary ?? ""), (0, react.createElement)("div", { className: "cm-acts" }, (0, react.createElement)("button", {
					className: "cm-btn",
					onClick: () => void openRecord(r.id)
				}, "查看明细"))))), qRecord ? (0, react.createElement)("div", { className: "cm-card" }, (0, react.createElement)("h4", null, `记录明细 · ${qRecord.kind}`), (0, react.createElement)("div", {
					className: "cm-line",
					style: {
						maxHeight: 260,
						overflow: "auto"
					}
				}, `原始作答：\n${JSON.stringify(qRecord.answers ?? {}, null, 1)}\n\n计分明细：\n${JSON.stringify(qRecord.scores ?? {}, null, 1)}`)) : null);
			};
			const head = (0, react.createElement)("div", { className: "cm-bar" }, (0, react.createElement)("strong", null, "角色设定工作坊"), (0, react.createElement)("span", { style: {
				fontSize: 11,
				opacity: .6
			} }, "九型×MBTI×大五 · novel 联动 · 关系网"), (0, react.createElement)("button", { onClick: () => {
				refreshLocal();
				refreshProjects();
				refreshNet(netScope).catch(() => {});
			} }, "刷新"), (0, react.createElement)("span", { className: "cm-sync" }, syncedAt ? `已同步 ${syncedAt}` : "同步中…"));
			return (0, react.createElement)("div", { className: "cm-root" }, (0, react.createElement)("style", null, CSS), head, (0, react.createElement)("div", { className: "cm-tabs" }, (0, react.createElement)("div", {
				className: "cm-tab" + (tab === "local" ? " on" : ""),
				onClick: () => setTab("local")
			}, `本地角色（${locals.length}）`), (0, react.createElement)("div", {
				className: "cm-tab" + (tab === "quiz" ? " on" : ""),
				onClick: () => setTab("quiz")
			}, `📝 问卷作答（${qBanks.length} 种）`), (0, react.createElement)("div", {
				className: "cm-tab" + (tab === "novel" ? " on" : ""),
				onClick: () => setTab("novel")
			}, `novel-writer 联动（${projects.length} 项目）`), (0, react.createElement)("div", {
				className: "cm-tab" + (tab === "net" ? " on" : ""),
				onClick: () => setTab("net")
			}, `🌐 关系网（${graph.nodes.length} 点 · ${graph.edges.length} 边）`)), tab === "local" ? renderLocal() : tab === "quiz" ? renderQuiz() : tab === "novel" ? renderNovel() : renderNet());
		}
		/** 标点/序号清理，让图上标签更短 */
		function nodesLabel(name) {
			return String(name ?? "").replace(/\s+/g, " ").slice(0, 6);
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "@dsh-external/dsh-character-maker-panel",
				order: 50,
				label: () => "角色设定"
			}, CharacterPanel)), "@dsh-external/dsh-character-maker: panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map