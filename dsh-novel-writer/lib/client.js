window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-novel-writer",
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
		* @dsh-external/dsh-novel-writer — client 面板（conversation.view tab）。
		* 小说工坊：项目/大纲/人物/世界观/记忆/章节阅读/导入 的浏览 + 内容直接编辑（编辑/删除）。
		*
		* ⚠️ 2026-08 实测修正：web 端 slot 渲染器是 React（ui-renderer 直接
		* `jsx(entry.component, props)`），component 必须是 React 组件且作为
		* register 的【第二参数】传入——options.component 字段被忽略。
		* React 由 web 端 ModuleLoader 提供（tsdown external 'react' → require("react")）。
		*
		* ⚠️ apply 用 ctx.slots 必须 export const inject = ['slots']；
		*    register 必须带 name 字段（= slot 名），否则报 "slot undefined is not declared"。
		*/
		const inject = ["slots"];
		const PANEL_ID = "dsh-novel-writer";
		const API = "/@dsh-external/dsh-novel-writer/api";
		const CSS = WB_KIT_CSS + `
/* ── 小说工坊 ── */
.nw-root { padding: 14px 16px 30px; height: 100%; overflow-y: auto; }

/* 顶栏：吸顶 + 毛玻璃 */
.nw-bar {
  position: sticky; top: 0; z-index: 20;
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin: -14px -16px 12px; padding: 10px 16px;
  background: color-mix(in srgb, var(--wb-fg) 5%, transparent);
  border-bottom: 1px solid var(--wb-line-soft);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
}
.nw-bar select, .nw-bar button {
  height: 28px; padding: 0 11px;
  background: var(--wb-surface); color: var(--wb-fg);
  border: 1px solid var(--wb-line); border-radius: var(--wb-radius-sm);
  font-size: 12px; cursor: pointer;
}
.nw-bar select { padding-right: 6px; }
.nw-bar select:hover, .nw-bar button:hover {
  background: var(--wb-surface-2);
  border-color: color-mix(in srgb, var(--wb-accent) 45%, var(--wb-line));
}
.nw-meta { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11.5px; color: var(--wb-faint); margin-bottom: 10px; }

/* 分段控件式 tab */
.nw-tabs {
  display: flex; flex-wrap: wrap; gap: 2px;
  padding: 3px; margin-bottom: 12px;
  background: var(--wb-surface);
  border: 1px solid var(--wb-line-soft);
  border-radius: calc(var(--wb-radius-sm) + 2px);
}
.nw-tab {
  padding: 5px 11px; border-radius: var(--wb-radius-sm);
  font-size: 12px; color: var(--wb-dim);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.nw-tab:hover { color: var(--wb-fg); background: var(--wb-surface-2); }
.nw-tab.on {
  color: var(--wb-fg); background: var(--wb-surface-2);
  box-shadow: inset 0 0 0 1px var(--wb-line), 0 1px 2px rgba(0, 0, 0, .16);
}

/* 区块标题 */
.nw-sec {
  display: flex; align-items: center; gap: 8px;
  margin: 16px 0 8px; font-size: 11.5px; font-weight: 600;
  letter-spacing: .04em; color: var(--wb-dim);
}
.nw-sec::before { content: ""; width: 3px; height: 12px; border-radius: 2px; background: var(--wb-accent); }

/* 卡片 */
.nw-card {
  background: var(--wb-surface);
  border: 1px solid var(--wb-line-soft);
  border-radius: var(--wb-radius);
  padding: 11px 13px; margin-bottom: 9px;
  transition: border-color .14s ease, box-shadow .14s ease;
}
.nw-card:hover { border-color: color-mix(in srgb, var(--wb-fg) 18%, transparent); }
.nw-card h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nw-card h4 .grow { flex: 1; min-width: 0; }
.nw-card .sub { font-size: 11px; font-weight: 400; color: var(--wb-faint); }
.nw-kv { font-size: 12.5px; line-height: 1.8; color: var(--wb-dim); }
.nw-kv b, .nw-kv strong { color: var(--wb-fg); }

/* 徽标 */
.nw-badge {
  display: inline-block; margin-left: 6px; padding: 1px 7px;
  font-size: 10px; line-height: 1.7; border-radius: 99px;
  color: var(--wb-accent-text);
  background: var(--wb-accent-weak);
  border: 1px solid color-mix(in srgb, var(--wb-accent) 22%, transparent);
}
.cm-badge-css {
  display: inline-block; margin-left: 6px; padding: 1px 7px;
  font-size: 10px; line-height: 1.7; border-radius: 99px;
  color: color-mix(in srgb, var(--wb-ok) 70%, var(--wb-fg));
  background: color-mix(in srgb, var(--wb-ok) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--wb-ok) 24%, transparent);
}
.cm-bar2 {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-top: 8px; padding-top: 7px;
  border-top: 1px dashed var(--wb-line-soft);
}
.cm-title { margin-right: 4px; font-size: 11px; font-weight: 600; color: var(--wb-accent-text); }

/* 章节列表 / 阅读区 */
.nw-chlist {
  padding: 4px;
  background: color-mix(in srgb, var(--wb-fg) 3%, transparent);
  border: 1px solid var(--wb-line-soft);
  border-radius: var(--wb-radius);
  align-self: flex-start;
}
.nw-chlist .nw-ch {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 6px 9px; border-radius: var(--wb-radius-sm);
  font-size: 12px; color: var(--wb-dim); cursor: pointer;
}
.nw-chlist .nw-ch:hover { background: var(--wb-surface-2); color: var(--wb-fg); }
.nw-chlist .nw-ch.on {
  color: var(--wb-fg); background: var(--wb-accent-weak);
  box-shadow: inset 2px 0 0 var(--wb-accent);
}
.nw-vol { font-size: 10.5px !important; font-weight: 600; letter-spacing: .06em; color: var(--wb-faint); }
.nw-content {
  max-height: 62vh; overflow-y: auto;
  padding: 14px 6px; font-size: 13.5px; line-height: 2;
  text-wrap: pretty;
}
.nw-content::first-letter { font-size: 1.05em; }

/* 空态 */
.nw-empty {
  padding: 26px 18px; text-align: center; font-size: 12px;
  color: var(--wb-faint);
  background: color-mix(in srgb, var(--wb-fg) 2.5%, transparent);
  border: 1px dashed var(--wb-line);
  border-radius: var(--wb-radius);
}

/* 表单 */
.nw-form { display: flex; flex-direction: column; gap: 9px; margin-top: 8px; }
.nw-form .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.nw-form .row > label { min-width: 60px; color: var(--wb-dim); }
.nw-form select, .nw-form input, .nw-form textarea, .nw-inp, .nw-imp-row select {
  background: color-mix(in srgb, var(--wb-fg) 4%, transparent);
  color: var(--wb-fg);
  border: 1px solid var(--wb-line);
  border-radius: var(--wb-radius-sm);
  padding: 6px 9px; font-size: 12px; min-height: 30px;
}
.nw-form select:hover, .nw-form input:hover, .nw-form textarea:hover, .nw-inp:hover { border-color: color-mix(in srgb, var(--wb-fg) 24%, transparent); }
.nw-form input { flex: 1; min-width: 140px; }
.nw-form textarea { width: 100%; resize: vertical; font-family: inherit; line-height: 1.75; }
.nw-inp { width: 100%; }
.nw-imp { display: flex; flex-direction: column; gap: 9px; max-width: 760px; }
.nw-imp > label { font-size: 12px; color: var(--wb-dim); }
.nw-imp-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.nw-chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: var(--wb-dim); }

/* 按钮 */
.nw-btn {
  align-self: flex-start; height: 34px; padding: 0 20px;
  background: var(--wb-accent); color: #fff;
  border: 1px solid color-mix(in srgb, #000 12%, var(--wb-accent));
  border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .2), 0 8px 18px -12px color-mix(in srgb, var(--wb-accent) 80%, transparent);
}
.nw-btn:hover:not(:disabled) { filter: brightness(1.08); }
.nw-btn:disabled { cursor: wait; }
.nw-btn-sm {
  height: 24px; padding: 0 9px;
  background: var(--wb-surface); color: var(--wb-dim);
  border: 1px solid var(--wb-line); border-radius: 6px;
  font-size: 11.5px; cursor: pointer;
}
.nw-btn-sm:hover:not(:disabled) { color: var(--wb-fg); border-color: color-mix(in srgb, var(--wb-accent) 50%, var(--wb-line)); }
.nw-btn-sm.primary { background: var(--wb-accent); border-color: transparent; color: #fff; }
.nw-btn-sm.primary:hover { filter: brightness(1.08); }
.nw-btn-sm.danger:hover { color: var(--wb-danger); border-color: var(--wb-danger); background: var(--wb-danger-weak); }
.nw-btn-sm.on { color: var(--wb-accent-text); border-color: color-mix(in srgb, var(--wb-accent) 55%, transparent); background: var(--wb-accent-weak); }
.nw-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* 结果面板 */
.nw-res {
  margin-top: 6px; padding: 10px 12px;
  background: color-mix(in srgb, var(--wb-fg) 3.5%, transparent);
  border: 1px solid var(--wb-line-soft); border-radius: var(--wb-radius);
}
.nw-res pre { margin: 0; white-space: pre-wrap; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11.5px; line-height: 1.75; color: var(--wb-dim); }
.nw-hint { font-size: 11px; line-height: 1.75; color: var(--wb-faint); }
.nw-fs { font-size: 11px; color: var(--wb-faint); }
.nw-editbar {
  display: flex; gap: 8px; align-items: center;
  margin-bottom: 6px; padding: 6px 8px;
  background: color-mix(in srgb, var(--wb-accent) 7%, transparent);
  border-radius: var(--wb-radius-sm);
}
.nw-editbar span { font-size: 11px; color: var(--wb-dim); }
.nw-dl { font-size: 12px; }
.nw-dl a { color: var(--wb-accent-text); text-decoration: none; }
.nw-dl a:hover { text-decoration: underline; }

/* 大纲树 */
.nw-tree { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; line-height: 1.9; white-space: pre-wrap; }
.nw-node { margin: 1px 0; }
.nw-node-row { display: flex; align-items: flex-start; gap: 8px; padding: 3px 6px; border-radius: 6px; }
.nw-node-row:hover { background: color-mix(in srgb, var(--wb-fg) 4%, transparent); }
.nw-node-main { flex: 1; min-width: 0; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; line-height: 1.8; }
.nw-node-children { margin-left: 18px; padding-left: 10px; border-left: 1px solid var(--wb-line-soft); }

/* 资产网格 */
.nw-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 10px; }
.nw-asset { margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.nw-asset:hover { box-shadow: var(--wb-shadow); }
.nw-asset-img {
  width: 100%; aspect-ratio: 3 / 4; object-fit: cover;
  display: block; border-radius: 8px; cursor: zoom-in;
  background: color-mix(in srgb, #000 22%, transparent);
  transition: transform .16s ease, filter .16s ease;
}
.nw-asset-img:hover { transform: scale(1.015); filter: brightness(1.05); }
.nw-asset-img--map { aspect-ratio: 3 / 2; }
.nw-asset-img--illustration { aspect-ratio: 4 / 3; }
.nw-asset-cap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
.nw-asset-cap b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

`;
		const ROLE_LABEL = {
			protagonist: "主角",
			supporting: "配角",
			antagonist: "反派",
			minor: "路人"
		};
		const CAT_LABEL = {
			geography: "地理",
			history: "历史",
			rules: "规则",
			culture: "文化",
			"power-system": "力量体系",
			other: "其他"
		};
		const GEO_LABEL = {
			country: "国家/势力",
			region: "区域/大陆",
			city: "城市/城镇",
			terrain: "地形/山川/水系",
			building: "建筑/据点",
			other: "其他"
		};
		const ITEM_LABEL = {
			weapon: "武器",
			artifact: "法器/宝物",
			tool: "器具",
			material: "材料",
			drug: "药物",
			document: "书证/情报",
			other: "其他"
		};
		const STATUS_MARK = {
			planned: "·",
			writing: "✎",
			done: "✓",
			draft: "✎",
			final: "✓",
			open: "○",
			resolved: "●",
			abandoned: "×"
		};
		const ASSET_KIND_LABEL = {
			portrait: "立绘",
			illustration: "插画",
			map: "地图",
			voice: "配音",
			other: "其他"
		};
		function esc(s) {
			return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		}
		function ensureCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-nw-css]")) return;
			const tag = document.createElement("style");
			tag.dataset.nwCss = "1";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		function memoryHtml(d) {
			const vols = d.outline.filter((n) => n.type === "volume").sort((a, b) => a.order - b.order);
			const volOf = /* @__PURE__ */ new Map();
			for (const n of d.outline) if (n.type === "chapter" && n.parentId) volOf.set(n.id, n.parentId);
			const keyOf = (c) => {
				const vid = volOf.get(c.id);
				if (vid) {
					const vi = vols.findIndex((v) => v.id === vid);
					if (vi >= 0) return [
						0,
						vi,
						c.order
					];
				}
				return [
					1,
					0,
					c.order
				];
			};
			const chapters = d.chapters.slice().sort((a, b) => {
				const ka = keyOf(a), kb = keyOf(b);
				for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
				return 0;
			});
			if (chapters.length === 0) return "<div class=\"nw-empty\">暂无章节记忆（生成第一章后出现）</div>";
			let lastVol = "";
			const cards = [];
			for (const c of chapters) {
				const vid = volOf.get(c.id);
				let volLine = "";
				if (vid) {
					const vi = vols.findIndex((v) => v.id === vid) + 1;
					const v = vols.find((x) => x.id === vid);
					if (v && v.title !== lastVol) {
						volLine = `<div class="nw-sec">📖 第${vi}卷 ${esc(v.title)}</div>`;
						lastVol = v.title;
					}
				}
				cards.push(`${volLine}<div class="nw-card">
    <h4>第${c.order}章 ${esc(c.title)} <span class="sub">${c.wordCount}字</span></h4>
    <div class="nw-kv">${esc(c.summary || "（无摘要）")}</div></div>`);
			}
			return cards.join("");
		}
		const TABS = [
			["outline", "大纲"],
			["characters", "人物"],
			["worldview", "世界观"],
			["geo", "地理"],
			["items", "物品"],
			["style", "文风"],
			["maps", "地图"],
			["assets", "资产"],
			["memory", "记忆"],
			["chapters", "章节"],
			["import", "导入"],
			["export", "导出"]
		];
		const LS_KEYS = {
			project: "nw-last-project",
			tab: "nw-last-tab",
			reading: "nw-last-reading"
		};
		function lsGet(key, dflt) {
			try {
				if (typeof window === "undefined") return dflt;
				return window.localStorage.getItem(key) ?? dflt;
			} catch {
				return dflt;
			}
		}
		function lsSet(key, value) {
			try {
				if (typeof window === "undefined") return;
				window.localStorage.setItem(key, value);
			} catch {}
		}
		/** 恢复上次 tab（非法值回退 outline） */
		function lsGetTab() {
			const v = lsGet(LS_KEYS.tab, "outline");
			return TABS.some(([k]) => k === v) ? v : "outline";
		}
		function NovelPanel() {
			const boot = readContext();
			const [projects, setProjects] = (0, react.useState)([]);
			const [currentId, setCurrentId] = (0, react.useState)(() => lsGet(LS_KEYS.project, "") || boot.projectId);
			const [data, setData] = (0, react.useState)(null);
			const [tab, setTab] = (0, react.useState)(lsGetTab);
			const [reading, setReading] = (0, react.useState)(() => {
				const own = lsGet(LS_KEYS.reading, "");
				if (own) return own;
				return boot.projectId && boot.projectId === (lsGet(LS_KEYS.project, "") || boot.projectId) ? boot.chapterId : "";
			});
			const [content, setContent] = (0, react.useState)("");
			const [err, setErr] = (0, react.useState)("");
			const [edit, setEdit] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)({});
			const [saving, setSaving] = (0, react.useState)(false);
			const [editErr, setEditErr] = (0, react.useState)("");
			const [impPath, setImpPath] = (0, react.useState)("");
			const [impMode, setImpMode] = (0, react.useState)("auto");
			const [impEncoding, setImpEncoding] = (0, react.useState)("utf-8");
			const [impDry, setImpDry] = (0, react.useState)(true);
			const [impResult, setImpResult] = (0, react.useState)("");
			const [impBusy, setImpBusy] = (0, react.useState)(false);
			const [polishUI, setPolishUI] = (0, react.useState)(false);
			const [polishMode, setPolishMode] = (0, react.useState)("deep");
			const [polishFocus, setPolishFocus] = (0, react.useState)("");
			const [polishBusy, setPolishBusy] = (0, react.useState)(false);
			const [polishWarn, setPolishWarn] = (0, react.useState)("");
			const [maps, setMaps] = (0, react.useState)([]);
			const [mapsErr, setMapsErr] = (0, react.useState)("");
			const [mapsLoading, setMapsLoading] = (0, react.useState)(false);
			const [cmStatus, setCmStatus] = (0, react.useState)({});
			const [cmBusy, setCmBusy] = (0, react.useState)("");
			const [cmView, setCmView] = (0, react.useState)({});
			const [cmErr, setCmErr] = (0, react.useState)("");
			const [scKb, setScKb] = (0, react.useState)({
				available: false,
				cards: []
			});
			const [scQuery, setScQuery] = (0, react.useState)("");
			const [scTag, setScTag] = (0, react.useState)("");
			const [scPreview, setScPreview] = (0, react.useState)("");
			const [scBusy, setScBusy] = (0, react.useState)("");
			const [boundStyle, setBoundStyle] = (0, react.useState)([]);
			const [delTarget, setDelTarget] = (0, react.useState)(null);
			const [orphans, setOrphans] = (0, react.useState)([]);
			const [orphanVol, setOrphanVol] = (0, react.useState)({});
			const [expBusy, setExpBusy] = (0, react.useState)("");
			const [expFiles, setExpFiles] = (0, react.useState)([]);
			const [expMsg, setExpMsg] = (0, react.useState)("");
			const [assets, setAssets] = (0, react.useState)([]);
			const [assetKind, setAssetKind] = (0, react.useState)("");
			const [assetErr, setAssetErr] = (0, react.useState)("");
			const [assetBusy, setAssetBusy] = (0, react.useState)("");
			const revRef = (0, react.useRef)(-1);
			const editRef = (0, react.useRef)(null);
			const [sharedCtx] = useWorkbenchContext(PANEL_ID);
			const sharedRef = (0, react.useRef)(sharedCtx);
			const api = async (path) => {
				const res = await fetch(API + path);
				if (!res.ok) throw new Error(await res.text());
				return res.json();
			};
			const loadProject = async (id) => {
				try {
					setData(await api("/projects/" + id));
				} catch {
					setData(null);
				}
			};
			const refresh = async () => {
				try {
					const list = (await api("/projects")).projects ?? [];
					setProjects(list);
					const target = list.some((p) => p.id === currentId) ? currentId : list[0]?.id ?? "";
					setCurrentId(target);
					if (target) loadProject(target);
				} catch {}
			};
			(0, react.useEffect)(() => {
				ensureCss();
				refresh();
			}, []);
			(0, react.useEffect)(() => {
				if (!currentId) return;
				lsSet(LS_KEYS.project, currentId);
				setProjectContext(currentId, PANEL_ID);
			}, [currentId]);
			(0, react.useEffect)(() => {
				lsSet(LS_KEYS.tab, tab);
			}, [tab]);
			(0, react.useEffect)(() => {
				if (!reading) return;
				lsSet(LS_KEYS.reading, reading);
				patchContext({ chapterId: reading }, PANEL_ID);
			}, [reading]);
			(0, react.useEffect)(() => {
				const prev = sharedRef.current;
				sharedRef.current = sharedCtx;
				if (!prev || !sharedCtx.updatedAt || sharedCtx.updatedAt === prev.updatedAt) return;
				if (sharedCtx.source === PANEL_ID) return;
				if (sharedCtx.projectId && sharedCtx.projectId !== currentId) {
					if (projects.length === 0 || projects.some((p) => p.id === sharedCtx.projectId)) {
						if (editRef.current) return;
						setCurrentId(sharedCtx.projectId);
						setReading(sharedCtx.chapterId || "");
						return;
					}
				}
				if (sharedCtx.chapterId && sharedCtx.chapterId !== reading) setReading(sharedCtx.chapterId);
			}, [
				sharedCtx,
				currentId,
				reading,
				projects
			]);
			(0, react.useEffect)(() => {
				editRef.current = edit;
			}, [edit]);
			(0, react.useEffect)(() => {
				if (!currentId) return;
				let alive = true;
				revRef.current = -1;
				const tick = async () => {
					try {
						const r = await api(`/projects/${currentId}/revision`);
						if (!alive) return;
						const rev = Number(r.revision ?? 0);
						const cur = revRef.current;
						if (cur === null || cur < 0) {
							revRef.current = rev;
							return;
						}
						if (rev !== cur) {
							revRef.current = rev;
							if (!editRef.current) await loadProject(currentId);
						}
					} catch {}
				};
				tick();
				const iv = setInterval(() => {
					tick();
				}, 4e3);
				return () => {
					alive = false;
					clearInterval(iv);
				};
			}, [currentId]);
			(0, react.useEffect)(() => {
				if (tab !== "chapters" || !data) return;
				const list = (data.outline ?? []).filter((n) => n.type === "chapter").sort((a, b) => a.order - b.order);
				if (list.length === 0) return;
				if (reading && list.some((n) => n.id === reading)) return;
				setReading(list[0].id);
			}, [
				tab,
				data,
				reading
			]);
			(0, react.useEffect)(() => {
				if (!currentId) return;
				if (tab !== "chapters" && tab !== "export") return;
				let alive = true;
				loadOrphans();
				if (tab === "export") api(`/projects/${currentId}/exports`).then((r) => {
					if (alive) setExpFiles(Array.isArray(r.files) ? r.files : []);
				}).catch(() => {
					if (alive) setExpFiles([]);
				});
				return () => {
					alive = false;
				};
			}, [tab, currentId]);
			const loadAssets = async () => {
				if (!currentId) return;
				setAssetErr("");
				try {
					const r = await api(`/projects/${currentId}/assets`);
					setAssets(Array.isArray(r.assets) ? r.assets : []);
				} catch (e) {
					setAssets([]);
					setAssetErr(String(e).slice(0, 160));
				}
			};
			(0, react.useEffect)(() => {
				if (tab !== "assets") return;
				loadAssets();
			}, [tab, currentId]);
			const setAssetCurrent = async (a, index) => {
				if (assetBusy) return;
				setAssetBusy(a.id);
				try {
					await fetch(`/@dsh-external/dsh-novel-writer/api/projects/${currentId}/assets/${encodeURIComponent(a.id)}/current`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ index })
					});
					await loadAssets();
				} catch (e) {
					setAssetErr(String(e).slice(0, 160));
				} finally {
					setAssetBusy("");
				}
			};
			const removeAsset = async (a) => {
				if (!window.confirm(`取消登记资产「${a.title}」？\n（只删除登记记录，不删除插件里的源文件）`)) return;
				try {
					await fetch(`/@dsh-external/dsh-novel-writer/api/projects/${currentId}/assets/${encodeURIComponent(a.id)}`, { method: "DELETE" });
					await loadAssets();
				} catch (e) {
					setAssetErr(String(e).slice(0, 160));
				}
			};
			const pickProject = (id) => {
				setCurrentId(id);
				setReading("");
				setContent("");
				setErr("");
				setImpResult("");
				setEdit(null);
				setPolishUI(false);
				setPolishWarn("");
				loadProject(id);
			};
			/** AI 智能编辑：调 POST /polish 生成润色稿（save=false 不落盘）→ 进入编辑态供确认后再保存 */
			const doPolish = async () => {
				if (!currentId || !reading || polishBusy) return;
				setPolishBusy(true);
				setEditErr("");
				setPolishWarn("");
				try {
					const res = await fetch(API + "/polish", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							projectId: currentId,
							chapterId: reading,
							mode: polishMode,
							focus: polishFocus.trim() || void 0,
							save: false
						})
					});
					const j = await res.json();
					if (!res.ok) throw new Error(j?.error ?? "HTTP " + res.status);
					if (typeof j.polished !== "string" || !j.polished) throw new Error("润色稿为空");
					if (j.damage && !j.damage.ok) setPolishWarn("⚠️ 完整性检测提示（未阻止，保存前请核对全文）：" + (j.damage.issues ?? []).join("；"));
					setDraft({ content: j.polished });
					setEdit({
						kind: "chapter",
						id: reading
					});
					setPolishUI(false);
				} catch (e) {
					setEditErr("AI 润色失败: " + String(e).slice(0, 200));
				} finally {
					setPolishBusy(false);
				}
			};
			/** 设定文件导入：POST /api/import（AI 解析 + 幂等写入） */
			const doImport = async () => {
				const pid = currentId || (projects[0]?.id ?? "");
				if (!pid || !impPath.trim() || impBusy) return;
				setImpBusy(true);
				setImpResult("AI 解析中（调用写作模型，可能需要几十秒）…");
				try {
					const res = await fetch(API + "/import", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							projectId: pid,
							filePath: impPath.trim(),
							mode: impMode,
							encoding: impEncoding,
							dryRun: impDry
						})
					});
					const j = await res.json();
					if (!res.ok) throw new Error(j?.error ?? "HTTP " + res.status);
					setImpResult(j.preview ?? JSON.stringify(j));
					if (!impDry) refresh();
				} catch (e) {
					setImpResult("导入失败: " + String(e));
				} finally {
					setImpBusy(false);
				}
			};
			(0, react.useEffect)(() => {
				if (tab !== "chapters" || !currentId || !reading) return;
				let alive = true;
				setContent("");
				setErr("");
				api(`/projects/${currentId}/chapters/${reading}`).then((r) => {
					if (alive) setContent(r.content ?? "");
				}).catch((e) => {
					if (alive) setErr(String(e).slice(0, 200));
				});
				return () => {
					alive = false;
				};
			}, [
				tab,
				currentId,
				reading
			]);
			(0, react.useEffect)(() => {
				if (tab !== "maps" || !currentId) return;
				let alive = true;
				setMapsLoading(true);
				setMapsErr("");
				fetch("/@dsh-external/dsh-map-forge/api/maps?projectId=" + encodeURIComponent(currentId) + "&limit=30").then(async (r) => {
					if (!r.ok) throw new Error("HTTP " + r.status);
					const j = await r.json();
					if (alive) setMaps(j.maps ?? []);
				}).catch((e) => {
					if (alive) setMapsErr(String(e).slice(0, 120));
				}).finally(() => {
					if (alive) setMapsLoading(false);
				});
				return () => {
					alive = false;
				};
			}, [tab, currentId]);
			(0, react.useEffect)(() => {
				if (tab !== "characters" || !currentId) return;
				let alive = true;
				setCmErr("");
				fetch("/@dsh-external/dsh-character-maker/api/novel-status?projectId=" + encodeURIComponent(currentId)).then(async (r) => {
					if (!r.ok) throw new Error("HTTP " + r.status);
					return r.json();
				}).then((j) => {
					if (alive && j.ok) setCmStatus(j.profiles ?? {});
				}).catch((e) => {
					if (alive) setCmErr("角色详析服务不可达（确认「角色设定工作坊」已装配）：" + String(e).slice(0, 80));
				});
				return () => {
					alive = false;
				};
			}, [tab, currentId]);
			(0, react.useEffect)(() => {
				if (tab !== "style") return;
				let alive = true;
				setScPreview("");
				const qs = new URLSearchParams();
				if (scTag) qs.set("tag", scTag);
				if (scQuery) qs.set("q", scQuery);
				api("/style-kb?" + qs.toString()).then((j) => {
					if (alive) setScKb({
						available: j.available,
						cards: j.cards ?? []
					});
				}).catch((e) => {
					if (alive) setScKb({
						available: false,
						cards: []
					});
				});
				if (currentId) api("/projects/" + currentId + "/style-kb").then((j) => {
					if (alive && j.available !== false && j.bound !== void 0) setBoundStyle(j.bound);
				}).catch(() => {});
				return () => {
					alive = false;
				};
			}, [
				tab,
				currentId,
				scQuery,
				scTag
			]);
			/** 一键生成/更新角色详析：调 dsh-character-maker 的 /analyze（LLM 六节画像并写回 personalityProfile） */
			const doCmAnalyze = async (chId) => {
				if (cmBusy || !currentId) return;
				setCmBusy(chId);
				setCmErr("");
				try {
					const res = await fetch("/@dsh-external/dsh-character-maker/api/analyze", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							projectId: currentId,
							characterId: chId,
							depth: "standard",
							persist: true
						})
					});
					const j = await res.json().catch(() => ({}));
					if (!res.ok || j.ok === false) throw new Error(j?.error ?? "HTTP " + res.status);
					const card = j.card ?? j.narrative ?? "";
					setCmView((m) => ({
						...m,
						[chId]: card
					}));
					setCmStatus((m) => ({
						...m,
						[chId]: {
							...m[chId] ?? {},
							hasProfile: true
						}
					}));
					refresh();
				} catch (e) {
					setCmErr("角色详析生成失败: " + String(e).slice(0, 160));
				} finally {
					setCmBusy("");
				}
			};
			const scReloadBound = async () => {
				if (!currentId) return;
				try {
					const j = await api("/projects/" + currentId + "/style-kb");
					if (Array.isArray(j.bound)) setBoundStyle(j.bound);
				} catch {}
			};
			const scLoadPreview = async () => {
				if (!currentId) return;
				try {
					const j = await api("/projects/" + currentId + "/style-kb/preview");
					setScPreview(j.preview ?? "");
					setScBusy("");
				} catch (e) {
					setScBusy("预览失败: " + String(e).slice(0, 120));
				}
			};
			const scPost = async (cards, enabled) => {
				if (!currentId || scBusy) return;
				setScBusy("保存中…");
				try {
					await fetch(API + "/projects/" + currentId + "/style-kb", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							cards,
							enabled
						})
					});
					await scReloadBound();
					await scLoadPreview();
				} catch (e) {
					setScBusy("操作失败: " + String(e).slice(0, 120));
				} finally {
					setScBusy("");
				}
			};
			const scRemove = async (cards) => {
				if (!currentId || scBusy) return;
				setScBusy("保存中…");
				try {
					await fetch(API + "/projects/" + currentId + "/style-kb", {
						method: "DELETE",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ cards })
					});
					await scReloadBound();
					await scLoadPreview();
				} catch (e) {
					setScBusy("操作失败: " + String(e).slice(0, 120));
				} finally {
					setScBusy("");
				}
			};
			const putPath = (kind, id) => {
				return `/projects/${currentId}/${kind === "worldview" ? "worldview" : kind === "character" ? "characters" : kind === "outline" ? "outline" : kind === "foreshadowing" ? "foreshadowings" : kind === "geo" ? "geo" : kind === "item" ? "items" : "chapters"}/${id}`;
			};
			const beginEdit = (kind, item, extras) => {
				const d = {
					...item ?? {},
					...extras ?? {}
				};
				if (Array.isArray(d.possessions)) d.possessions = d.possessions.join("、");
				if (Array.isArray(d.aliases)) d.aliases = d.aliases.join("、");
				if (Array.isArray(d.beats)) d.beats = d.beats.join("\n");
				setDraft(d);
				setEdit({
					kind,
					id: item?.id ?? ""
				});
				setEditErr("");
			};
			const saveEdit = async () => {
				if (!edit || saving) return;
				setSaving(true);
				setEditErr("");
				try {
					const d = { ...draft };
					if (Array.isArray(d.possessions) || typeof d.possessions === "string") d.possessions = String(d.possessions ?? "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
					if (typeof d.aliases === "string") d.aliases = d.aliases.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
					if (typeof d.beats === "string") d.beats = d.beats.split("\n").map((s) => s.trim()).filter(Boolean);
					if (edit.kind === "chapter") {
						delete d.id;
						delete d.title;
						delete d.order;
						delete d.wordCount;
						delete d.summary;
						delete d.status;
					} else {
						delete d.id;
						delete d.parentId;
						delete d.order;
						delete d.plantedChapterId;
						delete d.resolvedChapterId;
						delete d.notes_auto;
					}
					if (edit.kind === "geo") for (const k of ["mapX", "mapY"]) {
						const v = d[k];
						if (v === "" || v === null || v === void 0) {
							d[k] = null;
							continue;
						}
						const n = Number(v);
						d[k] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
					}
					const res = await fetch(API + putPath(edit.kind, edit.id), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(d)
					});
					const j = await res.json().catch(() => ({}));
					if (res.status === 409) {
						await loadProject(currentId);
						setEditErr("项目已被其他插件（角色工作坊/地图/配音）修改，已载入最新数据；请复核后再次点击保存。");
						return;
					}
					if (!res.ok) throw new Error(j?.error ?? "HTTP " + res.status);
					if (edit.kind === "chapter" && typeof draft.content === "string") setContent(draft.content);
					setEdit(null);
					refresh();
				} catch (e) {
					setEditErr(String(e).slice(0, 200));
				} finally {
					setSaving(false);
				}
			};
			const delItem = async (kind, id, label) => {
				if (!window.confirm(`确定删除${label}？此操作不可恢复。`)) return;
				try {
					const res = await fetch(API + putPath(kind, id), { method: "DELETE" });
					if (!res.ok) throw new Error("HTTP " + res.status);
					if (edit?.id === id) setEdit(null);
					refresh();
				} catch (e) {
					alert("删除失败: " + String(e).slice(0, 200));
				}
			};
			const loadOrphans = async () => {
				if (!currentId) return;
				try {
					const r = await api(`/projects/${currentId}/orphans`);
					setOrphans(Array.isArray(r.orphans) ? r.orphans : []);
				} catch {
					setOrphans([]);
				}
			};
			const doDeleteOutline = async (mode) => {
				if (!delTarget || !currentId) return;
				const t = delTarget;
				setDelTarget(null);
				try {
					const res = await fetch(`/@dsh-external/dsh-novel-writer/api/projects/${currentId}/outline/${encodeURIComponent(t.id)}?mode=${mode}`, { method: "DELETE" });
					const j = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(j?.error ?? "HTTP " + res.status);
					const parts = [`已删除大纲节点 ${j.removedNodes ?? 1} 个`];
					if (j.chapters?.length) parts.push(`涉及章节 ${j.chapters.length} 个`);
					if (j.archived?.length) parts.push(`正文已归档 ${j.archived.length} 篇（chapters/archive/）`);
					if (j.purged?.length) parts.push(`已清除正文 ${j.purged.length} 篇`);
					setExpMsg(parts.join("；"));
					if (edit?.kind === "outline" && edit.id === t.id) setEdit(null);
					refresh();
					loadOrphans();
				} catch (e) {
					window.alert("删除失败: " + String(e).slice(0, 200));
				}
			};
			const restoreOrphan = async (id) => {
				if (!currentId) return;
				try {
					const res = await fetch(`/@dsh-external/dsh-novel-writer/api/projects/${currentId}/orphans/${encodeURIComponent(id)}/restore`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ volumeId: orphanVol[id] || null })
					});
					const j = await res.json().catch(() => ({}));
					if (!res.ok || j.ok === false) throw new Error(j?.error ?? j?.message ?? "HTTP " + res.status);
					setExpMsg(`已恢复章节「${j.node?.title ?? id}」到大纲`);
					refresh();
					loadOrphans();
				} catch (e) {
					window.alert("恢复失败: " + String(e).slice(0, 200));
				}
			};
			const doExport = async (format) => {
				if (!currentId || expBusy) return;
				setExpBusy(format);
				setExpMsg("");
				try {
					const res = await fetch(`/@dsh-external/dsh-novel-writer/api/projects/${currentId}/export`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ format })
					});
					const j = await res.json().catch(() => ({}));
					if (!res.ok) throw new Error(j?.error ?? "HTTP " + res.status);
					setExpMsg(`已导出 ${format}：${j.file}（${j.chapterCount} 章 / ${j.wordCount} 字）`);
					const r = await api(`/projects/${currentId}/exports`);
					setExpFiles(Array.isArray(r.files) ? r.files : []);
				} catch (e) {
					setExpMsg("导出失败: " + String(e).slice(0, 200));
				} finally {
					setExpBusy("");
				}
			};
			const cancelEdit = () => setEdit(null);
			/** 通用编辑表单渲染（number 用于坐标等数值字段，提交前在 saveEdit 里转数字） */
			const formField = (key, label, type = "input", rows = 3, ph = "") => (0, react.createElement)("div", {
				key,
				className: "row"
			}, (0, react.createElement)("label", null, label), type === "textarea" ? (0, react.createElement)("textarea", {
				rows,
				value: String(draft[key] ?? ""),
				onChange: (e) => setDraft({
					...draft,
					[key]: e.target.value
				}),
				placeholder: ph
			}) : type === "number" ? (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 1,
				step: .01,
				value: draft[key] === null || draft[key] === void 0 ? "" : String(draft[key]),
				onChange: (e) => setDraft({
					...draft,
					[key]: e.target.value
				}),
				placeholder: ph
			}) : (0, react.createElement)("input", {
				value: String(draft[key] ?? ""),
				onChange: (e) => setDraft({
					...draft,
					[key]: e.target.value
				}),
				placeholder: ph
			}));
			const formSelect = (key, label, options) => (0, react.createElement)("div", {
				key,
				className: "row"
			}, (0, react.createElement)("label", null, label), (0, react.createElement)("select", {
				value: String(draft[key] ?? ""),
				onChange: (e) => setDraft({
					...draft,
					[key]: e.target.value
				})
			}, options.map(([v, l]) => (0, react.createElement)("option", {
				key: v,
				value: v
			}, l))));
			const formActions = () => (0, react.createElement)("div", {
				key: "actions",
				className: "row"
			}, (0, react.createElement)("button", {
				className: "nw-btn-sm primary",
				onClick: () => void saveEdit(),
				disabled: saving
			}, saving ? "保存中…" : "保存"), (0, react.createElement)("button", {
				className: "nw-btn-sm",
				onClick: cancelEdit,
				disabled: saving
			}, "取消"), editErr ? (0, react.createElement)("span", { style: {
				color: "#ff9d9d",
				fontSize: 11
			} }, editErr) : null);
			const editForm = (fields) => (0, react.createElement)("div", { className: "nw-form" }, [...fields, formActions()]);
			const isEditing = (kind, id) => edit !== null && edit.kind === kind && edit.id === id;
			const renderOutline = () => {
				const d = data;
				const byParent = /* @__PURE__ */ new Map();
				for (const n of d.outline) {
					const list = byParent.get(n.parentId ?? null) ?? [];
					list.push(n);
					byParent.set(n.parentId ?? null, list);
				}
				const nodeRow = (n) => {
					if (isEditing("outline", n.id)) return (0, react.createElement)("div", {
						key: n.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, `编辑大纲节点：${n.title}`)), editForm([
						formField("title", "标题"),
						formField("summary", "目标", "textarea", 3, "章节目标/概要"),
						formField("beats", "情节拍", "textarea", 5, "每行一个情节拍"),
						formSelect("status", "状态", [
							["planned", "planned（未写）"],
							["writing", "writing（写作中）"],
							["done", "done（完成）"]
						])
					]));
					const kids = (byParent.get(n.id) ?? []).sort((a, b) => a.order - b.order);
					return (0, react.createElement)("div", {
						key: n.id,
						className: "nw-node"
					}, (0, react.createElement)("div", { className: "nw-node-row" }, (0, react.createElement)("div", { className: "nw-node-main" }, `${STATUS_MARK[n.status] ?? "·"} ${n.type === "volume" ? "📖" : "📄"} `, (0, react.createElement)("b", null, n.title), (0, react.createElement)("span", { className: "nw-fs" }, ` [${n.type}#${n.order}]`), n.summary ? (0, react.createElement)("div", { style: { opacity: .65 } }, n.summary.slice(0, 120)) : null, n.type === "chapter" && n.beats.length > 0 ? (0, react.createElement)("div", { style: { opacity: .5 } }, n.beats.map((b, i) => `${i + 1}. ${b.slice(0, 60)}`).join("　")) : null), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => beginEdit("outline", n)
					}, "编辑"), (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => setDelTarget({
							id: n.id,
							title: n.title,
							type: n.type
						})
					}, "删除"))), kids.length > 0 ? (0, react.createElement)("div", { className: "nw-node-children" }, kids.map(nodeRow)) : null);
				};
				const roots = (byParent.get(null) ?? []).sort((a, b) => a.order - b.order);
				const open = d.foreshadowings.filter((f) => f.status === "open");
				return (0, react.createElement)("div", null, delTarget ? (0, react.createElement)("div", {
					className: "nw-card",
					style: { borderColor: "#e05555" }
				}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, `删除${delTarget.type === "volume" ? "卷" : delTarget.type === "chapter" ? "章节" : "节点"}「${delTarget.title}」`)), (0, react.createElement)("div", { className: "nw-hint" }, delTarget.type === "volume" ? "将连同该卷下的全部章节节点一起删除。" : "其子节点会一并删除。", "请选择正文的处置方式（直接删大纲会导致正文变成孤儿，从章节 UI 消失）："), (0, react.createElement)("div", {
					className: "nw-acts",
					style: { marginTop: 6 }
				}, (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => void doDeleteOutline("outline")
				}, "仅移除大纲（正文保留）"), (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void doDeleteOutline("archive")
				}, "删除并归档正文"), (0, react.createElement)("button", {
					className: "nw-btn-sm danger",
					onClick: () => void doDeleteOutline("purge")
				}, "删除并清除正文"), (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => setDelTarget(null)
				}, "取消"))) : null, (0, react.createElement)("div", { className: "nw-sec" }, `大纲树（${d.outline.length} 节点）`), roots.length === 0 ? (0, react.createElement)("div", { className: "nw-empty" }, "（大纲为空）") : (0, react.createElement)("div", null, roots.map(nodeRow)), (0, react.createElement)("div", { className: "nw-sec" }, `未解伏笔（${open.length}）`), open.length === 0 ? (0, react.createElement)("div", {
					className: "nw-fs",
					style: { padding: "4px 0" }
				}, "（无）") : open.map((f) => isEditing("foreshadowing", f.id) ? (0, react.createElement)("div", {
					key: f.id,
					className: "nw-card"
				}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, "编辑伏笔")), editForm([
					formField("description", "伏笔"),
					formField("notes", "备注"),
					formSelect("status", "状态", [
						["open", "open（未回收）"],
						["resolved", "resolved（已回收）"],
						["abandoned", "abandoned（弃用）"]
					])
				])) : (0, react.createElement)("div", {
					key: f.id,
					style: {
						display: "flex",
						gap: 8,
						alignItems: "flex-start",
						padding: "3px 0"
					}
				}, (0, react.createElement)("span", { style: {
					flex: 1,
					fontSize: 12,
					lineHeight: 1.7
				} }, `○ ${f.description}`, f.notes ? (0, react.createElement)("i", { style: { opacity: .6 } }, `（${f.notes}）`) : null), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => beginEdit("foreshadowing", f)
				}, "编辑"), (0, react.createElement)("button", {
					className: "nw-btn-sm danger",
					onClick: () => void delItem("foreshadowing", f.id, "伏笔")
				}, "删除")))));
			};
			const renderCharacters = () => {
				const d = data;
				if (d.characters.length === 0) return (0, react.createElement)("div", { className: "nw-empty" }, "暂无人物档案");
				return (0, react.createElement)("div", null, d.characters.map((c) => {
					if (isEditing("character", c.id)) return (0, react.createElement)("div", {
						key: c.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, `编辑人物：${c.name}`)), editForm([
						formField("name", "姓名"),
						formField("aliases", "别名", "input", 1, "逗号分隔"),
						formSelect("role", "定位", Object.entries(ROLE_LABEL)),
						formField("appearance", "外貌", "textarea", 2),
						formField("personality", "性格", "textarea", 2),
						formField("background", "背景", "textarea", 3),
						formField("goal", "目标", "textarea", 2),
						formField("location", "位置", "input", 1),
						formField("condition", "状况", "input", 1),
						formField("possessions", "持有物", "input", 1, "逗号分隔")
					]));
					const cm = cmStatus[c.id] ?? {};
					const cmViewText = cmView[c.id];
					const cmBadges = [];
					if (cm.core) cmBadges.push(`${cm.core}号${cm.wing ? ` ${cm.wing}` : ""}${cm.wingNick ? `（${cm.wingNick}）` : ""}`);
					if (cm.mbti) cmBadges.push(cm.mbti);
					if (c.personalityProfile || cm.hasProfile) cmBadges.push("✓已详析");
					const cmVisible = cmViewText ?? (cmBadges.length ? "" : "");
					return (0, react.createElement)("div", {
						key: c.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, c.name, (0, react.createElement)("span", { className: "nw-badge" }, ROLE_LABEL[c.role] ?? c.role)), cmBadges.map((b, i) => (0, react.createElement)("span", {
						key: i,
						className: "cm-badge-css"
					}, b)), c.aliases.length ? (0, react.createElement)("span", { className: "sub" }, `又称 ${c.aliases.join("、")}`) : null, (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => beginEdit("character", c)
					}, "编辑"), (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => void delItem("character", c.id, `人物「${c.name}」`)
					}, "删除"))), (0, react.createElement)("div", { className: "nw-kv" }, c.appearance ? (0, react.createElement)("div", null, `外貌：${c.appearance}`) : null, c.personality ? (0, react.createElement)("div", null, `性格：${c.personality}`) : null, c.background ? (0, react.createElement)("div", null, `背景：${c.background}`) : null, c.goal ? (0, react.createElement)("div", null, `目标：${c.goal}`) : null, (0, react.createElement)("div", { style: { opacity: .75 } }, `当前：位置=${c.currentState.location || "?"} · 状况=${c.currentState.condition || "?"}${c.currentState.possessions.length ? " · 持有=" + c.currentState.possessions.join("、") : ""}`), c.currentState.notes ? (0, react.createElement)("div", { style: { opacity: .6 } }, `备注：${c.currentState.notes}`) : null, (0, react.createElement)("div", { className: "cm-bar2" }, (0, react.createElement)("span", { className: "cm-title" }, "角色详析"), (0, react.createElement)("button", {
						className: "nw-btn-sm primary",
						onClick: () => void doCmAnalyze(c.id),
						disabled: cmBusy === c.id
					}, cmBusy === c.id ? "生成中…" : cmBadges.length || c.personalityProfile ? "⚡ 更新详析" : "⚡ 生成详析"), c.personalityProfile || cmViewText ? (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => setCmView((m) => ({
							...m,
							[c.id]: cmViewText ? "" : c.personalityProfile ?? ""
						}))
					}, cmViewText ? "收起" : "查看详析") : null, cmErr && c.id === Object.keys(cmStatus)[0] ? (0, react.createElement)("span", { style: {
						color: "#ff9d9d",
						fontSize: 11
					} }, cmErr) : null)), cmVisible ? (0, react.createElement)("div", {
						className: "nw-content",
						style: {
							maxHeight: 400,
							fontSize: 12,
							whiteSpace: "pre-wrap",
							fontFamily: "ui-monospace, monospace"
						}
					}, cmVisible) : null);
				}));
			};
			const renderWorldview = () => {
				const d = data;
				if (d.worldview.length === 0) return (0, react.createElement)("div", { className: "nw-empty" }, "暂无世界观设定");
				const byCat = /* @__PURE__ */ new Map();
				for (const e of d.worldview) {
					const list = byCat.get(e.category) ?? [];
					list.push(e);
					byCat.set(e.category, list);
				}
				return (0, react.createElement)("div", null, [...byCat.entries()].map(([cat, entries]) => (0, react.createElement)("div", { key: cat }, (0, react.createElement)("div", { className: "nw-sec" }, `${CAT_LABEL[cat] ?? cat}（${entries.length}）`), entries.map((e) => {
					if (isEditing("worldview", e.id)) return (0, react.createElement)("div", {
						key: e.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, "编辑世界观条目")), editForm([
						formField("title", "标题"),
						formSelect("category", "类别", Object.entries(CAT_LABEL)),
						formField("content", "内容", "textarea", 6)
					]));
					return (0, react.createElement)("div", {
						key: e.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, e.title), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => beginEdit("worldview", e)
					}, "编辑"), (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => void delItem("worldview", e.id, `世界观条目「${e.title}」`)
					}, "删除"))), (0, react.createElement)("div", { className: "nw-kv" }, e.content));
				}))));
			};
			const renderGeo = () => {
				const geo = data.geo ?? [];
				if (geo.length === 0) return (0, react.createElement)("div", { className: "nw-empty" }, "暂无地理条目（旧版世界观里的地理已在加载时自动迁移至此；用小说工坊工具登记新地点）");
				const byType = /* @__PURE__ */ new Map();
				for (const g of geo) {
					const list = byType.get(g.type) ?? [];
					list.push(g);
					byType.set(g.type, list);
				}
				const coordLabel = (g) => g.mapX !== null && g.mapY !== null ? `（坐标 ${Math.round(g.mapX * 100)}%,${Math.round(g.mapY * 100)}%）` : "";
				return (0, react.createElement)("div", null, [...byType.entries()].map(([type, entries]) => (0, react.createElement)("div", { key: type }, (0, react.createElement)("div", { className: "nw-sec" }, `${GEO_LABEL[type] ?? type}（${entries.length}）`), entries.map((g) => {
					if (isEditing("geo", g.id)) return (0, react.createElement)("div", {
						key: g.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, "编辑地理条目")), editForm([
						formField("name", "名称"),
						formSelect("type", "类型", Object.entries(GEO_LABEL)),
						formField("description", "描述", "textarea", 4),
						formField("mapX", "横坐标(0-1)", "input", 1, "0-1，可空，地图相对位置"),
						formField("mapY", "纵坐标(0-1)", "input", 1, "0-1，可空")
					]));
					return (0, react.createElement)("div", {
						key: g.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, g.name, (0, react.createElement)("span", { className: "nw-badge" }, GEO_LABEL[g.type] ?? g.type)), g.aliases.length ? (0, react.createElement)("span", { className: "sub" }, `又称 ${g.aliases.join("、")}`) : null, (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => beginEdit("geo", g)
					}, "编辑"), (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => void delItem("geo", g.id, `地理「${g.name}」`)
					}, "删除"))), (0, react.createElement)("div", { className: "nw-kv" }, g.description ? (0, react.createElement)("div", null, g.description) : null, coordLabel(g) ? (0, react.createElement)("div", { style: { opacity: .7 } }, coordLabel(g)) : null));
				}))));
			};
			const renderItems = () => {
				const items = data.items ?? [];
				if (items.length === 0) return (0, react.createElement)("div", { className: "nw-empty" }, "暂无物品档案（章节记忆会自动登记出现过的物品；用 novel_item_edit 提前登记重要物品）");
				const byCat = /* @__PURE__ */ new Map();
				for (const it of items) {
					const list = byCat.get(it.category) ?? [];
					list.push(it);
					byCat.set(it.category, list);
				}
				return (0, react.createElement)("div", null, [...byCat.entries()].map(([cat, entries]) => (0, react.createElement)("div", { key: cat }, (0, react.createElement)("div", { className: "nw-sec" }, `${ITEM_LABEL[cat] ?? cat}（${entries.length}）`), entries.map((it) => {
					if (isEditing("item", it.id)) return (0, react.createElement)("div", {
						key: it.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, "编辑物品")), editForm([
						formField("name", "名称"),
						formSelect("category", "类别", Object.entries(ITEM_LABEL)),
						formField("description", "描述", "textarea", 4),
						formField("owner", "持有者", "input", 1),
						formField("location", "所在地", "input", 1),
						formField("status", "状态", "input", 1, "正常/损坏/失窃/封印…")
					]));
					const rel = [
						it.owner ? `持有=${it.owner}` : "",
						it.location ? `在=${it.location}` : "",
						it.status ? `状态=${it.status}` : ""
					].filter(Boolean).join(" · ");
					return (0, react.createElement)("div", {
						key: it.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, it.name, (0, react.createElement)("span", { className: "nw-badge" }, ITEM_LABEL[it.category] ?? it.category)), it.aliases.length ? (0, react.createElement)("span", { className: "sub" }, `又称 ${it.aliases.join("、")}`) : null, (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => beginEdit("item", it)
					}, "编辑"), (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => void delItem("item", it.id, `物品「${it.name}」`)
					}, "删除"))), (0, react.createElement)("div", { className: "nw-kv" }, it.description ? (0, react.createElement)("div", null, it.description) : null, rel ? (0, react.createElement)("div", { style: { opacity: .75 } }, rel) : null));
				}))));
			};
			const renderStyle = () => {
				const d = data;
				const allCards = scKb.cards ?? [];
				if (!scKb.available) return (0, react.createElement)("div", { className: "nw-empty" }, "文风知识库（style-kb）不可达：请在插件配置 styleKbDir 指向 style-kb 根目录（含 cards/ 子目录）。绑定文风卡后，写作/续写/润色会自动注入对应文风。");
				const bound = (d.project.styleCards ?? []).map((b) => {
					const card = allCards.find((c) => c.key === b.key);
					return {
						...b,
						title: card?.title ?? b.key,
						tags: card?.tags ?? []
					};
				});
				const boundKeys = new Set(bound.map((b) => b.key));
				const unbound = allCards.filter((c) => !boundKeys.has(c.key));
				const tagOptions = [...new Set(allCards.flatMap((c) => (c.tags ?? []).filter((t) => ![
					"文风",
					"手法",
					"目录"
				].includes(t))))].sort();
				return (0, react.createElement)("div", {
					className: "nw-imp",
					style: { maxWidth: 920 }
				}, (0, react.createElement)("div", { className: "nw-sec" }, `已绑定文风卡（${bound.length} 张 · 多卡可并存，启用者写作时注入）`), bound.length === 0 ? (0, react.createElement)("div", { className: "nw-empty" }, "尚未绑定文风卡。从下方「文风知识库」点「绑定」（一张或多张；生成时默认注入所有「启用」的卡，也可在生成时传 styleCards 按本章选用）。") : (0, react.createElement)("div", null, bound.map((b) => (0, react.createElement)("div", {
					key: b.key,
					className: "nw-card"
				}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, b.title, b.enabled ? (0, react.createElement)("span", { className: "nw-badge" }, "✓启用") : (0, react.createElement)("span", {
					className: "nw-badge",
					style: { opacity: .55 }
				}, "停用")), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => void scPost([b.key], !b.enabled),
					disabled: !!scBusy
				}, b.enabled ? "停用" : "启用"), (0, react.createElement)("button", {
					className: "nw-btn-sm danger",
					onClick: () => void scRemove([b.key]),
					disabled: !!scBusy
				}, "移除"))), b.tags.length ? (0, react.createElement)("div", { className: "nw-fs" }, b.tags.join("、")) : null))), (0, react.createElement)("div", { className: "nw-sec" }, "文风知识库（检索/绑定）"), (0, react.createElement)("div", { className: "nw-form" }, (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("input", {
					className: "nw-inp",
					style: { flex: 1 },
					value: scQuery,
					onChange: (e) => setScQuery(e.target.value),
					placeholder: "检索：作者名 / 作品名 / 标题 / 手法关键词（米泽 / 凉宫 / 设定系 / 恋爱喜剧）"
				}), (0, react.createElement)("select", {
					value: scTag,
					onChange: (e) => setScTag(e.target.value)
				}, [["", "全部体裁"]].concat(tagOptions.map((t) => [t, t])).map(([v, l]) => (0, react.createElement)("option", {
					key: v,
					value: v
				}, l)))), allCards.length === 0 ? (0, react.createElement)("div", { className: "nw-fs" }, "（无匹配卡片）") : (0, react.createElement)("div", null, unbound.length === 0 ? (0, react.createElement)("div", { className: "nw-fs" }, "（当前结果均已绑定）") : unbound.map((c) => (0, react.createElement)("div", {
					key: c.key,
					className: "nw-card"
				}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, c.title), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void scPost([c.key], true),
					disabled: !!scBusy
				}, scBusy ? "…" : "绑定"))), c.tags.length ? (0, react.createElement)("div", { className: "nw-fs" }, c.tags.join("、")) : null)))), (0, react.createElement)("div", { className: "nw-sec" }, "注入预览"), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => void scLoadPreview(),
					disabled: !!scBusy
				}, "刷新（生成注入）预览"), scBusy && scBusy !== "保存中…" ? (0, react.createElement)("span", { style: {
					color: "#ff9d9d",
					fontSize: 11
				} }, scBusy) : null), scPreview ? (0, react.createElement)("div", { className: "nw-res" }, (0, react.createElement)("pre", null, scPreview)) : (0, react.createElement)("div", { className: "nw-hint" }, "当前启用文风卡会以什么文案注入 novel_chapter_write / novel_chapter_continue 的 system prompt（每张 ≤700 字符、默认最多 3 张）；「对应文风」可按章节在生成时用 styleCards 临时换用。"));
			};
			const renderMaps = () => {
				const d = data;
				const geoCount = d.geo?.length ?? 0;
				return (0, react.createElement)("div", {
					className: "nw-imp",
					style: { maxWidth: 860 }
				}, (0, react.createElement)("div", { className: "nw-hint" }, `本项目的地图由「地图工坊」（dsh-map-forge）生成：说「为《${d.project.name}》绘制世界地图」或直接在右侧地图工坊面板操作。地理库（${geoCount} 条，见「地理」tab）中的国家/区域/城市/地形及其坐标会自动注入地图提示词。`), (0, react.createElement)("div", { className: "nw-sec" }, `地图记录（${mapsLoading ? "加载中…" : maps.length + " 张"}）`), mapsErr ? (0, react.createElement)("div", { className: "nw-empty" }, `地图工坊 API 不可达（${mapsErr}）——确认 dsh-map-forge 插件已装载`) : maps.length === 0 ? (0, react.createElement)("div", { className: "nw-empty" }, mapsLoading ? "加载中…" : "本项目暂无地图：用 mapforge_generate(projectId=...) 生成世界地图") : (0, react.createElement)("div", null, maps.map((m) => {
					const title = m.title ?? "未命名";
					const files = Array.isArray(m.files) ? m.files : [];
					const nameOf = (p) => String(p).split(/[\\/]/).pop() ?? p;
					return (0, react.createElement)("div", {
						key: m.id,
						className: "nw-card"
					}, (0, react.createElement)("h4", null, (0, react.createElement)("span", { className: "grow" }, title), (0, react.createElement)("span", { className: "sub" }, `${m.style ?? "?"} · ${m.size ?? "?"} · ${(m.createdAt ?? "").slice(0, 16).replace("T", " ")}`)), m.status === "failed" ? (0, react.createElement)("div", { className: "nw-kv" }, `生成失败：${m.error ?? ""}`) : m.status === "running" ? (0, react.createElement)("div", { className: "nw-kv" }, "生成中…") : files.length > 0 ? (0, react.createElement)("div", null, (0, react.createElement)("div", { style: {
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))",
						gap: 8
					} }, files.map((f, i) => (0, react.createElement)("img", {
						key: i,
						src: `/@dsh-external/dsh-map-forge/api/maps/${m.id}/image?i=${i}`,
						title: nameOf(f),
						style: {
							width: "100%",
							borderRadius: 8,
							border: "1px solid var(--dsh-border,#444)",
							cursor: "zoom-in"
						},
						onClick: () => window.open(`/@dsh-external/dsh-map-forge/api/maps/${m.id}/image?i=${i}`, "_blank")
					}))), (0, react.createElement)("div", {
						className: "nw-hint",
						style: { marginTop: 6 }
					}, `${files.length} 张：${files.map(nameOf).join("、")}`)) : (0, react.createElement)("div", { className: "nw-kv" }, "（无图片文件）"));
				})));
			};
			/** 孤儿章节列表：有正文/记录但大纲已无节点，可恢复到指定卷 */
			const renderOrphans = (volumes) => {
				if (orphans.length === 0) return null;
				return (0, react.createElement)("div", { style: {
					marginTop: 10,
					borderTop: "1px dashed var(--dsh-border,#3a3a44)",
					paddingTop: 6
				} }, (0, react.createElement)("div", { style: {
					fontSize: 11,
					opacity: .7,
					padding: "2px 6px"
				} }, `孤儿章节（${orphans.length}）`), orphans.map((o) => (0, react.createElement)("div", {
					key: o.id,
					style: {
						padding: "4px 6px",
						fontSize: 11
					}
				}, (0, react.createElement)("div", { style: {
					display: "flex",
					gap: 6,
					alignItems: "center"
				} }, (0, react.createElement)("span", { style: {
					flex: 1,
					overflow: "hidden",
					textOverflow: "ellipsis"
				} }, `${o.title}（${o.wordCount}字）`), (0, react.createElement)("span", { style: {
					opacity: .55,
					whiteSpace: "nowrap"
				} }, o.hasContent ? "有正文" : "仅记录")), (0, react.createElement)("div", { style: {
					display: "flex",
					gap: 4,
					marginTop: 3
				} }, (0, react.createElement)("select", {
					value: orphanVol[o.id] ?? "",
					style: {
						fontSize: 11,
						maxWidth: 118
					},
					onChange: (e) => setOrphanVol((m) => ({
						...m,
						[o.id]: e.target.value
					}))
				}, (0, react.createElement)("option", { value: "" }, "未分卷"), volumes.map((v, i) => (0, react.createElement)("option", {
					key: v.id,
					value: v.id
				}, `第${i + 1}卷 ${v.title}`))), (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => void restoreOrphan(o.id)
				}, "恢复")))));
			};
			const renderChapters = () => {
				const outlineChapters = (data?.outline ?? []).filter((n) => n.type === "chapter").sort((a, b) => a.order - b.order);
				const chapterRecs = (data?.chapters ?? []).slice().sort((a, b) => a.order - b.order);
				const volumes = (data?.outline ?? []).filter((n) => n.type === "volume").sort((a, b) => a.order - b.order);
				const volOf = /* @__PURE__ */ new Map();
				for (const n of data?.outline ?? []) if (n.type === "chapter" && n.parentId) volOf.set(n.id, n.parentId);
				const groupList = [];
				for (const v of volumes) groupList.push({
					vol: v,
					chapters: outlineChapters.filter((n) => volOf.get(n.id) === v.id)
				});
				const loose = outlineChapters.filter((n) => !volOf.get(n.id));
				if (loose.length > 0) groupList.push({
					vol: null,
					chapters: loose
				});
				for (const g of groupList) g.chapters.sort((a, b) => a.order - b.order);
				const firstAll = groupList.flatMap((g) => g.chapters);
				const active = reading && outlineChapters.some((n) => n.id === reading) ? reading : firstAll[0]?.id ?? "";
				if (outlineChapters.length === 0) return orphans.length > 0 ? (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "nw-sec" }, "章节"), renderOrphans(volumes)) : (0, react.createElement)("div", { className: "nw-empty" }, "暂无章节");
				if (!active || reading !== active) return (0, react.createElement)("div", { className: "nw-empty" }, "加载中…");
				const rec = chapterRecs.find((c) => c.id === active);
				const editingChapter = isEditing("chapter", active);
				const volTitle = (vid) => {
					if (!vid) return "";
					const v = volumes.find((x) => x.id === vid);
					return `第${volumes.findIndex((x) => x.id === vid) + 1}卷 ${v?.title ?? ""}`;
				};
				return (0, react.createElement)("div", { style: {
					display: "flex",
					gap: 10
				} }, (0, react.createElement)("div", {
					className: "nw-chlist",
					style: {
						minWidth: 180,
						maxWidth: 260
					}
				}, [...groupList.flatMap((g, gi) => {
					return [g.vol ? (0, react.createElement)("div", {
						key: "vol-" + g.vol.id,
						className: "nw-vol",
						style: {
							margin: "8px 0 2px",
							fontSize: 11,
							opacity: .75,
							fontWeight: 600,
							padding: "2px 6px"
						}
					}, `📖 第${gi + 1}卷 ${g.vol.title}`) : (0, react.createElement)("div", {
						key: "vol-none",
						className: "nw-vol",
						style: {
							margin: "8px 0 2px",
							fontSize: 11,
							opacity: .55,
							padding: "2px 6px"
						}
					}, "未分卷"), ...g.chapters.map((n) => {
						const r = chapterRecs.find((c) => c.id === n.id);
						return (0, react.createElement)("div", {
							key: n.id,
							className: "nw-ch" + (active === n.id ? " on" : ""),
							onClick: () => setReading(n.id)
						}, (0, react.createElement)("span", null, `${STATUS_MARK[r ? r.status : n.status] ?? "·"} 第${n.order}章 ${n.title}`), (0, react.createElement)("span", { style: { opacity: .6 } }, r ? r.wordCount + "字" : "未生成"));
					})];
				}), renderOrphans(volumes)]), (0, react.createElement)("div", { style: {
					flex: 1,
					minWidth: 0
				} }, editingChapter ? (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "nw-editbar" }, (0, react.createElement)("span", null, `编辑第${rec?.order ?? "?"}章《${rec?.title ?? ""}》正文（保存后同步更新字数统计）`), (0, react.createElement)("div", { className: "nw-acts" }, (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void saveEdit(),
					disabled: saving
				}, saving ? "保存中…" : "保存"), (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: cancelEdit,
					disabled: saving
				}, "取消"), editErr ? (0, react.createElement)("span", { style: {
					color: "#ff9d9d",
					fontSize: 11
				} }, editErr) : null)), polishWarn ? (0, react.createElement)("div", { style: {
					color: "#ffd27f",
					fontSize: 12,
					padding: "6px 0"
				} }, polishWarn) : null, (0, react.createElement)("textarea", {
					className: "nw-inp",
					style: {
						minHeight: "55vh",
						lineHeight: 1.9,
						fontFamily: "ui-monospace, monospace"
					},
					value: String(draft.content ?? ""),
					onChange: (e) => setDraft({
						...draft,
						content: e.target.value
					})
				})) : (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "nw-editbar" }, (0, react.createElement)("span", null, `${rec ? "第" + rec.order + "章 " + rec.title + " · " + rec.wordCount + "字" : ""}${rec && volTitle(rec.volumeId) ? " · " + volTitle(rec.volumeId) : ""}`), (0, react.createElement)("div", { className: "nw-acts" }, rec ? (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => setPolishUI(!polishUI)
				}, polishUI ? "收起" : "AI 润色") : null, rec ? (0, react.createElement)("button", {
					className: "nw-btn-sm",
					onClick: () => beginEdit("chapter", rec, { content })
				}, "编辑正文") : null)), polishUI ? (0, react.createElement)("div", {
					className: "nw-form",
					style: {
						marginTop: 0,
						marginBottom: 10
					}
				}, (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("label", null, "模式"), (0, react.createElement)("select", {
					value: polishMode,
					onChange: (e) => setPolishMode(e.target.value)
				}, [["light", "轻度修正（只修硬伤，不扩写）"], ["deep", "深度润色（增强表现力，可适度扩写）"]].map(([v, l]) => (0, react.createElement)("option", {
					key: v,
					value: v
				}, l)))), (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("label", null, "方向"), (0, react.createElement)("input", {
					className: "nw-inp",
					style: { flex: 1 },
					value: polishFocus,
					onChange: (e) => setPolishFocus(e.target.value),
					placeholder: "可选：如「对话更口语化」「动作描写更细致」"
				})), (0, react.createElement)("div", { className: "row" }, (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void doPolish(),
					disabled: polishBusy || !content
				}, polishBusy ? "润色中（可能需要几分钟）…" : "生成润色稿"), (0, react.createElement)("span", { className: "nw-fs" }, "润色稿会进入编辑框，确认后再保存；保存前原文自动备份"))) : null, err ? (0, react.createElement)("div", { className: "nw-empty" }, `加载失败: ${err}`) : content ? (0, react.createElement)("div", { className: "nw-content" }, content) : (0, react.createElement)("div", { className: "nw-empty" }, "加载中…"))));
			};
			/** 导出 tab：生成 md/txt/epub 并列出可下载文件 */
			/** 统一资产注册表：立绘/插画/地图/配音按类型分组，可切换「当前版本」 */
			const renderAssets = () => {
				if (assetErr && assets.length === 0) return (0, react.createElement)("div", { className: "nw-empty" }, `资产加载失败：${assetErr}`);
				const list = assetKind ? assets.filter((a) => a.kind === assetKind) : assets;
				const countOf = (k) => assets.filter((a) => a.kind === k).length;
				return (0, react.createElement)("div", null, (0, react.createElement)("div", { className: "nw-sec" }, `项目资产（${assets.length}）`), (0, react.createElement)("div", { className: "nw-bar" }, (0, react.createElement)("select", {
					value: assetKind,
					onChange: (e) => setAssetKind(e.target.value)
				}, (0, react.createElement)("option", { value: "" }, "全部类型"), Object.entries(ASSET_KIND_LABEL).map(([k, l]) => (0, react.createElement)("option", {
					key: k,
					value: k
				}, `${l}（${countOf(k)}）`))), (0, react.createElement)("button", { onClick: () => void loadAssets() }, "刷新"), (0, react.createElement)("span", { className: "nw-fs" }, `立绘 ${countOf("portrait")} · 插画 ${countOf("illustration")} · 地图 ${countOf("map")} · 配音 ${countOf("voice")}`)), assetErr ? (0, react.createElement)("div", {
					className: "nw-fs",
					style: { color: "#e08" }
				}, assetErr) : null, list.length === 0 ? (0, react.createElement)("div", { className: "nw-empty" }, "暂无登记资产。在立绘/插画/地图/配音面板生成后会自动登记到当前项目；也可由 AI 调 /assets 端点登记。") : (0, react.createElement)("div", { className: "nw-assets" }, list.map((a) => {
					const v = a.versions[a.currentVersion] ?? a.versions[a.versions.length - 1];
					return (0, react.createElement)("div", {
						key: a.id,
						className: "nw-card nw-asset"
					}, a.kind === "voice" ? (0, react.createElement)("div", { className: "nw-fs" }, `🔊 ${v?.file ? v.file.split(/[\\/]/).pop() : "音频"}`) : v?.url ? (0, react.createElement)("img", {
						className: "nw-asset-img nw-asset-img--" + a.kind,
						src: v.url,
						title: v.prompt ?? a.title,
						onClick: () => window.open(v.url, "_blank")
					}) : (0, react.createElement)("div", { className: "nw-empty" }, "（无预览）"), (0, react.createElement)("div", { className: "nw-asset-cap" }, (0, react.createElement)("b", null, a.title), (0, react.createElement)("span", { className: "nw-badge" }, ASSET_KIND_LABEL[a.kind] ?? a.kind), a.characterName ? (0, react.createElement)("span", { className: "nw-fs" }, a.characterName) : null), (0, react.createElement)("div", { className: "nw-fs" }, `${a.versions.length} 个版本 · ${a.updatedAt.slice(0, 16).replace("T", " ")} · ${a.source.replace("dsh-", "")}`), a.versions.length > 1 ? (0, react.createElement)("div", { className: "nw-acts" }, a.versions.map((_vv, i) => (0, react.createElement)("button", {
						key: i,
						className: "nw-btn-sm" + (i === a.currentVersion ? " on" : ""),
						disabled: assetBusy === a.id,
						onClick: () => void setAssetCurrent(a, i)
					}, `v${i + 1}`))) : null, (0, react.createElement)("div", { className: "nw-acts" }, v?.prompt ? (0, react.createElement)("button", {
						className: "nw-btn-sm",
						onClick: () => {
							try {
								navigator.clipboard.writeText(v.prompt ?? "");
							} catch {}
						}
					}, "复制 prompt") : null, (0, react.createElement)("button", {
						className: "nw-btn-sm danger",
						onClick: () => void removeAsset(a)
					}, "取消登记")));
				})));
			};
			const renderExport = () => {
				const d = data;
				const download = (f) => `/@dsh-external/dsh-novel-writer/api/projects/${currentId}/export/${encodeURIComponent(f)}`;
				return (0, react.createElement)("div", {
					className: "nw-imp",
					style: { maxWidth: 720 }
				}, (0, react.createElement)("div", { className: "nw-sec" }, "导出整本小说"), (0, react.createElement)("div", { className: "nw-hint" }, `《${d.project.name}》按大纲卷/章顺序导出（${d.chapters.length} 章）。EPUB 含目录与分卷；TXT 为纯文本；Markdown 保留标题层级。文件写入项目 exports/ 目录，可从下方下载。`), (0, react.createElement)("div", {
					className: "nw-acts",
					style: { marginTop: 8 }
				}, (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void doExport("markdown"),
					disabled: !!expBusy
				}, expBusy === "markdown" ? "导出中…" : "导出 Markdown"), (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void doExport("txt"),
					disabled: !!expBusy
				}, expBusy === "txt" ? "导出中…" : "导出 TXT"), (0, react.createElement)("button", {
					className: "nw-btn-sm primary",
					onClick: () => void doExport("epub"),
					disabled: !!expBusy
				}, expBusy === "epub" ? "导出中…" : "导出 EPUB")), expMsg ? (0, react.createElement)("div", { className: "nw-res" }, (0, react.createElement)("pre", null, expMsg)) : null, (0, react.createElement)("div", { className: "nw-sec" }, `导出文件（${expFiles.length}）`), expFiles.length === 0 ? (0, react.createElement)("div", { className: "nw-empty" }, "还没有导出文件") : (0, react.createElement)("div", null, expFiles.map((f) => (0, react.createElement)("div", {
					key: f.file,
					className: "nw-card",
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8
					}
				}, (0, react.createElement)("span", { className: "grow" }, f.file), (0, react.createElement)("span", { className: "nw-fs" }, `${Math.max(1, Math.round(f.size / 1024))}KB · ${f.mtime.slice(0, 16).replace("T", " ")}`), (0, react.createElement)("a", {
					href: download(f.file),
					className: "nw-btn-sm",
					target: "_blank",
					rel: "noreferrer"
				}, "下载")))));
			};
			if (projects.length === 0) return (0, react.createElement)("div", { className: "nw-root" }, (0, react.createElement)("div", { className: "nw-empty" }, "暂无项目。让 AI 助手用 novel_project_create 创建第一个小说项目。"));
			const p = projects.find((x) => x.id === currentId) ?? projects[0];
			let body;
			if (!data) body = (0, react.createElement)("div", { className: "nw-empty" }, "加载中…");
			else if (tab === "outline") body = renderOutline();
			else if (tab === "characters") body = renderCharacters();
			else if (tab === "worldview") body = renderWorldview();
			else if (tab === "geo") body = renderGeo();
			else if (tab === "items") body = renderItems();
			else if (tab === "style") body = renderStyle();
			else if (tab === "maps") body = renderMaps();
			else if (tab === "assets") body = renderAssets();
			else if (tab === "memory") body = (0, react.createElement)("div", { dangerouslySetInnerHTML: { __html: memoryHtml(data) } });
			else if (tab === "export") body = renderExport();
			else if (tab === "import") body = (0, react.createElement)("div", { className: "nw-imp" }, (0, react.createElement)("label", null, "设定文件路径（每行一个；支持文件或目录，目录递归读取 .md / .txt / .json / .yaml）"), (0, react.createElement)("textarea", {
				className: "nw-inp",
				style: {
					minHeight: 76,
					resize: "vertical",
					fontFamily: "ui-monospace, monospace"
				},
				value: impPath,
				onChange: (e) => setImpPath(e.target.value),
				placeholder: "F:\\设定\\世界观.md\nF:\\设定\\人物\\\nF:\\老文档\\角色设定.txt（GBK）"
			}), (0, react.createElement)("div", { className: "nw-imp-row" }, (0, react.createElement)("label", null, "解析模式"), (0, react.createElement)("select", {
				value: impMode,
				onChange: (e) => setImpMode(e.target.value)
			}, [
				["auto", "auto（全部）"],
				["worldview", "worldview（世界观）"],
				["characters", "characters（人物）"],
				["outline", "outline（大纲）"],
				["foreshadowing", "foreshadowing（伏笔）"]
			].map(([v, l]) => (0, react.createElement)("option", {
				key: v,
				value: v
			}, l))), (0, react.createElement)("label", null, "编码"), (0, react.createElement)("select", {
				value: impEncoding,
				onChange: (e) => setImpEncoding(e.target.value)
			}, [["utf-8", "UTF-8"], ["gbk", "GBK（老文档）"]].map(([v, l]) => (0, react.createElement)("option", {
				key: v,
				value: v
			}, l))), (0, react.createElement)("label", { className: "nw-chk" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: impDry,
				onChange: (e) => setImpDry(e.target.checked)
			}), "仅预览（不写入）")), (0, react.createElement)("button", {
				className: "nw-btn",
				onClick: () => void doImport(),
				disabled: impBusy
			}, impBusy ? "AI 解析中…" : impDry ? "AI 解析预览" : "确认导入"), impResult ? (0, react.createElement)("div", { className: "nw-res" }, (0, react.createElement)("pre", null, impResult)) : (0, react.createElement)("div", { className: "nw-hint" }, "AI 会把设定文档解析为结构化世界观/人物/大纲/伏笔并导入当前项目（同名条目自动跳过，可重复执行）。建议先勾选「仅预览」查看解析质量，再取消勾选正式导入。超过 2 万字符的超长文档会自动分块（每块约 1.5 万字符）并调用云端大模型解析，全程免手动拆文件。"));
			else body = renderChapters();
			return (0, react.createElement)("div", { className: "nw-root" }, (0, react.createElement)("div", { className: "nw-bar" }, (0, react.createElement)("select", {
				value: p.id,
				onChange: (e) => pickProject(e.target.value)
			}, projects.map((x) => (0, react.createElement)("option", {
				key: x.id,
				value: x.id
			}, x.name))), (0, react.createElement)("button", { onClick: () => void refresh() }, "刷新"), (0, react.createElement)("span", { style: {
				fontSize: 11,
				opacity: .65
			} }, `${p.genre} · 章节 ${p.chaptersWritten} · 人物 ${p.characters} · 未解伏笔 ${p.openForeshadowings}`)), expMsg ? (0, react.createElement)("div", {
				className: "nw-meta",
				style: {
					color: "#9d8ff5",
					display: "flex",
					gap: 8,
					alignItems: "center"
				}
			}, (0, react.createElement)("span", { style: { flex: 1 } }, expMsg), (0, react.createElement)("button", {
				className: "nw-btn-sm",
				onClick: () => setExpMsg("")
			}, "关闭")) : null, p.premise ? (0, react.createElement)("div", { className: "nw-meta" }, p.premise) : null, (0, react.createElement)("div", { className: "nw-tabs" }, TABS.map(([k, l]) => (0, react.createElement)("div", {
				key: k,
				className: "nw-tab" + (tab === k ? " on" : ""),
				onClick: () => setTab(k)
			}, l))), body);
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "@dsh-external/dsh-novel-writer-panel",
				order: 40,
				label: () => "小说工坊"
			}, NovelPanel)), "@dsh-external/dsh-novel-writer: panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map