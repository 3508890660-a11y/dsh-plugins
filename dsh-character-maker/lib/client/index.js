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
import { createElement as h, useEffect, useState, useRef, useMemo } from 'react';
import { WB_KIT_CSS } from './ui-kit.js';
import { readContext, setProjectContext, useWorkbenchContext } from './workbench-context.js';
export const inject = ['slots'];
const PANEL_ID = 'dsh-character-maker';
const API = '/@dsh-external/dsh-character-maker/api';
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
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const ROLE_LABEL = { protagonist: '主角', supporting: '配角', antagonist: '反派', minor: '路人' };
const NODE_FILL = { 0: '#7c6cf0', 1: '#4a90d9', 2: '#e05656', 3: '#667', 4: '#888' };
const STANCE_COLOR = [
    [/敌|仇|对立|宿敌|情敌/i, '#e05656'], [/利用|支配|臣服|依附/i, '#e0a24a'],
    [/恋|暧昧|亲近|亲密|爱|依恋/i, '#e07bd0'], [/盟友|同盟|伙伴|合作|恩|师生|师徒|血亲|挚友|知交/i, '#4ab07a'],
    [/复杂|纠缠/i, '#b08ae0'], [/敬畏|惧|戒备|疏远/i, '#7f8ca3'],
];
function stanceColor(s) {
    for (const [re, c] of STANCE_COLOR)
        if (re.test(String(s)))
            return c;
    return '#888';
}
/** 简单 force-directed 布局：返回 {id:{x,y}} */
function layoutGraph(nodes, edges) {
    const W = 760, H = 520;
    const pos = {};
    const vel = {};
    const n = nodes.length;
    nodes.forEach((nd, i) => {
        const ang = (i / Math.max(1, n)) * Math.PI * 2;
        pos[nd.id] = { x: W / 2 + Math.cos(ang) * Math.min(W, H) * 0.38, y: H / 2 + Math.sin(ang) * Math.min(W, H) * 0.38 };
        vel[nd.id] = { x: 0, y: 0 };
    });
    const R = 3200, K = 0.02, C = 0.012;
    // §8.13：按节点规模自适应迭代次数（原来固定 90 轮 × O(n²)，大图同步执行会卡住主线程）
    const iterations = n > 80 ? 24 : n > 40 ? 45 : n > 20 ? 70 : 90;
    for (let iter = 0; iter < iterations; iter++) {
        nodes.forEach(a => {
            nodes.forEach(b => {
                if (a.id === b.id)
                    return;
                const dx = pos[a.id].x - pos[b.id].x, dy = pos[a.id].y - pos[b.id].y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 1)
                    d2 = 1;
                const f = R / d2;
                const d = Math.sqrt(d2);
                vel[a.id].x += (dx / d) * f;
                vel[a.id].y += (dy / d) * f;
            });
            vel[a.id].x += (W / 2 - pos[a.id].x) * C;
            vel[a.id].y += (H / 2 - pos[a.id].y) * C;
        });
        edges.forEach(e => {
            const a = pos[e.source], b = pos[e.target];
            if (!a || !b)
                return;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const f = K * (d - 140);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            vel[e.source].x += fx;
            vel[e.source].y += fy;
            vel[e.target].x -= fx;
            vel[e.target].y -= fy;
        });
        nodes.forEach(nd => {
            vel[nd.id].x *= 0.85;
            vel[nd.id].y *= 0.85;
            pos[nd.id].x += vel[nd.id].x;
            pos[nd.id].y += vel[nd.id].y;
        });
    }
    return pos;
}
function CharacterPanel() {
    const [tab, setTab] = useState('local');
    const [locals, setLocals] = useState([]);
    const [projects, setProjects] = useState([]);
    const [projId, setProjId] = useState('');
    const [novelChars, setNovelChars] = useState([]);
    const [expanded, setExpanded] = useState('');
    const [cardMap, setCardMap] = useState({});
    const [analyzing, setAnalyzing] = useState('');
    const [analyzeMap, setAnalyzeMap] = useState({});
    // ── 关系网状态 ──
    const [netScope, setNetScope] = useState(''); // '' = 本地/全场
    const [graph, setGraph] = useState({ nodes: [], edges: [] });
    const [interactions, setInteractions] = useState([]);
    const [selNode, setSelNode] = useState('');
    const [edgeDetail, setEdgeDetail] = useState(null);
    const [netBusy, setNetBusy] = useState(''); // '' | 'analyzing' | 'analyze-all'
    const [netMsg, setNetMsg] = useState('');
    const [form, setForm] = useState({ a: '', b: '', type: '盟友', stance: '复杂', weight: 5, summary: '' });
    // ── 同步状态（revision 轮询） ──
    const [syncedAt, setSyncedAt] = useState('');
    const lastRev = useRef(-1);
    const netScopeRef = useRef('');
    // ── 跨面板共享上下文（当前项目） ──
    const [sharedCtx] = useWorkbenchContext(PANEL_ID);
    const sharedRef = useRef(sharedCtx);
    // ── §8.13 问卷作答状态 ──
    const [qBanks, setQBanks] = useState([]);
    const [qKind, setQKind] = useState('');
    const [qQuestions, setQQuestions] = useState([]);
    const [qAnswers, setQAnswers] = useState({});
    const [qCharId, setQCharId] = useState('');
    const [qBusy, setQBusy] = useState(false);
    const [qResult, setQResult] = useState('');
    const [qMsg, setQMsg] = useState('');
    const [qPage, setQPage] = useState({ from: 1, size: 20 });
    const [qHistory, setQHistory] = useState([]);
    const [qRecord, setQRecord] = useState(null);
    const api = async (path, opts) => {
        const res = await fetch(API + path, opts);
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false)
            throw new Error(j?.error ?? 'HTTP ' + res.status);
        return j;
    };
    const refreshLocal = () => {
        api('/characters').then(j => setLocals(Array.isArray(j.characters) ? j.characters : [])).catch(() => setLocals([]));
    };
    const refreshProjects = () => {
        api('/novel-projects').then(j => {
            const list = Array.isArray(j.projects) ? j.projects : [];
            setProjects(list);
            // 沿用其他面板（小说/插画/地图/立绘）的当前项目；本面板已选则保持不变
            const want = readContext().projectId;
            if (want && list.some(p => p.id === want)) {
                setProjId(prev => (prev && list.some(p => p.id === prev) ? prev : want));
            }
        }).catch(() => setProjects([]));
    };
    const loadChars = (id) => {
        if (!id) {
            setNovelChars([]);
            return;
        }
        api('/novel-characters?projectId=' + encodeURIComponent(id))
            .then(j => setNovelChars(Array.isArray(j.characters) ? j.characters : []))
            .catch(() => setNovelChars([]));
    };
    const refreshNet = async (scope) => {
        const g = await api('/relationship-graph' + (scope ? '?projectId=' + encodeURIComponent(scope) : ''));
        const it = await api('/interactions' + (scope ? '?projectId=' + encodeURIComponent(scope) : ''));
        setGraph(g.graph ?? { nodes: [], edges: [] });
        setInteractions(Array.isArray(it.interactions) ? it.interactions : []);
        // 若当前选中的边已不在列表，清空细节
        setEdgeDetail(prev => (prev && it.interactions.some((x) => x.id === prev.id) ? prev : null));
    };
    // ── §8.13 问卷作答：加载题库/题目/历史，提交计分 ──
    const loadBanks = () => {
        api('/quiz-banks').then(j => setQBanks(Array.isArray(j.banks) ? j.banks : [])).catch(() => setQBanks([]));
    };
    const loadQuestions = async (kind, page) => {
        if (!kind) {
            setQQuestions([]);
            return;
        }
        const p = page ?? qPage;
        setQMsg('载入题目…');
        try {
            const j = await api(`/quiz-questions?kind=${encodeURIComponent(kind)}&from=${p.from}&to=${p.from + p.size - 1}`);
            setQQuestions(Array.isArray(j.items) ? j.items : []);
            setQMsg(`已载入第 ${p.from}-${p.from + (j.items?.length ?? 1) - 1} 题 / 共 ${j.total} 题`);
        }
        catch (e) {
            setQQuestions([]);
            setQMsg('❌ ' + String(e).slice(0, 160));
        }
    };
    const loadHistory = () => {
        api('/quiz-history?limit=50').then(j => setQHistory(Array.isArray(j.records) ? j.records : [])).catch(() => setQHistory([]));
    };
    const submitQuiz = async (allowPartial) => {
        if (!qKind) {
            setQMsg('请先选择问卷');
            return;
        }
        setQBusy(true);
        setQResult('');
        setQMsg('计分中…');
        try {
            const j = await api('/quiz-score', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ kind: qKind, answers: qAnswers, characterId: qCharId || undefined, allowPartial }),
            });
            setQResult(`${j.summary}\n\n${j.detail}`);
            setQMsg(`✅ 已计分（记录 ${j.recordId}）`);
            loadHistory();
            refreshLocal();
        }
        catch (e) {
            setQMsg('❌ ' + String(e).slice(0, 300));
        }
        finally {
            setQBusy(false);
        }
    };
    const openRecord = async (id) => {
        try {
            const j = await api('/quiz-record?id=' + encodeURIComponent(id));
            setQRecord(j.record ?? null);
        }
        catch {
            setQRecord(null);
        }
    };
    // ── 展开角色卡（本地） ──
    const toggleCard = async (cid) => {
        const key = 'local-' + cid;
        if (expanded === key) {
            setExpanded('');
            return;
        }
        setExpanded(key);
        if (cardMap[cid])
            return;
        try {
            const r = await api('/card?id=' + encodeURIComponent(cid));
            setCardMap(m => ({ ...m, [cid]: r.card ?? '（无卡片）' }));
        }
        catch (e) {
            setCardMap(m => ({ ...m, [cid]: '角色卡载入失败: ' + String(e).slice(0, 160) }));
        }
    };
    // ── 生成六节详析 ──
    const doAnalyze = async (pid, cid) => {
        setAnalyzing(cid);
        setAnalyzeMap(m => ({ ...m, [cid]: '生成中（需几十秒，LLM 深度画像）…' }));
        try {
            const r = await api('/analyze', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectId: pid, characterId: cid, depth: 'standard', persist: true }),
            });
            setAnalyzeMap(m => ({ ...m, [cid]: r.card ?? r.narrative ?? '生成完成' }));
            setNovelChars(prev => prev.map(c => c.id === cid ? { ...c, personalityProfile: r.narrative } : c));
        }
        catch (e) {
            setAnalyzeMap(m => ({ ...m, [cid]: '❌ ' + String(e).slice(0, 200) }));
        }
        finally {
            setAnalyzing('');
        }
    };
    // ── revision 轮询同步（3s）：任何 server 侧写操作都会 bump revision，这里自动整包刷新 ──
    useEffect(() => { netScopeRef.current = netScope; }, [netScope]);
    useEffect(() => {
        let alive = true;
        const tick = async () => {
            try {
                const j = await api('/revision' + (netScopeRef.current ? '?projectId=' + encodeURIComponent(netScopeRef.current) : ''));
                if (!alive)
                    return;
                if (lastRev.current < 0)
                    lastRev.current = j.revision ?? 0;
                if ((j.revision ?? 0) !== lastRev.current) {
                    lastRev.current = j.revision ?? 0;
                    setSyncedAt(new Date().toLocaleTimeString());
                    // 轻量数据优先刷新
                    refreshLocal();
                    refreshProjects();
                    if (netScopeRef.current !== null)
                        refreshNet(netScopeRef.current).catch(() => { });
                }
            }
            catch { /* server 未就绪时静默 */ }
        };
        tick();
        const iv = setInterval(tick, 3000);
        return () => { alive = false; clearInterval(iv); };
    }, []);
    useEffect(() => { refreshLocal(); refreshProjects(); loadBanks(); loadHistory(); }, []);
    useEffect(() => { loadChars(projId); }, [projId]);
    useEffect(() => { refreshNet(netScope).catch(() => { }); }, [netScope]);
    // 广播项目选择；跟随其他面板切换（关系网范围同步过去，'' 保留「全场」语义）
    useEffect(() => { if (projId)
        setProjectContext(projId, PANEL_ID); }, [projId]);
    useEffect(() => {
        const prev = sharedRef.current;
        sharedRef.current = sharedCtx;
        if (!prev || !sharedCtx.updatedAt || sharedCtx.updatedAt === prev.updatedAt)
            return;
        if (sharedCtx.source === PANEL_ID)
            return;
        if (!sharedCtx.projectId || sharedCtx.projectId === projId)
            return;
        if (projects.length > 0 && !projects.some(p => p.id === sharedCtx.projectId))
            return;
        setProjId(sharedCtx.projectId);
        setNetScope(sharedCtx.projectId);
    }, [sharedCtx, projId, projects]);
    const selectedNode = graph.nodes.find(nd => nd.id === selNode);
    const nodeEdges = selectedNode
        ? interactions.filter(it => it.aKey === selNode || it.bKey === selNode)
        : [];
    const openEdge = async (id) => {
        setSelNode('');
        const j = await api('/interaction?id=' + encodeURIComponent(id)).catch(() => null);
        const found = j?.interaction ?? interactions.find(x => x.id === id) ?? null;
        setEdgeDetail(found);
    };
    const toggleSelNode = (id) => {
        setSelNode(prev => (prev === id ? '' : id));
        setEdgeDetail(null);
    };
    // ── 互动分析（单条） ──
    const runAnalyze = async (a, b, scope) => {
        setNetBusy('analyzing');
        setNetMsg(`分析 ${a} ↔ ${b}…`);
        try {
            const r = await api('/interactions/analyze', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ a, b, projectId: scope || undefined, persist: true }),
            });
            setNetMsg('分析完成，网络已同步。');
            await refreshNet(scope);
            if (r.savedId) {
                setEdgeDetail(r);
                void openEdge(r.savedId);
            }
        }
        catch (e) {
            setNetMsg('❌ ' + String(e).slice(0, 160));
        }
        finally {
            setNetBusy('');
        }
    };
    // ── 一键全项目分析 ──
    const runAnalyzeAll = async (scope) => {
        setNetBusy('analyze-all');
        setNetMsg('正在批量分析所有角色两两互动（需数分钟，会逐对调用 LLM）…');
        try {
            const r = await api('/interactions/analyze-all', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ projectId: scope || undefined, persist: true, force: false, maxPairs: 20 }),
            });
            setNetMsg(`✅ 本次新增分析 ${r.count ?? 0} 对互动${r.failed ? `（${r.failed} 对失败）` : ''}。`);
            await refreshNet(scope);
        }
        catch (e) {
            setNetMsg('❌ ' + String(e).slice(0, 160));
        }
        finally {
            setNetBusy('');
        }
    };
    // ── 删除互动（服务端只接受 POST/DELETE；GET 会 405）──
    const deleteEdge = async (id) => {
        if (!window.confirm('删除这条互动记录？此操作不可恢复。'))
            return;
        try {
            await api('/interactions/delete?id=' + encodeURIComponent(id), { method: 'DELETE' });
            setEdgeDetail(null);
            setNetMsg('已删除互动。');
            await refreshNet(netScope);
        }
        catch (e) {
            setNetMsg('❌ ' + String(e).slice(0, 120));
        }
    };
    // ── 新增互动（表单） ──
    const submitAdd = async () => {
        if (!form.a.trim() || !form.b.trim()) {
            setNetMsg('请填写角色 A 与 B。');
            return;
        }
        setNetBusy('add');
        try {
            await api('/interactions', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...form, weight: Number(form.weight) || 5, projectId: netScope || undefined }),
            });
            setForm({ a: '', b: '', type: '盟友', stance: '复杂', weight: 5, summary: '' });
            setNetMsg('已登记互动。');
            await refreshNet(netScope);
        }
        catch (e) {
            setNetMsg('❌ ' + String(e).slice(0, 120));
        }
        finally {
            setNetBusy('');
        }
    };
    // ── 本地角色 tab ──
    const renderLocal = () => {
        if (locals.length === 0)
            return h('div', { className: 'cm-empty' }, '暂无本地角色。让 AI 助手用 character_new / character_profile 创建。');
        return h('div', null, locals.map((c) => {
            const isOpen = expanded === 'local-' + c.id;
            const en = c.enneagram ?? {};
            const badge = [
                en.core ? `${en.core}号` : '', en.wing ? en.wing : '', en.wingNick ? en.wingNick : '',
                c.mbti ? c.mbti : '', en.subtypeLabel ? en.subtypeLabel : '', en.levelBand ? en.levelBand + '档' : '',
            ].filter(Boolean);
            return h('div', { key: c.id, className: 'cm-card' }, h('h4', null, h('span', { className: 'grow' }, c.name, h('span', { className: 'cm-badge' }, ROLE_LABEL[c.role] ?? c.role)), c.source ? h('span', { className: 'cm-tag' }, '← novel') : null, badge.slice(0, 5).map((b, i) => h('span', { key: i, className: 'cm-badge' }, b))), c.goal ? h('div', { className: 'cm-sub' }, `目标：${c.goal}`) : null, h('div', { className: 'cm-acts' }, h('button', { className: 'cm-btn', onClick: () => void toggleCard(c.id) }, isOpen ? '收起' : '展开角色卡')), isOpen
                ? h('div', { className: 'cm-line', style: { marginTop: 6 } }, cardMap[c.id] ?? '载入角色卡…')
                : null);
        }));
    };
    // ── novel-writer 联动 tab ──
    const renderNovel = () => {
        if (projects.length === 0)
            return h('div', { className: 'cm-empty' }, '未发现 novel-writer 项目（需 dsh-novel-writer 运行且有项目）。');
        return h('div', null, h('div', { className: 'cm-probar' }, h('select', { value: projId, onChange: (e) => setProjId(e.target.value) }, h('option', { value: '', disabled: true }, '选择项目…'), projects.map(p => h('option', { key: p.id, value: p.id }, `${p.name}（${p.genre} · 人物${p.characterCount}）`)))), h('div', { className: 'cm-note' }, '从小说项目拉取人物，点击「生成角色详析」即可产出完整角色卡（九型内核 + MBTI 解析 + 大五解析 + 六节深度画像），并自动写回 novel-writer 的 personalityProfile。若角色尚无 MBTI / 大五数据，AI 会依其资料模拟作答这两项测试（标注「AI 推断」）；已跑过问卷的以实测数据为准。'), !projId || novelChars.length === 0
            ? h('div', { className: 'cm-empty' }, !projId ? '请选择上方项目' : '该项目暂无人物档案')
            : novelChars.map((c) => {
                const isOpen = expanded === 'novel-' + c.id;
                const note = analyzeMap[c.id];
                const showing = note ? note : isOpen ? (c.personalityProfile ?? '（尚无角色详析，点击按钮生成）') : '';
                return h('div', { key: c.id, className: 'cm-novelcard' }, h('h4', null, h('span', { className: 'grow' }, c.name), h('span', { className: 'cm-badge' }, ROLE_LABEL[c.role] ?? c.role), c.personalityProfile ? h('span', { className: 'cm-tag' }, '✓有详析') : h('span', { className: 'cm-tag' }, '待生成')), c.goal ? h('div', { className: 'cm-sub' }, `目标：${c.goal}`) : null, h('div', { className: 'cm-acts' }, h('button', { className: 'cm-btn primary', onClick: () => void doAnalyze(projId, c.id), disabled: analyzing === c.id }, analyzing === c.id ? '生成中…' : '⚡ 生成角色详析'), h('button', { className: 'cm-btn', onClick: () => setExpanded(isOpen ? '' : 'novel-' + c.id) }, isOpen || note ? '收起' : '查看已有')), showing ? h('div', { className: 'cm-line', style: { marginTop: 6 } }, showing) : null);
            }));
    };
    // ── 关系网 tab（SVG 力导向图 + 详情/表单） ──
    const positions = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
    const svgChildren = [];
    // defs: 箭头 marker
    svgChildren.push(h('defs', { key: 'd' }, h('marker', {
        id: 'cm-arrow', viewBox: '0 0 8 8', refX: 8, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
    }, h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: '#888' }))));
    for (const e of graph.edges) {
        const a = positions[e.source], b = positions[e.target];
        if (!a || !b)
            continue;
        const c = stanceColor(e.stance);
        const w = 1 + Math.min(3.5, (e.weight || 5) / 3);
        // 方向决定箭头落点
        let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, arrow = false;
        if (e.direction === 'a->b') {
            x1 = a.x;
            y1 = a.y;
            x2 = b.x;
            y2 = b.y;
            arrow = true;
        }
        else if (e.direction === 'b->a') {
            x1 = b.x;
            y1 = b.y;
            x2 = a.x;
            y2 = a.y;
            arrow = true;
        }
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2 - 8;
        svgChildren.push(h('line', {
            key: 'e' + e.id, x1, y1, x2, y2, stroke: c, strokeWidth: w, strokeOpacity: .85,
            strokeDasharray: e.direction === 'a<->b' ? '4 3' : undefined,
            markerEnd: arrow ? 'url(#cm-arrow)' : undefined,
            className: 'cm-edge-tip',
            onMouseEnter: () => openEdge(e.id),
            onClick: () => openEdge(e.id),
        }));
        if (e.type) {
            svgChildren.push(h('text', {
                key: 't' + e.id, x: midX, y: midY, fill: c, fontSize: 10, textAnchor: 'middle', opacity: .9,
                style: { pointerEvents: 'none', userSelect: 'none' },
            }, String(e.type).slice(0, 6)));
        }
    }
    for (const nd of graph.nodes) {
        const p = positions[nd.id];
        if (!p)
            continue;
        const fill = NODE_FILL[nd.group ?? 4] ?? '#888';
        const active = selNode === nd.id || edgeDetail && (edgeDetail.aKey === nd.id || edgeDetail.bKey === nd.id);
        const label = nodesLabel(nd.name);
        svgChildren.push(h('circle', {
            key: 'n' + nd.id, cx: p.x, cy: p.y, r: active ? 17 : 14, fill, stroke: active ? '#fff' : '#fff3', strokeWidth: active ? 2.5 : 1,
            className: 'cm-edge-tip', onClick: (ev) => { ev.stopPropagation(); toggleSelNode(nd.id); },
        }), h('text', { key: 'nl' + nd.id, x: p.x, y: p.y + 27, fill: '#ddd', fontSize: 10.5, textAnchor: 'middle', style: { pointerEvents: 'none' } }, label));
    }
    const renderNet = () => {
        const selectedIt = edgeDetail;
        return h('div', { className: 'cm-net' }, h('div', { className: 'cm-probar', style: { width: '100%' } }, h('select', {
            value: netScope, onChange: (e) => setNetScope(e.target.value),
            style: { minWidth: 200 },
        }, h('option', { value: '' }, '本地角色 / 全场'), projects.map(p => h('option', { key: p.id, value: p.id }, p.name))), h('button', { className: 'cm-btn', onClick: () => refreshNet(netScope).catch(() => { }) }, '重算布局'), h('button', {
            className: 'cm-btn primary', disabled: netBusy !== '', onClick: () => void runAnalyzeAll(netScope),
        }, netBusy === 'analyze-all' ? '批量分析中…' : '⚡ 一键全项目互动分析'), h('button', { className: 'cm-btn', onClick: () => { setSelNode(''); setEdgeDetail(null); setNetMsg(''); } }, '清空选择')), h('div', { className: 'cm-graph' }, graph.nodes.length === 0
            ? h('div', { className: 'cm-empty' }, '暂无数据。请先创建角色，或点击「一键全项目互动分析」生成关系网。')
            : h('svg', { viewBox: '0 0 760 520' }, ...svgChildren), h('div', { className: 'cm-legend' }, h('span', null, h('span', { className: 'sw', style: { background: '#7c6cf0' } }), '主角'), h('span', null, h('span', { className: 'sw', style: { background: '#4a90d9' } }), '配角'), h('span', null, h('span', { className: 'sw', style: { background: '#e05656' } }), '反派'), h('span', null, h('span', { className: 'sw', style: { background: '#4ab07a' } }), '亲和/同盟'), h('span', null, h('span', { className: 'sw', style: { background: '#e0a24a' } }), '利用/支配'), h('span', null, '实线=单向(带箭头) · 虚线=双向对等 ｜ 悬停连线看互动')), netMsg ? h('div', { className: 'cm-note', style: { color: '#9d8ff5' } }, netMsg) : null), h('div', { className: 'cm-detail' }, 
        // 节点详情
        selectedNode
            ? h('div', { className: 'cm-card' }, h('h4', null, h('span', { className: 'grow' }, selectedNode.name), h('span', { className: 'cm-badge' }, ROLE_LABEL[selectedNode.role ?? ''] ?? selectedNode.role ?? ''), selectedNode.core ? h('span', { className: 'cm-badge' }, `${selectedNode.core}号` + (selectedNode.coreName ? ` ${selectedNode.coreName}` : '')) : null), h('div', { className: 'cm-sub' }, nodeEdges.length ? `参与 ${nodeEdges.length} 组互动：` : '该角色暂无登记互动。'), nodeEdges.map(it => {
                const other = it.aKey === selNode ? it.bName : it.aName;
                const st = it.type ? it.type : '互动';
                return h('div', { key: it.id, className: 'cm-acts' }, h('button', { className: 'cm-btn', onClick: () => void openEdge(it.id) }, `${st}${it.stance ? '(' + it.stance + ')' : ''} ↔ ${other}`));
            }))
            : null, 
        // 边详情（互动深析）
        selectedIt && !selectedNode
            ? h('div', { className: 'cm-card' }, h('h4', null, h('span', { className: 'grow' }, `${selectedIt.aName} ↔ ${selectedIt.bName}`)), h('div', null, h('span', { className: 'cm-tag' }, `类型：${selectedIt.type || '互动'}`), h('span', { className: 'cm-tag' }, `立场：${selectedIt.stance || '复杂'}`), h('span', { className: 'cm-tag' }, `方向：${selectedIt.direction === 'a<->b' ? '对等' : selectedIt.direction === 'a->b' ? 'A→B' : 'B→A'}`), h('span', { className: 'cm-tag' }, `强度：${selectedIt.weight ?? 5}/10`)), selectedIt.summary ? h('div', { className: 'cm-sub' }, selectedIt.summary) : null, selectedIt.tags && selectedIt.tags.length
                ? h('div', { className: 'cm-sub' }, selectedIt.tags.map(x => '#' + x).join(' '))
                : null, selectedIt.analysis
                ? h('div', { className: 'cm-line', style: { marginTop: 6 } }, selectedIt.analysis)
                : h('div', { className: 'cm-note' }, '（尚无深析，点击「✨ 互动深析」让 AI 分析这段关系）'), h('div', { className: 'cm-acts' }, h('button', {
                className: 'cm-btn primary', disabled: netBusy !== '',
                onClick: () => void runAnalyze(selectedIt.aName, selectedIt.bName, netScope),
            }, netBusy === 'analyzing' ? '分析中…' : '✨ 互动深析（重新生成）'), h('button', { className: 'cm-btn danger', onClick: () => void deleteEdge(selectedIt.id) }, '删除')))
            : null, 
        // 新增互动表单
        h('div', { className: 'cm-form' }, h('div', { className: 'cm-sec' }, '登记互动'), 
        // §8.13：候选下拉（datalist），避免 a/b 手输名字打错
        h('datalist', { id: 'cm-char-list' }, graph.nodes.map(nd => h('option', { key: nd.id, value: nd.name })), locals.map((c) => h('option', { key: 'l' + c.id, value: c.name }))), h('label', null, '角色 A'), h('div', { className: 'row' }, h('div', null, h('input', { value: form.a, placeholder: '名字或 id（可下拉选）', list: 'cm-char-list', onChange: (e) => setForm({ ...form, a: e.target.value }) })), h('div', null, h('input', { value: form.b, placeholder: '名字或 id（可下拉选）', list: 'cm-char-list', onChange: (e) => setForm({ ...form, b: e.target.value }) }))), h('label', null, '角色 B'), h('div', { className: 'row' }, h('div', null, h('input', { value: form.type, placeholder: '关系类型（敌手/恋人/师徒…）', onChange: (e) => setForm({ ...form, type: e.target.value }) })), h('div', null, h('input', { value: form.stance, placeholder: '立场（敌对/亲近/利用…）', onChange: (e) => setForm({ ...form, stance: e.target.value }) }))), h('div', { className: 'row' }, h('div', null, h('label', null, '强度 0-10'), h('input', { type: 'number', min: 0, max: 10, value: form.weight, onChange: (e) => setForm({ ...form, weight: Number(e.target.value) }) })), h('div', null, h('label', null, '一句话概括'), h('input', { value: form.summary, placeholder: '可选', onChange: (e) => setForm({ ...form, summary: e.target.value }) }))), h('div', { className: 'cm-acts' }, h('button', { className: 'cm-btn primary', disabled: netBusy !== '', onClick: () => void submitAdd() }, netBusy === 'add' ? '登记中…' : '新增互动'), h('button', {
            className: 'cm-btn', disabled: !form.a.trim() || !form.b.trim() || netBusy !== '',
            onClick: () => void runAnalyze(form.a, form.b, netScope),
        }, '分析这段关系')))));
    };
    // ── §8.13 问卷作答 tab（UI 内直接跑问卷，核心缺口补齐） ──
    const renderQuiz = () => {
        const answeredCount = Object.keys(qAnswers).length;
        const lastNo = qQuestions.length ? qQuestions[qQuestions.length - 1].no : 0;
        return h('div', null, h('div', { className: 'cm-bar' }, h('select', {
            value: qKind, style: { minWidth: 240 },
            onChange: (e) => {
                const k = e.target.value;
                setQKind(k);
                setQAnswers({});
                setQResult('');
                setQRecord(null);
                const pg = { from: 1, size: qPage.size };
                setQPage(pg);
                void loadQuestions(k, pg);
            },
        }, h('option', { value: '' }, '选择问卷…'), qBanks.map(b => h('option', { key: b.id, value: b.id }, `${b.name}（${b.count} 题）`))), h('select', {
            value: qCharId, style: { minWidth: 160 }, onChange: (e) => setQCharId(e.target.value),
        }, h('option', { value: '' }, '不绑定角色（只出分）'), locals.map((c) => h('option', { key: c.id, value: c.id }, `写回：${c.name}`))), h('button', { className: 'cm-btn', onClick: () => { loadBanks(); loadHistory(); } }, '刷新')), qMsg ? h('div', { className: 'cm-note', style: { color: '#9d8ff5' } }, qMsg) : null, qQuestions.length === 0
            ? h('div', { className: 'cm-empty' }, qKind ? '暂无题目' : '请选择问卷开始作答。也可让 AI 助手用 character_questionnaire 代跑（agent 代传 answers）。')
            : h('div', null, h('div', { className: 'cm-quizbar' }, h('span', null, `本页 ${qQuestions.length} 题（到第 ${lastNo} 题）· 已答 ${answeredCount}`), h('button', { className: 'cm-btn', disabled: qPage.from <= 1, onClick: () => { const pg = { ...qPage, from: Math.max(1, qPage.from - qPage.size) }; setQPage(pg); void loadQuestions(qKind, pg); } }, '‹ 上一页'), h('button', { className: 'cm-btn', onClick: () => { const pg = { ...qPage, from: qPage.from + qPage.size }; setQPage(pg); void loadQuestions(qKind, pg); } }, '下一页 ›'), h('button', {
                className: 'cm-btn',
                onClick: () => {
                    const add = {};
                    for (const q of qQuestions) {
                        if (q.type === 'bool')
                            add[q.no] = true;
                        else if (q.type === 'ab')
                            add[q.no] = 'a';
                        else
                            add[q.no] = Math.round(((q.scaleMin ?? 1) + (q.scaleMax ?? 5)) / 2);
                    }
                    setQAnswers(a => ({ ...a, ...add }));
                },
            }, '本页取中值'), h('button', { className: 'cm-btn', onClick: () => setQAnswers({}) }, '清空作答')), qQuestions.map(q => h('div', { key: String(q.no), className: 'cm-quizq' }, h('div', { className: 'cm-quizstem' }, `${q.no}. ${q.text}`, q.dimension ? h('span', { className: 'cm-badge' }, q.dimension) : null), h('div', { className: 'cm-acts' }, q.type === 'bool'
                ? [true, false].map(v => h('button', {
                    key: String(v),
                    className: 'cm-btn' + (qAnswers[q.no] === v ? ' primary' : ''),
                    onClick: () => setQAnswers(a => ({ ...a, [q.no]: v })),
                }, v ? '是' : '否'))
                : q.type === 'ab'
                    ? ['a', 'b'].map(k => h('button', {
                        key: k,
                        className: 'cm-btn' + (qAnswers[q.no] === k ? ' primary' : ''),
                        onClick: () => setQAnswers(a => ({ ...a, [q.no]: k })),
                    }, `${k.toUpperCase()}. ${k === 'a' ? (q.a ?? '') : (q.b ?? '')}`))
                    : Array.from({ length: Math.max(1, (q.scaleMax ?? 5) - (q.scaleMin ?? 1) + 1) }, (_, i) => (q.scaleMin ?? 1) + i).map(v => h('button', {
                        key: v,
                        className: 'cm-btn' + (Number(qAnswers[q.no]) === v ? ' primary' : ''),
                        title: q.scaleLabels?.[v - (q.scaleMin ?? 1)] ?? '',
                        onClick: () => setQAnswers(a => ({ ...a, [q.no]: v })),
                    }, String(v)))))), h('div', { className: 'cm-acts', style: { marginTop: 12 } }, h('button', { className: 'cm-btn primary', disabled: qBusy, onClick: () => void submitQuiz(false) }, qBusy ? '计分中…' : '✅ 提交计分（缺题>10% 会拒绝）'), h('button', { className: 'cm-btn', disabled: qBusy, onClick: () => void submitQuiz(true) }, '强制按部分作答计分'))), qResult ? h('div', { className: 'cm-card' }, h('h4', null, '计分结果'), h('div', { className: 'cm-line' }, qResult)) : null, h('div', { className: 'cm-sec' }, `作答历史（${qHistory.length}）`), qHistory.length === 0
            ? h('div', { className: 'cm-empty' }, '暂无作答记录')
            : h('div', null, qHistory.slice(0, 30).map((r) => h('div', { key: r.id, className: 'cm-card' }, h('h4', null, h('span', { className: 'grow' }, `${r.kind}${r.characterName ? ' · ' + r.characterName : ''}`), h('span', { className: 'cm-tag' }, String(r.finishedAt ?? '').replace('T', ' ').slice(0, 19)), r.missingCount ? h('span', { className: 'cm-badge' }, `缺${r.missingCount}题`) : null, r.hasAnswers ? h('span', { className: 'cm-tag' }, '✓原始作答') : null), h('div', { className: 'cm-sub' }, r.summary ?? ''), h('div', { className: 'cm-acts' }, h('button', { className: 'cm-btn', onClick: () => void openRecord(r.id) }, '查看明细'))))), qRecord ? h('div', { className: 'cm-card' }, h('h4', null, `记录明细 · ${qRecord.kind}`), h('div', { className: 'cm-line', style: { maxHeight: 260, overflow: 'auto' } }, `原始作答：\n${JSON.stringify(qRecord.answers ?? {}, null, 1)}\n\n计分明细：\n${JSON.stringify(qRecord.scores ?? {}, null, 1)}`)) : null);
    };
    const head = h('div', { className: 'cm-bar' }, h('strong', null, '角色设定工作坊'), h('span', { style: { fontSize: 11, opacity: .6 } }, '九型×MBTI×大五 · novel 联动 · 关系网'), h('button', { onClick: () => { refreshLocal(); refreshProjects(); refreshNet(netScope).catch(() => { }); } }, '刷新'), h('span', { className: 'cm-sync' }, syncedAt ? `已同步 ${syncedAt}` : '同步中…'));
    return h('div', { className: 'cm-root' }, h('style', null, CSS), head, h('div', { className: 'cm-tabs' }, h('div', { className: 'cm-tab' + (tab === 'local' ? ' on' : ''), onClick: () => setTab('local') }, `本地角色（${locals.length}）`), h('div', { className: 'cm-tab' + (tab === 'quiz' ? ' on' : ''), onClick: () => setTab('quiz') }, `📝 问卷作答（${qBanks.length} 种）`), h('div', { className: 'cm-tab' + (tab === 'novel' ? ' on' : ''), onClick: () => setTab('novel') }, `novel-writer 联动（${projects.length} 项目）`), h('div', { className: 'cm-tab' + (tab === 'net' ? ' on' : ''), onClick: () => setTab('net') }, `🌐 关系网（${graph.nodes.length} 点 · ${graph.edges.length} 边）`)), tab === 'local' ? renderLocal() : tab === 'quiz' ? renderQuiz() : tab === 'novel' ? renderNovel() : renderNet());
}
/** 标点/序号清理，让图上标签更短 */
function nodesLabel(name) {
    return String(name ?? '').replace(/\s+/g, ' ').slice(0, 6);
}
export function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: '@dsh-external/dsh-character-maker-panel', order: 50, label: () => '角色设定' }, CharacterPanel)), '@dsh-external/dsh-character-maker: panel');
}
//# sourceMappingURL=index.js.map