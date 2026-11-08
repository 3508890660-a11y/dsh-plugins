/**
 * 分析类 + 章节库浏览工具（从旧版 dsh-novel-writer 移植到本插件）。
 *
 * 数据模型适配：旧版按文件系统 novels/<书>/*.md；本插件按项目（projectId）+ chapters/<id>.md。
 * 故这些工具以 projectId 定位作品，chapter 可用 id / 标题子串 / 章号定位。
 *
 * 移植的引擎（零依赖，原文逐字 vendored）：
 *   - src/legacy/analysis.js     → analyzeText（九类句式/转移/模板/段落/句长/情感/指纹）、
 *                                  fingerprintSimilarity、styleDiffs、densityOf
 *   - src/legacy/style-metrics.js → measureStyleMetrics / computeBaseline* / judgeAgainstBaseline（文笔六维）
 *   - 关键字提取（中文相邻 2/3 字词组 + 英文词 + 疑似人名）本文件内实现（复刻旧版 extractKeywords）
 *
 * 本移植不包含语义增强（本地 embedding：semanticStyle/semanticImplicit 等），
 * 故相关开关输出统一为“未启用（移植版无本地 embedding 依赖）”。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { chapterVolume, volumesSorted } from './types.js';
import { analyzeText, fingerprintSimilarity, styleDiffs } from './legacy/analysis.js';
import { measureStyleMetrics, computeBaselineFromPerChapter, judgeAgainstBaseline, METRIC_ORDER, METRIC_LABELS, } from './legacy/style-metrics.js';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const CACHE_VERSION = '0.0.1-anal'; // 移植版缓存版本（与旧版 v3.7.0 区分，避免旧缓存误命中）
const SENTENCE_ANALYSIS_DEFAULTS = { enabled: true, autoAnalyze: true };
const text = (t) => [{ type: 'text', text: t }];
/** 宽松转换：工具 output.schema 的 JSON 类型与 TS 字面量对象不完全相容，用 unknown 中转。 */
const unk = (v) => v;
/* ───────────────── 关键字提取（复刻旧版 extractKeywords + tallyCjkRun） ───────────────── */
/** 中文虚词/功能字黑名单：不参与关键词统计。 */
const CJK_STOP_CHARS = new Set('的了是在有和就都而于及与或这那之其以被把让向着过也还又但更最很从对为等啊吧呢吗嗯哦呀哈啦么个中上下前后左右来去出进到说想看要会能可没有不'.split(''));
/** 英文停用词。 */
const EN_STOP_WORDS = new Set('the and of to in a an is are was were be been being it its this that these those i you he she they we my your his her their our me him them us as at by for with on from or but not no so if then than when where which who whom what how why all any both each few more most other some such only own same too very just can could will would shall should may might must do does did done have has had having about into over under again further once here there'.split(/\s+/));
function tallyCjkRun(run, cjkBigrams, cjkTrigrams) {
    for (let i = 0; i < run.length; i += 1) {
        if (i + 1 < run.length) {
            const bigram = run[i] + run[i + 1];
            const meaningful = !CJK_STOP_CHARS.has(run[i]) || !CJK_STOP_CHARS.has(run[i + 1]);
            if (meaningful)
                cjkBigrams.set(bigram, (cjkBigrams.get(bigram) ?? 0) + 1);
        }
        if (i + 2 < run.length) {
            const trigram = run[i] + run[i + 1] + run[i + 2];
            const nonStop = [run[i], run[i + 1], run[i + 2]].filter((ch) => !CJK_STOP_CHARS.has(ch)).length;
            if (nonStop >= 2)
                cjkTrigrams.set(trigram, (cjkTrigrams.get(trigram) ?? 0) + 1);
        }
    }
}
function extractKeywords(text, top) {
    const cjkBigrams = new Map();
    const cjkTrigrams = new Map();
    const enWords = new Map();
    const nameCandidates = new Map();
    const cjkRun = [];
    for (const ch of text) {
        if (/[\u4e00-\u9fff]/.test(ch))
            cjkRun.push(ch);
        else if (cjkRun.length > 0) {
            tallyCjkRun(cjkRun, cjkBigrams, cjkTrigrams);
            cjkRun.length = 0;
        }
    }
    if (cjkRun.length > 0)
        tallyCjkRun(cjkRun, cjkBigrams, cjkTrigrams);
    for (const match of text.toLowerCase().matchAll(/[a-z]{2,}/g)) {
        const word = match[0];
        if (!EN_STOP_WORDS.has(word))
            enWords.set(word, (enWords.get(word) ?? 0) + 1);
    }
    const namePatterns = [
        /([\u4e00-\u9fff]{2,3})(?:说|道|问|喊|叫|想|笑|叹|答|喝|骂|念|哭|点头|摇头)/g,
        /([\u4e00-\u9fff]{2,3})(?:小姐|大人|先生|少爷|姑娘|殿下|老师|导师|婆婆|爷爷|奶奶|夫人|老爷|公子|长老|神甫|陛下)/g,
    ];
    for (const pattern of namePatterns) {
        for (const match of text.matchAll(pattern)) {
            const name = match[1];
            if (/^[他她我你它又再还这那谁]./.test(name))
                continue;
            if (name === '那个' || name === '这个' || name === '什么' || name === '怎么' || name === '自己' || name === '她们' || name === '他们' || name === '你们')
                continue;
            nameCandidates.set(name, (nameCandidates.get(name) ?? 0) + 1);
        }
    }
    const keywords = [];
    for (const [word, count] of cjkBigrams)
        if (count > 1)
            keywords.push({ word, count, kind: 'cjk-bigram' });
    for (const [word, count] of cjkTrigrams)
        if (count > 1)
            keywords.push({ word, count, kind: 'cjk-trigram' });
    for (const [word, count] of nameCandidates)
        if (count >= 2)
            keywords.push({ word, count, kind: 'name-candidate' });
    for (const [word, count] of enWords)
        if (count > 1)
            keywords.push({ word, count, kind: 'word' });
    keywords.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
    return keywords.slice(0, top);
}
function stateFile(dataDir) { return join(dataDir, 'analysis-state.json'); }
function readState(dataDir) {
    try {
        const f = stateFile(dataDir);
        if (!existsSync(f))
            return { exists: false, ...SENTENCE_ANALYSIS_DEFAULTS, tools: {}, features: {} };
        const p = JSON.parse(readFileSync(f, 'utf8'));
        return {
            exists: true,
            enabled: typeof p.enabled === 'boolean' ? p.enabled : SENTENCE_ANALYSIS_DEFAULTS.enabled,
            autoAnalyze: typeof p.autoAnalyze === 'boolean' ? p.autoAnalyze : SENTENCE_ANALYSIS_DEFAULTS.autoAnalyze,
            tools: p.tools && typeof p.tools === 'object' ? p.tools : {},
            features: p.features && typeof p.features === 'object' ? p.features : {},
            styleTolerance: p.styleTolerance && typeof p.styleTolerance === 'object' ? p.styleTolerance : null,
        };
    }
    catch {
        return { exists: false, ...SENTENCE_ANALYSIS_DEFAULTS, tools: {}, features: {} };
    }
}
function writeState(dataDir, patch) {
    const current = readState(dataDir);
    const next = {
        exists: true,
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
        autoAnalyze: typeof patch.autoAnalyze === 'boolean' ? patch.autoAnalyze : current.autoAnalyze,
        tools: patch.tools && typeof patch.tools === 'object' ? { ...current.tools, ...patch.tools } : current.tools,
        features: patch.features && typeof patch.features === 'object' ? { ...current.features, ...patch.features } : current.features,
    };
    if (patch.styleTolerance !== undefined)
        next.styleTolerance = patch.styleTolerance;
    const f = stateFile(dataDir);
    mkdirSync(join(dataDir, 'analysis'), { recursive: true });
    const tmp = f + '.tmp-' + Date.now();
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    try {
        renameSync(tmp, f);
    }
    catch { /* 尽力而为 */ }
    return next;
}
function featureEnabled(state, name) {
    return state.features[name] !== false;
}
function chapterRows(data) {
    // 排序：卷序 → 卷内 order → 未挂卷（按 order）。多卷项目章 order 是卷内序号，全局 order 排序会交错。
    const vols = volumesSorted(data);
    const keyOf = (c) => {
        const vol = chapterVolume(data, c.id);
        if (vol) {
            const vi = vols.findIndex(v => v.id === vol.id);
            return [0, vi, c.order];
        }
        return [1, 0, c.order];
    };
    return data.chapters.slice().sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    }).map((c) => ({
        id: c.id, title: c.title, order: c.order, status: c.status, summary: c.summary, wordCount: c.wordCount, updatedAt: c.updatedAt,
        volumeId: c.volumeId ?? null,
        volumeTitle: (() => {
            const vol = data.outline.find(n => n.id === c.volumeId && n.type === 'volume');
            return vol ? vol.title : '';
        })(),
    }));
}
/** 章节引用解析：支持 id 全等 / 标题子串 / 章号数字。 */
function resolveChapters(_store, _projectId, data, chapterArg) {
    const rows = chapterRows(data);
    if (chapterArg === undefined || chapterArg === '')
        return rows;
    const hit = rows.find((c) => c.id === chapterArg || c.title === chapterArg || c.title.includes(chapterArg) || String(c.order) === chapterArg);
    if (!hit)
        throw new Error(`在项目 "${data.project.name}" 中找不到章节 "${chapterArg}"（可用章号/标题子串/章节 id）`);
    return [hit];
}
/** 拼接若干章正文（readChapterContent）。 */
function concatChapters(store, projectId, chapters) {
    let out = '';
    for (const c of chapters)
        out += store.readChapterContent(projectId, c.id);
    return out;
}
/* ───────────────── 工具集构造 ───────────────── */
export function buildAnalysisTools(ctx) {
    const { store, dataDir } = ctx;
    const tools = [];
    // ── novel_books：列出全部作品（项目） ──
    tools.push(defineTool({
        name: 'novel_books',
        description: '列出小说章节库中的全部作品（即全部项目）：书名/id/题材/章节数/字数概况。',
        parameters: {},
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    books: { type: 'array', required: true, items: { type: 'json' } },
                    count: { type: 'integer', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`共 ${r.count} 部作品：`];
                for (const b of r.books)
                    lines.push(`- ${b.name}（id=${b.id}${b.genre ? '，' + b.genre : ''}，${b.chapters} 章，更新 ${b.updatedAt.slice(0, 10)}）`);
                return text(lines.join('\n'));
            },
        },
        async execute() {
            const projects = store.listProjects();
            const books = projects.map((p) => {
                const data = store.load(p.id);
                return {
                    id: p.id, name: p.name, genre: p.genre, style: p.style,
                    chapters: data.chapters.length,
                    volumes: data.outline.filter(n => n.type === 'volume').length,
                    characters: data.characters.length,
                    updatedAt: p.updatedAt,
                };
            });
            return { books, count: books.length };
        },
    }));
    // ── novel_chapters：列出某作品章节 ──
    tools.push(defineTool({
        name: 'novel_chapters',
        description: '列出某部作品的章节清单：章号/标题/状态/字数/摘要。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id（novel_books 中可查）' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    chapters: { type: 'array', required: true, items: { type: 'json' } },
                    count: { type: 'integer', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`共 ${r.count} 章：`];
                let lastVol = null;
                for (const c of r.chapters) {
                    const vol = c.volumeTitle ?? '';
                    if (vol && vol !== lastVol) {
                        lines.push(`📖 ${vol}`);
                        lastVol = vol;
                    }
                    else if (!vol)
                        lastVol = null;
                    lines.push(`- 第${c.order}章 ${c.title}（${c.status}，${c.wordCount} 字）${c.summary ? '：' + c.summary.slice(0, 40) : ''}`);
                }
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const rows = chapterRows(data).map((c) => ({
                id: c.id, order: c.order, title: c.title, status: c.status,
                wordCount: c.wordCount, summary: c.summary.slice(0, 120), updatedAt: c.updatedAt,
                ...(c.volumeId ? { volumeId: c.volumeId, volumeTitle: c.volumeTitle } : {}),
            }));
            return { projectId: a.projectId, chapters: rows, count: rows.length };
        },
    }));
    // ── novel_read：读取某章正文 ──
    tools.push(defineTool({
        name: 'novel_read',
        description: '阅读某部作品的某个章节正文。chapter 可用章号（如 1）/标题子串/章节 id。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'string', required: true, description: '章节：章号/标题子串/章节 id' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    chapter: { type: 'string', required: true },
                    order: { type: 'integer', required: true },
                    chars: { type: 'integer', required: true },
                    content: { type: 'string', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                return text(`第${r.order}章 ${r.chapter}（${r.chars} 字）\n\n${r.content}`);
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const [c] = resolveChapters(store, a.projectId, data, a.chapter);
            const content = store.readChapterContent(a.projectId, c.id);
            return { projectId: a.projectId, chapter: c.title, order: c.order, chars: content.length, content };
        },
    }));
    // ── novel_keywords：关键词提取 ──
    tools.push(defineTool({
        name: 'novel_keywords',
        description: '统计某部作品（或单个章节）中出现频率较高的关键词：中文相邻二字/三字词组与英文词（不含单字）。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'string', description: '可选。只统计该章节（章号/标题子串/章节 id）；省略统计全书。' },
            top: { type: 'integer', description: '返回的关键词数量。默认 20。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    scope: { type: 'string', required: true },
                    totalChars: { type: 'integer', required: true },
                    keywords: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                word: { type: 'string', required: true },
                                count: { type: 'integer', required: true },
                                kind: { type: 'string', enum: ['cjk-bigram', 'cjk-trigram', 'name-candidate', 'word'], required: true },
                            },
                        },
                    },
                    reportFile: { type: 'string' },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const labelOf = (k) => k === 'cjk-bigram' ? '词组' : k === 'cjk-trigram' ? '三字组' : k === 'name-candidate' ? '疑似人名' : '英文词';
                const lines = [`统计范围: ${r.scope} (共 ${r.totalChars} 字)`];
                if (r.keywords.length === 0)
                    lines.push('（未提取到重复出现的关键词）');
                for (const kw of r.keywords)
                    lines.push(`- ${kw.word} × ${kw.count} (${labelOf(kw.kind)})`);
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const rows = chapterRows(data);
            if (rows.length === 0)
                throw new Error(`项目 "${data.project.name}" 下没有章节内容`);
            const selected = resolveChapters(store, a.projectId, data, a.chapter);
            const scope = a.chapter ? selected[0].title : `全书 ${rows.length} 章`;
            const textAll = concatChapters(store, a.projectId, selected);
            const top = Math.min(100, Math.max(1, typeof a.top === 'number' && Number.isInteger(a.top) ? a.top : 20));
            const result = {
                projectId: a.projectId, scope, totalChars: textAll.length,
                keywords: extractKeywords(textAll, top),
            };
            try {
                const reportDir = join(dataDir, 'analysis');
                mkdirSync(reportDir, { recursive: true });
                const reportFile = join(reportDir, data.project.name + '-keywords-' + createHash('sha1').update(data.project.id + '|' + scope + '|' + textAll.length).digest('hex').slice(0, 12) + '.json');
                writeFileSync(reportFile, JSON.stringify({ ...result, generatedAt: new Date().toISOString(), ver: CACHE_VERSION }, null, 2), 'utf8');
                result.reportFile = reportFile;
            }
            catch { /* 落盘失败不阻塞 */ }
            return result;
        },
    }));
    // ── novel_sentence_analysis：句式模式分析（主引擎） ──
    tools.push(defineTool({
        name: 'novel_sentence_analysis',
        description: '句式模式分析：统计某部作品（或单章）的九类句式分布、排列规律（转移/模板/段首段尾/压缩节奏序列）、段落结构、句长分布、情感曲线、风格指纹与节奏建议，用于快速掌握作者的写作习惯与叙事节奏。受 novel_sentence_config 开关控制。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'string', description: '可选。只分析该章节；省略则分析全书。' },
            top: { type: 'integer', description: '返回的高频句式模板数量。默认 8。' },
            maxSentences: { type: 'integer', description: '采样句数上限（默认 20000）。' },
            curveSegments: { type: 'integer', description: '情感曲线分段数（1-50，默认 20）。' },
            fresh: { type: 'boolean', description: 'true=强制重新分析（忽略缓存）。默认 false。' },
            brief: { type: 'boolean', description: 'true=返回精简摘要（brief 字段）。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    scope: { type: 'string', required: true },
                    enabled: { type: 'boolean', required: true },
                    message: { type: 'string' },
                    totalChars: { type: 'integer', required: true },
                    totalSentences: { type: 'integer', required: true },
                    autoAnalyze: { type: 'boolean' },
                    categories: { type: 'array', items: { type: 'json' } },
                    transitions: { type: 'array', items: { type: 'json' } },
                    motifs: { type: 'array', items: { type: 'json' } },
                    paragraphs: { type: 'object', additionalProperties: true },
                    lengths: { type: 'object', additionalProperties: true },
                    style: { type: 'object', additionalProperties: true },
                    emotion: { type: 'object', additionalProperties: true },
                    chapterPatterns: { type: 'array', items: { type: 'json' } },
                    guidance: { type: 'string' },
                    fingerprint: { type: 'string' },
                    density: { type: 'object', additionalProperties: true },
                    reportFile: { type: 'string' },
                    brief: { type: 'string' },
                    cache: { type: 'string', enum: ['hit', 'miss'] },
                    cachedAt: { type: 'string' },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [];
                if (r.enabled === false)
                    lines.push(String(r.message ?? '句式模式分析已关闭。'));
                else {
                    lines.push(`范围: ${String(r.scope)}（${r.totalSentences} 句 / ${r.totalChars} 字）${r.cache === 'hit' ? ' [缓存命中]' : ''}`);
                    const cats = Array.isArray(r.categories) ? r.categories : [];
                    for (const c of cats)
                        lines.push(`  ${c.label ?? '?'} ${Math.round((c.ratio ?? 0) * 100)}%（${c.count} 句）`);
                    const len = r.lengths;
                    if (len)
                        lines.push(`  均句长 ${len.avg ?? '-'} 字 | 短句 ${Math.round((len.shortRatio ?? 0) * 100)}% | 长句 ${Math.round((len.longRatio ?? 0) * 100)}%`);
                    const emo = r.emotion;
                    if (emo)
                        lines.push(`  主导情绪: ${emo.dominant ?? '-'}${emo.cleanDominant && emo.cleanDominant !== emo.dominant ? `（真实 ${emo.cleanDominant}）` : ''}`);
                    lines.push(`  风格指纹: ${String(r.fingerprint ?? '-')}`);
                    if (r.guidance)
                        lines.push(`  节奏建议: ${String(r.guidance).slice(0, 300)}`);
                }
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const rows = chapterRows(data);
            if (rows.length === 0)
                throw new Error(`项目 "${data.project.name}" 下没有章节内容`);
            const state = readState(dataDir);
            const top = Math.min(50, Math.max(1, typeof a.top === 'number' ? a.top : 8));
            const maxSentences = Math.min(100000, Math.max(100, typeof a.maxSentences === 'number' ? a.maxSentences : 20000));
            const curveSegments = Math.min(50, Math.max(1, typeof a.curveSegments === 'number' ? a.curveSegments : 20));
            const fresh = a.fresh === true;
            const selected = resolveChapters(store, a.projectId, data, a.chapter);
            const scope = a.chapter ? selected[0].title : `全书 ${rows.length} 章`;
            const textAll = concatChapters(store, a.projectId, selected);
            const reportDir = join(dataDir, 'analysis');
            mkdirSync(reportDir, { recursive: true });
            const cacheKey = createHash('sha1').update(data.project.id + '|' + scope + '|' + textAll.length).digest('hex').slice(0, 20);
            const reportFile = join(reportDir, data.project.name + '-' + cacheKey + '.json');
            if (!state.enabled) {
                return {
                    projectId: a.projectId, scope, enabled: false, totalChars: textAll.length, totalSentences: 0,
                    message: '句式模式分析当前已关闭。可用 novel_sentence_config 设置 enabled=true（或开启侧边栏「写作助手功能」）。',
                };
            }
            if (!fresh) {
                try {
                    const cached = JSON.parse(readFileSync(reportFile, 'utf8'));
                    if (cached && cached.ver === CACHE_VERSION) {
                        const { ver: _ver, ...rest } = cached;
                        const r = { ...rest, projectId: a.projectId, scope, cache: 'hit', reportFile, cachedAt: cached.cachedAt ?? new Date().toISOString() };
                        if (a.brief === true)
                            r.brief = buildBrief(scope, r);
                        return unk(r);
                    }
                }
                catch { /* 缓存缺失/损坏，重新分析 */ }
            }
            const options = { top, maxSentences, curveSegments };
            if (!a.chapter) {
                const chapterTexts = selected.map((c) => ({ chapter: c.title, text: store.readChapterContent(a.projectId, c.id) }));
                options.chapterTexts = chapterTexts;
            }
            const analysis = analyzeText(textAll, options);
            const result = {
                projectId: a.projectId, scope, enabled: true, autoAnalyze: state.autoAnalyze, totalChars: textAll.length,
                ...analysis,
            };
            if (!featureEnabled(state, 'emotionCaveat') && result.emotion) {
                const e = result.emotion;
                delete e.quantification;
                delete e.caveat;
                delete e.aiAction;
            }
            try {
                writeFileSync(reportFile, JSON.stringify({ ...result, cachedAt: new Date().toISOString(), ver: CACHE_VERSION }, null, 2), 'utf8');
            }
            catch { /* 缓存写失败不影响结果 */ }
            result.cache = 'miss';
            result.reportFile = reportFile;
            result.cachedAt = new Date().toISOString();
            if (a.brief === true)
                result.brief = buildBrief(scope, result);
            return unk(result);
        },
    }));
    // ── novel_sentence_config：句式分析开关 ──
    tools.push(defineTool({
        name: 'novel_sentence_config',
        description: '查看或修改句式模式分析的开关状态：enabled（分析功能是否可用）、autoAnalyze（分析作品时是否主动使用）。',
        parameters: {
            action: { type: 'string', enum: ['get', 'set'], description: 'get=查看；set=修改。' },
            enabled: { type: 'boolean', description: '写作助手（句式分析）功能总开关。' },
            autoAnalyze: { type: 'boolean', description: '分析作品时是否主动使用句式分析。' },
            tools: { type: 'object', additionalProperties: true, description: '各工具开关（如 { novel_plot: false }），键必须是 novel_* 工具名。' },
            features: { type: 'object', additionalProperties: true, description: '功能开关（emotionCaveat=情感净化预警）。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    file: { type: 'string' },
                    enabled: { type: 'boolean', required: true },
                    autoAnalyze: { type: 'boolean', required: true },
                    source: { type: 'string' },
                    updated: { type: 'boolean' },
                    tools: { type: 'object', additionalProperties: true },
                    features: { type: 'object', additionalProperties: true },
                    styleTolerance: { type: 'object', additionalProperties: true },
                    message: { type: 'string' },
                },
            },
            render: (_a, v) => text(formatConfig(unk(v))),
        },
        async execute(args) {
            const a = args;
            const action = a.action === 'set' ? 'set' : 'get';
            if (action === 'set') {
                const patch = {};
                if (typeof a.enabled === 'boolean')
                    patch.enabled = a.enabled;
                if (typeof a.autoAnalyze === 'boolean')
                    patch.autoAnalyze = a.autoAnalyze;
                if (a.tools && typeof a.tools === 'object')
                    patch.tools = a.tools;
                if (a.features && typeof a.features === 'object')
                    patch.features = a.features;
                const next = writeState(dataDir, patch);
                return unk({ ...next, file: stateFile(dataDir), source: 'state', updated: true, message: '已更新句式分析开关' });
            }
            const s = readState(dataDir);
            const result = { file: stateFile(dataDir), enabled: s.enabled, autoAnalyze: s.autoAnalyze, source: s.exists ? 'state' : 'default', updated: false, tools: s.tools, features: s.features, message: '' };
            if (s.styleTolerance && typeof s.styleTolerance === 'object')
                result.styleTolerance = s.styleTolerance;
            return unk(result);
        },
    }));
    // ── novel_style_check：风格自检（目标章 vs 其他章基线） ──
    tools.push(defineTool({
        name: 'novel_style_check',
        description: '风格自检：对比某章节与全书其他章节的风格指纹（句式分布/句长/情绪）与文笔六维基线，输出相似度与偏差清单。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'string', required: true, description: '要检查的章节（章号/标题子串/章节 id）。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    chapter: { type: 'string', required: true },
                    baselineScope: { type: 'string', required: true },
                    similarity: { type: 'number', required: true },
                    verdict: { type: 'string', enum: ['high', 'medium', 'low'], required: true },
                    diffs: { type: 'array', required: true, items: { type: 'json' } },
                    chapterFingerprint: { type: 'string', required: true },
                    baselineFingerprint: { type: 'string', required: true },
                    advice: { type: 'string', required: true },
                    semantic: { type: 'object', additionalProperties: true, required: true },
                    metric: { type: 'object', additionalProperties: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const verdictLabel = r.verdict === 'high' ? '高度一致' : r.verdict === 'medium' ? '大体一致' : '偏离明显';
                const lines = [`检查章节: ${String(r.chapter)}`, `对比基线: ${String(r.baselineScope)}`, `风格相似度: ${Number(r.similarity) * 100}% (${verdictLabel})`];
                const diffs = Array.isArray(r.diffs) ? r.diffs : [];
                if (diffs.length === 0)
                    lines.push('偏差: 无明显偏差');
                else {
                    lines.push('偏差清单:');
                    for (const d of diffs)
                        lines.push(`  - ${d.dimension}: ${d.note} (${(d.diff ?? 0) > 0 ? '+' : ''}${d.diff})`);
                }
                lines.push(`本章指纹: ${String(r.chapterFingerprint)}`);
                lines.push(`基线指纹: ${String(r.baselineFingerprint)}`);
                const metric = r.metric;
                if (metric?.enabled && Array.isArray(metric.verdicts)) {
                    lines.push('', '文笔六维对照（μ=全书其他章基线，±%为相对偏差）：');
                    for (const vd of metric.verdicts) {
                        const mark = vd.status === 'out' ? '⚠ 出带' : vd.status === 'warn' ? '△ 提醒' : '✓ 在带';
                        lines.push(`  ${vd.label}: 本章 ${vd.value} vs 基线 ${vd.mu}（${(vd.devPct ?? 0) > 0 ? '+' : ''}${vd.devPct}%，${mark}）`);
                    }
                    if ((metric.outCount ?? 0) > 0)
                        lines.push('  ⚠ ' + (metric.summary ?? '') + '——请对照基线修正后再续写');
                }
                else if (metric && metric.enabled === false) {
                    lines.push('', '文笔六维对照: ' + (metric.note ?? '不可用'));
                }
                lines.push('', '【建议】');
                lines.push(String(r.advice));
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const rows = chapterRows(data);
            if (rows.length < 2)
                throw new Error(`项目 "${data.project.name}" 只有 ${rows.length} 章，无法做风格对比（至少需要 2 章）`);
            const target = resolveChapters(store, a.projectId, data, a.chapter)[0];
            const others = rows.filter((c) => c.id !== target.id);
            const state = readState(dataDir);
            if (!state.enabled)
                throw new Error('写作助手功能（句式模式分析）当前已关闭，可用 novel_sentence_config 设置 enabled=true 后再做风格自检。');
            const targetText = store.readChapterContent(a.projectId, target.id);
            let baselineText = '';
            const otherChapters = [];
            for (const c of others) {
                const t = store.readChapterContent(a.projectId, c.id);
                otherChapters.push({ id: c.id, file: c.title, text: t });
                baselineText += t;
            }
            const baseline = analyzeText(baselineText, {});
            const chapter = analyzeText(targetText, {});
            const similarity = fingerprintSimilarity(baseline, chapter);
            const diffs = styleDiffs(baseline, chapter);
            const verdict = similarity >= 0.9 ? 'high' : similarity >= 0.75 ? 'medium' : 'low';
            let advice = '';
            if (diffs.length === 0) {
                advice = '本章与全书风格高度一致，可以放心续写。';
            }
            else {
                const noteMap = { '偏高': '略多', '偏低': '略少', '偏长': '略长', '偏短': '略短' };
                advice = '续写时建议注意：' + diffs.slice(0, 4).map((d) => d.dimension + (noteMap[d.note] || d.note)).join('、') + '。若为情节需要（如章节情绪转折），可接受适度偏离，但不要持续漂移。';
            }
            // 文笔六维基线：目标章 vs 其他章 μ/σ
            let metric = null;
            try {
                const perCh = otherChapters.map((c) => ({ file: c.file, metrics: measureStyleMetrics(c.text).metrics }))
                    .concat([{ file: target.title, metrics: measureStyleMetrics(targetText).metrics }]);
                const excluding = perCh.filter((pc) => pc.metrics !== undefined && pc.file !== target.title);
                if (excluding.length > 0) {
                    const b = computeBaselineFromPerChapter(excluding);
                    const targetMetrics = measureStyleMetrics(targetText).metrics;
                    const tol = {};
                    const ourAll = computeBaselineFromPerChapter(perCh);
                    for (const tk of METRIC_ORDER) {
                        const rt = typeof ourAll?.[tk]?.recTol === 'number' ? ourAll[tk].recTol : 15;
                        tol[tk] = { low: -rt, high: rt };
                    }
                    if (state.styleTolerance && typeof state.styleTolerance === 'object') {
                        for (const tk of METRIC_ORDER) {
                            const u = state.styleTolerance[tk];
                            if (u && typeof u.low === 'number' && typeof u.high === 'number')
                                tol[tk] = { low: u.low, high: u.high };
                        }
                    }
                    const judge = judgeAgainstBaseline(targetMetrics, b, tol);
                    metric = { enabled: true, baseline: b, metrics: targetMetrics, verdicts: judge.verdicts, outCount: judge.outCount, summary: judge.summary };
                }
                else {
                    metric = { enabled: false, note: '基线章节不足（至少 1 个其他章节且有正文）' };
                }
            }
            catch (e) {
                metric = { enabled: false, note: '六维测量失败：' + String(e).slice(0, 80) };
            }
            // 语义增强：移植版无本地 embedding，统一关闭
            const semantic = { enabled: false, note: '语义增强未启用（移植版无本地 embedding 依赖），为纯规则模式' };
            return unk({
                projectId: a.projectId, chapter: target.title,
                baselineScope: others.length === 1 ? others[0].title : `全书除本章外的 ${others.length} 章`,
                similarity, verdict, diffs, semantic, metric,
                chapterFingerprint: chapter.fingerprint, baselineFingerprint: baseline.fingerprint, advice,
            });
        },
    }));
    // ── novel_style_report：风格画像报告（统计维度聚合） ──
    tools.push(defineTool({
        name: 'novel_style_report',
        description: '风格画像报告：聚合已移植的统计测量维度（句式指纹/高频词汇/情感/文笔六维基线带）供 AI 判断风格。文化基准/题材流派/氛围光谱/语义距离等需本地 embedding 或题材检测引擎的维度未移植。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            brief: { type: 'boolean', description: 'true=返回精简摘要（一句话结论）。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    chars: { type: 'integer', required: true },
                    report: { type: 'string', required: true },
                    brief: { type: 'string' },
                    dimensions: { type: 'object', additionalProperties: true },
                    baseline: { type: 'object', additionalProperties: true },
                    baselineChapterCount: { type: 'integer' },
                    message: { type: 'string' },
                },
            },
            render: (_a, v) => text(unk(v).report),
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            const rows = chapterRows(data);
            if (rows.length === 0)
                throw new Error(`项目 "${data.project.name}" 下没有章节内容`);
            const state = readState(dataDir);
            if (!state.enabled)
                throw new Error('写作助手功能（句式模式分析）当前已关闭，可用 novel_sentence_config 设置 enabled=true 后再生成风格报告。');
            let textAll = '';
            const perChRows = [];
            for (const c of rows) {
                const t = store.readChapterContent(a.projectId, c.id);
                perChRows.push({ file: c.title, text: t });
                textAll += t;
            }
            const analysis = analyzeText(textAll, {});
            const emo = analysis.emotion;
            const kw = extractKeywords(textAll, 8);
            let baseline = null;
            let baselineChapterCount = 0;
            try {
                const perCh = perChRows
                    .map((c) => ({ file: c.file, metrics: measureStyleMetrics(c.text).metrics }))
                    .filter((x) => isEmptyMetric(x.metrics) === false);
                baselineChapterCount = perCh.length;
                baseline = baselineChapterCount > 0 ? computeBaselineFromPerChapter(perCh) : null;
            }
            catch {
                baseline = null;
                baselineChapterCount = 0;
            }
            const lines = [];
            lines.push('【风格画像报告】《' + data.project.name + '》');
            lines.push('');
            lines.push('一、文风指纹（怎么写）');
            lines.push('  ' + (analysis.fingerprint || ''));
            const lens = analysis.lengths;
            lines.push(`  平均句长 ${lens?.avg ?? '-'} 字 | 短句 ${Math.round((lens?.shortRatio ?? 0) * 100)}% | 长句 ${Math.round((lens?.longRatio ?? 0) * 100)}% | 主观性 ${analysis.style?.subjectivityIndex ?? '-'}`);
            lines.push('');
            lines.push('二、高频词汇（用什么词）');
            lines.push('  ' + (kw.length > 0 ? kw.map((k) => k.word).join(' / ') : '（无）'));
            lines.push('');
            lines.push('三、情感（什么心情）');
            lines.push(`  表面 ${emo?.dominant ?? '-'} → 真实 ${emo?.cleanDominant ?? '-'}（置信度 ${emo?.confidence ?? '-'}）`);
            lines.push('');
            lines.push('四、文笔六维基线带（μ±σ，按章节测）');
            if (baseline && baselineChapterCount > 0) {
                const B = baseline;
                const LABELS = METRIC_LABELS;
                for (const k of METRIC_ORDER) {
                    const bb = B[k];
                    if (!bb)
                        continue;
                    lines.push(`  ${LABELS[k]} μ=${bb.mu} σ=${bb.sigma}（带 ${bb.low} ~ ${bb.high}，推荐容差 ±${bb.recTol ?? 15}%）`);
                }
                lines.push('  用途：新章六维应落在带内；novel_style_check 默认按推荐容差判定');
            }
            else
                lines.push('  （测量失败：章节正文过短或缺失）');
            lines.push('');
            lines.push('五、未移植维度（需本地 embedding/题材检测引擎）');
            lines.push('  文化基准 / 题材流派 / 氛围光谱 12 轴 / 语义距离——本次报告不含，判断请结合以上统计维度。');
            lines.push('');
            lines.push('── 以上全部为插件测量数据，不包含任何风格判断 ──');
            lines.push('请结合统计维度判断本书的风格气质、读者感受与写法特征。');
            const report = lines.join('\n');
            let briefOut;
            if (a.brief === true && baseline) {
                const B2 = baseline;
                const dims = METRIC_ORDER.filter((k) => B2[k] && typeof B2[k].mu === 'number');
                briefOut = `全书 ${textAll.length} 字：六维基线 μ=` + dims.map((k) => `${k}:${B2[k].mu?.toFixed(1)}`).join(' ') + '；推荐容差 ' + dims.slice(0, 3).map((k) => B2[k].recTol + '%').join('/') + '…。';
            }
            const dimensions = {
                fingerprint: analysis.fingerprint, avgSentenceLength: lens?.avg,
                emotion: emo?.cleanDominant ?? emo?.dominant, keywords: kw.map((k) => k.word).slice(0, 8),
            };
            return unk({
                projectId: a.projectId, chars: textAll.replace(/\s/g, '').length, report,
                brief: briefOut, dimensions, baseline, baselineChapterCount,
                message: '风格画像报告已生成（仅统计维度测量数据，判断请由 AI 完成）',
            });
        },
    }));
    return tools;
}
function buildBrief(scope, r) {
    const cats = (Array.isArray(r.categories) ? r.categories : []).slice().sort((x, y) => (y.count ?? 0) - (x.count ?? 0)).slice(0, 3);
    const len = r.lengths;
    const emo = r.emotion;
    const top3 = cats.map((c) => `${c.label ?? '?'} ${Math.round((c.ratio ?? 0) * 100)}%`).join('、');
    const ellipsisRatio = (Array.isArray(r.categories) ? r.categories : []).find((c) => c.type === 'ellipsis')?.ratio ?? 0;
    return `${scope} ${r.totalSentences} 句：句式以 ${top3 || '—'} 为主；均句长 ${len?.avg?.toFixed(1) ?? '-'}；主导情绪 ${emo?.dominant ?? '-'}。` + (ellipsisRatio > 0.2 ? '留白较多，注意节奏' : '');
}
function isEmptyMetric(m) {
    return Object.values(m).every((v) => v === 0);
}
function formatConfig(v) {
    const lines = [];
    lines.push(`enabled: ${v.enabled === false ? 'off' : 'on'}`);
    lines.push(`autoAnalyze: ${v.autoAnalyze === false ? 'off' : 'on'}`);
    if (v.source)
        lines.push(`source: ${String(v.source)}`);
    const tools = v.tools;
    if (tools && Object.keys(tools).length > 0) {
        lines.push('tools: ' + Object.entries(tools).map(([k, val]) => `${k}=${val === false ? 'off' : 'on'}`).join(' '));
    }
    const features = v.features;
    if (features && Object.keys(features).length > 0) {
        lines.push('features: ' + Object.entries(features).map(([k, val]) => `${k}=${val === false ? 'off' : 'on'}`).join(' '));
    }
    if (typeof v.message === 'string' && v.message)
        lines.push(String(v.message));
    return lines.join('\n');
}
//# sourceMappingURL=analysis-tools.js.map