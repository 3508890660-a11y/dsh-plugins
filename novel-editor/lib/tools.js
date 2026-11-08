/**
 * novel_editor_* 工具集：本地小说编辑引擎（校对/轻度修正/深度润色/一致性审查）。
 * 独立于 dsh-novel-writer（不依赖其内部实现），但数据布局互通：
 * 给定 projectId/chapterId 时可读取/写回同一章节正文（写回前自动备份 chapters/backup/）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MODE_DESC } from './editor.js';
import { detectEditDamage, detectTextDamage } from './check.js';
import { analyzeAiTraces } from './analyze.js';
const text = (t) => [{ type: 'text', text: t }];
const unk = (v) => v;
/** 项目上下文（精简 system 拼接）：书名/题材/文风 + 主要人物关键信息（与 dsh-novel-writer polishChapter 同款切片） */
function projectSystemExtra(data) {
    const p = data.project;
    const parts = [];
    parts.push(`正在编辑《${p.name}》。题材：${p.genre ?? '未知'}。`);
    if (p.style)
        parts.push(`文风要求：${p.style}`);
    const chars = (data.characters ?? []).filter(c => c.role === 'protagonist' || c.role === 'supporting' || c.role === 'antagonist');
    if (chars.length > 0) {
        parts.push('【人物档案·关键信息】');
        for (const c of chars) {
            const bits = [`◆ ${c.name}${c.aliases && c.aliases.length > 0 ? '（' + c.aliases.join('、') + '）' : ''}[${c.role}]`];
            if (c.personality)
                bits.push(`性格：${c.personality.slice(0, 200)}`);
            if (c.goal)
                bits.push(`目标：${c.goal.slice(0, 200)}`);
            if (c.background)
                bits.push(`背景：${c.background.slice(0, 200)}`);
            parts.push(bits.join('；'));
        }
    }
    return parts.join('\n');
}
export function buildTools(deps) {
    const { editor, store, dataDir, ollamaUrl } = deps;
    const tools = [];
    // ── 核心：编辑一段文本 / 一章正文 ──
    tools.push(defineTool({
        name: 'novel_editor_edit',
        description: `本地编辑模型（novel-editor）：对文本执行校对/轻度修正/深度润色/一致性审查/去 AI 痕后输出完整正文。mode 说明：${MODE_DESC.proofread.slice(0, 18)}…${MODE_DESC.light.slice(0, 18)}…${MODE_DESC.deep.slice(0, 18)}…${MODE_DESC.consistency.slice(0, 18)}…${MODE_DESC.detrace.slice(0, 40)}…。给 text 直接编辑文本；只给 projectId+chapterId 则读取 dsh-novel-writer 的章节正文编辑（自动带人物档案上下文）。save=true 且给了 projectId+chapterId 时覆盖原章节（自动备份到 chapters/backup/；此模式先过完整性检测，未通过不落盘并返回 blocked+全文）。只输出正文，不添加原文不存在的信息。`,
        parameters: {
            text: { type: 'string', description: '待编辑文本（与 projectId+chapterId 二选一，优先 text）' },
            projectId: { type: 'string', description: 'novel-writer 项目 id（可选，配合 chapterId 读取/保存章节）' },
            chapterId: { type: 'string', description: '章节 id（大纲中 type=chapter 的节点 id，可选）' },
            mode: { type: 'string', enum: ['proofread', 'light', 'deep', 'consistency', 'detrace'], description: 'proofread=校对（只改错字/标点/语病，不改写）| light=轻度修正硬伤 | deep=深度润色（默认） | consistency=一致性审查（对照人物/设定修正矛盾） | detrace=去 AI 痕（诊断统计特征+节奏指纹后改写，消除 AI 腔，还原手写气口）' },
            instruction: { type: 'string', description: '自由编辑指令（追加在模式之后，如：对话更口语化、缩紧段落）' },
            focus: { type: 'string', description: '重点方向（如：动作描写更细致、节奏更快）' },
            save: { type: 'boolean', description: '覆盖章节原文并备份（默认 false；需 projectId+chapterId；落盘前完整性检测，未通过则 blocked 不落盘）' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    edited: { type: 'string', required: true },
                    wordCount: { type: 'integer', required: true },
                    save: { type: 'boolean', required: true },
                    backupPath: { type: 'string' },
                    blocked: { type: 'string' },
                    damage: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } }, ratio: { type: 'number' } } },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                if (r.blocked) {
                    return text(`⚠️ 完整性检测未通过，未落盘：${r.blocked}\n请检查以下编辑稿全文，确认无误后 save=true 重试。\n${r.edited.slice(0, 500)}`);
                }
                return text(r.save
                    ? `已编辑并保存（${r.wordCount} 字），原文备份：${r.backupPath ?? 'chapters/backup/'}\n${r.edited.slice(0, 300)}`
                    : `编辑完成（${r.wordCount} 字${r.damage && !r.damage.ok ? '，⚠️ 检测提示：' + r.damage.issues.join('；') : ''}，未落盘，可用 save=true 保存）：\n${r.edited.slice(0, 300)}`);
            },
        },
        async execute(args) {
            const a = unk(args);
            let textVal = a.text?.trim() ?? '';
            let chapterTitle = '';
            if (!textVal) {
                if (!a.projectId || !a.chapterId)
                    throw new Error('需要 text，或 projectId+chapterId（二选一）');
                textVal = store.readChapterContent(a.projectId, a.chapterId);
                if (!textVal)
                    throw new Error('该章节还没有正文');
                const data = store.load(a.projectId);
                const node = (data.outline ?? []).find(n => n.id === a.chapterId && n.type === 'chapter');
                chapterTitle = node?.title ?? a.chapterId;
            }
            const systemExtra = a.projectId ? projectSystemExtra(store.load(a.projectId)) : undefined;
            const edited = await editor.edit(textVal, { mode: a.mode, instruction: a.instruction, focus: a.focus, systemExtra });
            const damage = detectEditDamage(textVal, edited);
            if (a.save === true && a.projectId && a.chapterId) {
                if (!damage.ok) {
                    return { edited, wordCount: edited.replace(/\s/g, '').length, save: false, damage, blocked: `完整性检测未通过，未落盘（${chapterTitle}）：` + damage.issues.join('；') };
                }
                const backupPath = store.writeChapterBackup(a.projectId, a.chapterId, textVal);
                store.writeChapterContent(a.projectId, a.chapterId, edited);
                return { edited, wordCount: edited.replace(/\s/g, '').length, save: true, backupPath, damage };
            }
            return { edited, wordCount: edited.replace(/\s/g, '').length, save: false, damage };
        },
        timeoutMs: 600_000,
    }));
    // ── 质量检测 ──
    tools.push(defineTool({
        name: 'novel_editor_check',
        description: '编辑稿质量检测：检查文本内的段落重复/内容重复/替换符/字符堆叠/think或imdi残留/元话语（无需原文对照）。给 text 直接检查；给 projectId+chapterId 检查章节正文。',
        parameters: {
            text: { type: 'string', description: '待检查文本（与 projectId+chapterId 二选一）' },
            projectId: { type: 'string', description: 'novel-writer 项目 id（可选）' },
            chapterId: { type: 'string', description: '章节 id（可选）' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    issues: { type: 'array', items: { type: 'string' }, required: true },
                    length: { type: 'integer', required: true },
                    source: { type: 'string', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                return text(r.ok
                    ? `检测通过（${r.length} 字，来源 ${r.source}）：无明显重复/杂讯/残留`
                    : `检测未通过（${r.length} 字，来源 ${r.source}）：${r.issues.join('；')}`);
            },
        },
        async execute(args) {
            const a = unk(args);
            let t = a.text?.trim() ?? '';
            let source = 'text';
            if (!t) {
                if (!a.projectId || !a.chapterId)
                    throw new Error('需要 text，或 projectId+chapterId（二选一）');
                t = store.readChapterContent(a.projectId, a.chapterId);
                source = `chapter:${a.chapterId}`;
                if (!t)
                    throw new Error('该章节还没有正文');
            }
            const r = detectTextDamage(t);
            return { ok: r.ok, issues: r.issues, length: t.replace(/\s/g, '').length, source };
        },
    }));
    // ── AI 痕迹诊断（统计特征客观计算 + 模型诊断报告）──
    tools.push(defineTool({
        name: 'novel_editor_aiscan',
        description: 'AI 痕迹诊断：客观统计特征（句长方差=节奏均匀度、Bigram 词汇多样性 TTR、书面连接词/对称并列/绝对化词每千字密度、标点节拍、碎片短句占比）+ 模型叙述的诊断报告（总体 AI 可能度、节奏指纹、最刺眼处）。给 text 直接分析；给 projectId+chapterId 分析章节。只诊断，不修改文本。',
        parameters: {
            text: { type: 'string', description: '待分析文本（与 projectId+chapterId 二选一，优先 text）' },
            projectId: { type: 'string', description: 'novel-writer 项目 id（可选）' },
            chapterId: { type: 'string', description: '章节 id（可选）' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    summary: { type: 'string', required: true },
                    modelReport: { type: 'string' },
                    flags: { type: 'array', items: { type: 'string' }, required: true },
                    source: { type: 'string', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`【统计特征】${r.summary}`, ...(r.flags.length ? [`可疑项：${r.flags.join('；')}`] : [])];
                if (r.modelReport)
                    lines.push(`\n【模型诊断】\n--\n${r.modelReport}\n--`);
                lines.push(`若确认 AI 腔明显，可用 novel_editor_edit(mode=detrace) 去痕。`);
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = unk(args);
            let t = a.text?.trim() ?? '';
            let source = 'text';
            const systemExtra = a.projectId ? projectSystemExtra(store.load(a.projectId)) : undefined;
            if (!t) {
                if (!a.projectId || !a.chapterId)
                    throw new Error('需要 text，或 projectId+chapterId（二选一）');
                t = store.readChapterContent(a.projectId, a.chapterId);
                source = `chapter:${a.chapterId}`;
                if (!t)
                    throw new Error('该章节还没有正文');
            }
            const stats = analyzeAiTraces(t);
            let modelReport;
            try {
                modelReport = await editor.scanAi(t, { systemExtra });
            }
            catch (e) {
                modelReport = `（模型不可用，已跳过叙述诊断：${e.message}）`;
            }
            return { summary: stats.summary, modelReport, flags: stats.flags, source };
        },
        timeoutMs: 180_000,
    }));
    // ── 状态 ──
    tools.push(defineTool({
        name: 'novel_editor_status',
        description: '查看 novel-editor 编辑引擎状态：模型路由可用性、Ollama 模型列表、数据目录与 novel-writer 项目数量。',
        parameters: {},
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    route: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    available: { type: 'boolean', required: true },
                    ollama: { type: 'object', additionalProperties: false, properties: { reachable: { type: 'boolean' }, models: { type: 'array', items: { type: 'string' } } } },
                    dataDir: { type: 'string', required: true },
                    projects: { type: 'integer', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                return text(r.available
                    ? `编辑引擎就绪：${r.route}（来源 ${r.source}；Ollama ${r.ollama.reachable ? '可达' : '不可达'}；数据目录 ${r.dataDir}，项目 ${r.projects} 个）`
                    : `编辑引擎可用性待定：${r.route}（来源 ${r.source}；Ollama ${r.ollama.reachable ? '可达' : '不可达'}，模型列表：${r.ollama.models.join(', ') || '无'}；本地模型缺失时若已捕获主会话路由则会回退会话模型）`);
            },
        },
        async execute() {
            const info = editor.routeInfo();
            let ollama = { reachable: false, models: [] };
            try {
                const resp = await fetch(ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(3000) });
                if (resp.ok) {
                    const j = await resp.json();
                    ollama = { reachable: true, models: (j.models ?? []).map(m => m.name) };
                }
            }
            catch { /* Ollama 不可达 */ }
            const localOk = !!info.route && info.source === 'explicit' && ollama.reachable && ollama.models.some(m => m.startsWith('novel-editor'));
            // available：本地模型就绪，或虽未就绪但已回退到可用的会话模型
            const available = localOk || (info.source === 'session' && !!info.route);
            return {
                route: info.route ? `${info.route.provider}/${info.route.model}` : '(无可用路由：本地模型缺失且未捕获主会话路由)',
                source: info.source === 'explicit' ? '本地编辑模型' : info.source === 'session' ? '回退当前会话模型' : 'none',
                available,
                ollama,
                dataDir,
                projects: store.listProjects().length,
            };
        },
    }));
    return tools;
}
//# sourceMappingURL=tools.js.map