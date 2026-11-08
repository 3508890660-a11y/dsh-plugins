/* eslint-disable */
// ⚠️ 自动生成，请勿直接修改。
// 源文件：shared/dsh-workbench-kit/src/ui-kit.ts
// 同步命令：node tools/sync-workbench-kit.mjs
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
const ROOTS = ':where(.nw-root, .dl-root, .mf-root, .ci-root, .cm-root, .dub-root)';
export const WB_KIT_CSS = `
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
//# sourceMappingURL=ui-kit.js.map