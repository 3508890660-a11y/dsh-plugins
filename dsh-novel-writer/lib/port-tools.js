/**
 * 移植工具组（第二批）：novel_plot / novel_settings / novel_summary / novel_outline /
 * novel_continuity_check / novel_semantic_search / novel_import / novel_new_chapter。
 *
 * 数据模型适配：旧版按文件系统（root/novels/<书>/*.md + root/.novel-writer/），
 * 本插件按项目（projectId）持久化。各工具以 projectId（或 import 的 src 文件夹）定位，
 * 章节正文经 store.readChapterContent(projectId, chapterId) 读取。
 * 每项目的侧车数据存于 store.projectDir(projectId) 下：
 *   - plots.json          → 伏笔登记（novel_plot）
 *   - settings.json       → 五张设定表（novel_settings）
 *   - summaries.json      → 章节摘要（novel_summary）
 *   - 创作资料/*.md        → 创作设定/人物/大纲/钩子/状态卡（novel_outline）
 *   - audits/             → 连贯性审计报告（novel_continuity_check）
 * 语义索引复用 embedding.js 的 cachePath（<dataDir>/.novel-writer/embedding/）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { nowIso, uid } from './types.js';
import { analyzeText, valenceStats } from './legacy/analysis.js';
import * as embedding from './legacy/embedding.js';
import { computeVibe } from './legacy/vibe.js';
import { CULTURE_MARKERS, GENRE_MARKERS, THEME_MARKERS, DEFAULT_BANNED_WORDS, SPEECH_STYLE_RULES, } from './legacy/markers.js';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, statSync, rmSync, } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
const text = (t) => [{ type: 'text', text: t }];
/** 宽松转换：output.schema 的 JSON 类型与 TS 字面量对象不完全相容，用 unknown 中转。 */
const unk = (v) => v;
const CHAPTER_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const LEADING_NUMBER = /^第?(\d+)[章回话]?[\s._\-—]*/;
const CJK_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const IMPORT_NOISE = new Set(['原稿件', '单章', '调教计划', '未命名', '新建文档', '草稿', '无题', '正文', '手稿']);
/* ───────────────── 通用小工具 ───────────────── */
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
function requiredString(args, key) {
    const value = args?.[key];
    assert(typeof value === 'string' && value.trim() !== '', `参数 "${key}" 不能为空字符串`);
    return value.trim();
}
function optionalString(args, key) {
    const value = args?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : void 0;
}
function sanitizeSegment(value, label) {
    let cleaned = String(value ?? '').replace(/[\\/:*?"<>|]/g, '').replace(/[.\s]+$/g, '').replace(/^[.\s]+/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned))
        cleaned = '_' + cleaned;
    assert(cleaned.length > 0 && !['', '.', '..'].includes(cleaned), `参数 ${label} 含非法路径字符`);
    return cleaned;
}
function cjkToNumber(textValue) {
    const s = String(textValue).trim();
    if (s === '')
        return void 0;
    let total = 0;
    let section = 0;
    let hasUnit = false;
    for (const ch of s) {
        if (ch === '十') {
            total += (section === 0 ? 1 : section) * 10;
            section = 0;
            hasUnit = true;
        }
        else if (ch === '百') {
            total += (section === 0 ? 1 : section) * 100;
            section = 0;
            hasUnit = true;
        }
        else if (ch in CJK_DIGITS) {
            section = section * 10 + CJK_DIGITS[ch];
        }
        else
            return void 0;
    }
    if (!hasUnit && section === 0)
        return void 0;
    return total + section;
}
function parseChapterNumber(name) {
    const stem = String(name).replace(/\.[^.]+$/, '');
    const arabicMark = /第?(\d{1,4})[章回话]/.exec(stem);
    if (arabicMark)
        return Number(arabicMark[1]);
    const sepMark = /[-._\s](\d{1,4})[-._\s]/.exec(stem);
    if (sepMark)
        return Number(sepMark[1]);
    const leading = LEADING_NUMBER.exec(stem);
    if (leading)
        return Number(leading[1]);
    const cjkMark = /第([零一二三四五六七八九十百两]+)[章回话]/.exec(stem);
    if (cjkMark) {
        const n = cjkToNumber(cjkMark[1]);
        if (n !== void 0)
            return n;
    }
    return void 0;
}
/** 章节标识归一（2/02/第2章/第二章/第02章.md → 第02章）——novel_summary 存查同键。 */
function normalizeChapterKey(c) {
    const s = String(c ?? '').trim().replace(/\.md$/i, '').replace(/^#+\s*/, '');
    const m = s.match(/第?(\d{1,4}|[零一二三四五六七八九十百两]+)[章回话节]/);
    if (m) {
        let n;
        if (/^\d+$/.test(m[1]))
            n = Number(m[1]);
        else
            n = cjkToNumber(m[1]);
        if (n !== void 0 && Number.isInteger(n))
            return '第' + String(n).padStart(2, '0') + '章';
    }
    const m2 = s.match(/^(\d{1,4})[-._\s]/);
    if (m2)
        return '第' + String(Number(m2[1])).padStart(2, '0') + '章';
    const m3 = s.match(/^(\d{1,4})$/);
    if (m3)
        return '第' + String(Number(m3[1])).padStart(2, '0') + '章';
    return s;
}
function chapterRows(data) {
    // 排序：卷序 → 卷内 order → 未挂卷（按 order）。多卷项目章 order 是卷内序号。
    const vols = data.outline.filter(n => n.type === 'volume').sort((a, b) => a.order - b.order);
    const keyOf = (c) => {
        const node = data.outline.find(n => n.id === c.id && n.type === 'chapter');
        if (node && node.parentId) {
            const vi = vols.findIndex(v => v.id === node.parentId);
            if (vi >= 0)
                return [0, vi, c.order];
        }
        return [1, 0, c.order];
    };
    return data.chapters.slice().sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    }).map((c) => {
        const num = String(c.order ?? '').padStart(2, '0');
        return { id: c.id, title: c.title, order: c.order, file: c.title ? `第${num}章 ${c.title}` : `第${num}章` };
    });
}
/** 章节引用解析：id 全等 / 章号数字 / 标题子串。 */
function resolveChapter(data, chapterArg) {
    const rows = chapterRows(data);
    const asNumber = parseChapterNumber(chapterArg);
    const hit = rows.find((c) => c.id === chapterArg || c.title === chapterArg || c.title.includes(chapterArg) ||
        String(c.order) === chapterArg || (asNumber !== void 0 && c.order === asNumber));
    assert(hit, `在项目 "${data.project.name}" 中找不到章节 "${chapterArg}"（可用章号/标题子串/章节 id）`);
    return hit;
}
function allChapterText(store, projectId, rows) {
    let out = '';
    for (const r of rows)
        out += store.readChapterContent(projectId, r.id);
    return out;
}
/* ───────────────── 原子 JSON 落盘 ───────────────── */
function atomicWriteJson(file, obj) {
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
    writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    try {
        renameSync(tmp, file);
    }
    catch (e) {
        try {
            writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
        }
        catch { /* 忽略 */ }
        try {
            rmSync(tmp, { force: true });
        }
        catch { /* 忽略 */ }
    }
}
/* ───────────────── 文化/流派/题材检测（源自 markers） ───────────────── */
function detectCulture(fullText) {
    const scores = { western: 0, eastern: 0, modern: 0 };
    const evidence = { western: [], eastern: [], modern: [] };
    for (const [culture, table] of Object.entries(CULTURE_MARKERS)) {
        const seen = new Set();
        const sorted = table.words.slice().sort((a, b) => b.length - a.length);
        let scanText = fullText;
        for (const word of sorted) {
            if (seen.has(word))
                continue;
            seen.add(word);
            let n = 0;
            let from = 0;
            while ((from = scanText.indexOf(word, from)) !== -1) {
                n += 1;
                scanText = scanText.slice(0, from) + '\u0000'.repeat(word.length) + scanText.slice(from + word.length);
                from += word.length;
            }
            if (n > 0) {
                scores[culture] += n;
                if (evidence[culture].length < 8)
                    evidence[culture].push(word + '×' + n);
            }
        }
    }
    const total = scores.western + scores.eastern + scores.modern;
    let culture = 'unknown';
    let confidence = 0;
    if (total > 0) {
        const cultureTotal = scores.western + scores.eastern;
        if (scores.modern >= 5 && scores.modern >= Math.max(scores.western, scores.eastern, 1)) {
            culture = 'modern';
            confidence = Math.min(0.95, 0.5 + scores.modern / (total * 2));
        }
        else if (cultureTotal > 0) {
            const ratio = scores.western / Math.max(scores.eastern, 1);
            if (ratio >= 2) {
                culture = 'western';
                confidence = Math.min(0.95, 0.5 + scores.western / (total * 2));
            }
            else if (ratio <= 0.5) {
                culture = 'eastern';
                confidence = Math.min(0.95, 0.5 + scores.eastern / (total * 2));
            }
            else {
                culture = 'mixed';
                confidence = 0.5;
            }
        }
        else {
            culture = 'modern';
            confidence = Math.min(0.95, 0.5 + scores.modern / (total * 2));
        }
    }
    return { culture, confidence: Math.round(confidence * 100) / 100, scores, evidence, total };
}
function detectGenreFromText(fullText) {
    const hits = {};
    const evidence = {};
    for (const [genre, words] of Object.entries(GENRE_MARKERS)) {
        let count = 0;
        const found = [];
        const sorted = words.slice().sort((x, y) => y.length - x.length);
        let scanText = fullText;
        for (const word of sorted) {
            let n = 0;
            let from = 0;
            while ((from = scanText.indexOf(word, from)) !== -1) {
                n += 1;
                scanText = scanText.slice(0, from) + '\u0000'.repeat(word.length) + scanText.slice(from + word.length);
                from += word.length;
            }
            if (n > 0) {
                count += n;
                if (found.length < 6)
                    found.push(word + '×' + n);
            }
        }
        if (count > 0) {
            hits[genre] = count;
            evidence[genre] = found;
        }
    }
    const filtered = Object.entries(hits).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);
    return { dominant: filtered[0]?.[0] ?? null, genres: filtered.slice(0, 3).map(([g, n]) => ({ genre: g, count: n })), evidence };
}
function detectThemeFromText(fullText) {
    const hits = {};
    const evidence = {};
    for (const [theme, words] of Object.entries(THEME_MARKERS)) {
        let count = 0;
        const found = [];
        const sorted = words.slice().sort((x, y) => y.length - x.length);
        let scanText = fullText;
        for (const word of sorted) {
            let n = 0;
            let from = 0;
            while ((from = scanText.indexOf(word, from)) !== -1) {
                n += 1;
                scanText = scanText.slice(0, from) + '\u0000'.repeat(word.length) + scanText.slice(from + word.length);
                from += word.length;
            }
            if (n > 0) {
                count += n;
                if (found.length < 6)
                    found.push(word + '×' + n);
            }
        }
        if (count > 0) {
            hits[theme] = count;
            evidence[theme] = found;
        }
    }
    const filtered = Object.entries(hits).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);
    return { dominant: filtered[0]?.[0] ?? null, secondary: filtered[1]?.[0] ?? null, themes: filtered.slice(0, 5).map(([t, n]) => ({ theme: t, count: n })), evidence };
}
function settingsFile(projectDir) { return join(projectDir, 'settings.json'); }
function readSettingsData(projectDir) {
    try {
        const parsed = JSON.parse(readFileSync(settingsFile(projectDir), 'utf8'));
        return {
            characters: Array.isArray(parsed.characters) ? parsed.characters : [],
            locations: Array.isArray(parsed.locations) ? parsed.locations : [],
            items: Array.isArray(parsed.items) ? parsed.items : [],
            timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
            worldview: Array.isArray(parsed.worldview) ? parsed.worldview : [],
        };
    }
    catch {
        return { characters: [], locations: [], items: [], timeline: [], worldview: [] };
    }
}
function writeSettingsData(projectDir, data) {
    mkdirSync(projectDir, { recursive: true });
    atomicWriteJson(settingsFile(projectDir), data);
}
function normalizeSettingEntry(entry) {
    const out = { name: String(entry.name) };
    for (const key of ['description', 'traits', 'relationships', 'firstSeen', 'notes', 'owner', 'status', 'lastSeen', 'day', 'event', 'chapter', 'basis', 'ritual']) {
        if (entry[key] !== void 0 && entry[key] !== null)
            out[key] = String(entry[key]);
    }
    for (const key of ['alias', 'bannedWords']) {
        if (Array.isArray(entry[key]))
            out[key] = entry[key].map(String);
    }
    if (entry.recommended !== void 0 && entry.recommended !== null && typeof entry.recommended === 'object')
        out.recommended = { ...entry.recommended };
    if (entry.speechStyle !== void 0 && entry.speechStyle !== null && typeof entry.speechStyle === 'object') {
        const sp = entry.speechStyle;
        const speech = {};
        if (typeof sp.title === 'string')
            speech.title = sp.title;
        if (typeof sp.tone === 'string')
            speech.tone = sp.tone;
        if (Array.isArray(sp.honorBad))
            speech.honorBad = sp.honorBad.map(String);
        if (sp.honorGood !== void 0 && typeof sp.honorGood === 'object')
            speech.honorGood = { ...sp.honorGood };
        if (Array.isArray(sp.ritualBadPatterns))
            speech.ritualBadPatterns = sp.ritualBadPatterns.map((x) => String(x));
        if (typeof sp.ritualGoodNote === 'string')
            speech.ritualGoodNote = sp.ritualGoodNote;
        out.speechStyle = speech;
    }
    return out;
}
function plotsFile(projectDir) { return join(projectDir, 'plots.json'); }
function readPlots(projectDir) {
    try {
        const parsed = JSON.parse(readFileSync(plotsFile(projectDir), 'utf8'));
        return Array.isArray(parsed?.entries) ? parsed.entries : [];
    }
    catch {
        return [];
    }
}
function writePlots(projectDir, entries) {
    mkdirSync(projectDir, { recursive: true });
    atomicWriteJson(plotsFile(projectDir), { entries });
}
/** 从伏笔内容提取 2-4 字中文关键词（用于 scan 提及检测）。 */
function plotKeywords(content) {
    const t = String(content).replace(/[^\u4e00-\u9fff]/g, '');
    const stop = new Set('的了是在我有和就都不一一个这那与及或但是因为所以如果然后而且并且什么怎么自己她们他们你们我们咱们没有不是别莫未'.split(''));
    const keywords = [];
    for (const length of [4, 3, 2]) {
        for (let i = 0; i + length <= t.length; i += 1) {
            const sub = t.slice(i, i + length);
            const nonStop = [...sub].filter((ch) => !stop.has(ch)).length;
            if (nonStop >= Math.ceil(length * 0.6))
                keywords.push(sub);
        }
    }
    return [...new Set(keywords)].sort((a, b) => b.length - a.length).slice(0, 8);
}
function normalizePlotEntry(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.content !== 'string')
        return null;
    const out = { id: entry.id, content: entry.content, status: entry.status === 'done' ? 'done' : 'open' };
    for (const key of ['chapter', 'note', 'payoffCondition', 'lastMentioned', 'type', 'priority']) {
        if (entry[key] !== void 0 && entry[key] !== null)
            out[key] = String(entry[key]);
    }
    for (const key of ['relatedCharacters', 'locations', 'mentionedIn']) {
        if (Array.isArray(entry[key]))
            out[key] = entry[key].map((x) => String(x));
    }
    if (entry.createdAt !== void 0)
        out.createdAt = entry.createdAt;
    if (entry.updatedAt !== void 0)
        out.updatedAt = entry.updatedAt;
    return out;
}
function summariesFile(projectDir) { return join(projectDir, 'summaries.json'); }
function readSummaries(projectDir) {
    try {
        const parsed = JSON.parse(readFileSync(summariesFile(projectDir), 'utf8'));
        return Array.isArray(parsed?.summaries) ? parsed.summaries : [];
    }
    catch {
        return [];
    }
}
/* ───────────────── 创作资料（novel_outline） ───────────────── */
const CREATION_DIR_NAME = '创作资料';
const CREATION_FILES = {
    bible: '创作设定.md', 'characters-main': '主要人物设定.md', 'characters-minor': '次要人物设定.md',
    outline: '剧情大纲.md', hooks: '钩子记录.md', status: '创作状态卡.md',
};
function creationDir(projectDir) { return join(projectDir, CREATION_DIR_NAME); }
function creationTemplate(fileKey) {
    const header = `# ${CREATION_FILES[fileKey]}\n\n<!-- 创作资料（novel_outline）：请在下方维护。 -->\n`;
    if (fileKey === 'bible')
        return header;
    if (fileKey === 'characters-main')
        return header + '\n- 主角：\n';
    if (fileKey === 'characters-minor')
        return header + '\n- （次要人物）\n';
    if (fileKey === 'outline')
        return header + '\n<!-- 每行格式：- <章号> <本章方向/一句话梗概> -->\n';
    if (fileKey === 'hooks')
        return header + '\n<!-- 每行格式：- <章号> <本章结尾钩子> -->\n';
    return header + '\n当前状态：\n';
}
function upsertCreationSection(originalText, section, marker) {
    const re = new RegExp('(?:\\n\\n)?' + marker + '[\\s\\S]*?(?=\\n# |\\n\\n|\\s*$)');
    const has = originalText.includes(marker);
    if (section === '') {
        if (!has)
            return originalText;
        return originalText.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    }
    if (has)
        return originalText.replace(re, '\n\n' + section.trimEnd());
    return originalText.trimEnd() + '\n\n' + section;
}
/* ───────────────── 稿件导入（novel_import）帮助 ───────────────── */
function bookNameFromFileName(fileName) {
    const stem = fileName.replace(/\.[^.]+$/, '');
    const chapterMark = stem.match(/第?(\d{1,4}|[零一二三四五六七八九十百两]+)[章回话节]?[\s._\-—~]/);
    const head = chapterMark ? stem.slice(0, chapterMark.index).trim() : stem;
    const parts = head
        .replace(/第?(\d{1,4})[章回话]/g, ' ')
        .replace(/第[零一二三四五六七八九十百两]+[章回话]/g, ' ')
        .replace(LEADING_NUMBER, ' ')
        .split(/[\s._\-—~]+/)
        .map((p) => p.trim())
        .filter((p) => p !== '' && !IMPORT_NOISE.has(p));
    const name = parts.join(' ').trim();
    const startsWithChapter = /^第?(\d{1,4}|[零一二三四五六七八九十百两]+)([章回话节]|[-._\s])/.test(stem);
    return (name === '' || (startsWithChapter && parts.length <= 2)) ? void 0 : name;
}
function bookNameFromContent(content) {
    const lines = String(content).split(/\r?\n/).slice(0, 12);
    for (const raw of lines) {
        const line = raw.replace(/^#+\s*/, '').replace(/^\uFEFF/, '').trim();
        if (line === '')
            continue;
        if (IMPORT_NOISE.has(line))
            continue;
        const bookMatch = line.match(/[《〈]\s*([^》〉]{2,30}?)\s*[》〉]/);
        if (bookMatch) {
            const name = bookMatch[1].trim();
            if (name.length >= 2 && name.length <= 30)
                return name;
            continue;
        }
        const hasChapterMark = /第?(\d{1,4})[章回话]|第[零一二三四五六七八九十百两]+[章回话]|^\d{1,4}[-._\s]/.test(line);
        if (hasChapterMark)
            continue;
    }
    return void 0;
}
function collectTextFiles(dir, recursive, out = [], prefix = '') {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const rel = prefix === '' ? entry.name : prefix + '/' + entry.name;
        if (entry.isDirectory()) {
            if (recursive)
                collectTextFiles(join(dir, entry.name), recursive, out, rel);
        }
        else if (entry.isFile() && CHAPTER_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            out.push(rel);
        }
    }
    return out;
}
function decodeTextBuffer(buf, filePath) {
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
        return buf.subarray(3).toString('utf8');
    if (buf.length >= 2) {
        if (buf[0] === 0xff && buf[1] === 0xfe)
            return buf.subarray(2).toString('utf16le');
        if (buf[0] === 0xfe && buf[1] === 0xff)
            return new TextDecoder('utf-16be').decode(buf.subarray(2));
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    }
    catch { /* 继续 */ }
    let evenNul = 0, oddNul = 0;
    for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 0) {
            if (i % 2 === 0)
                evenNul += 1;
            else
                oddNul += 1;
        }
    }
    const nulRatio = (evenNul + oddNul) / Math.max(buf.length, 1);
    if (nulRatio > 0.05)
        return oddNul >= evenNul ? new TextDecoder('utf-16le').decode(buf) : new TextDecoder('utf-16be').decode(buf);
    const gbk = new TextDecoder('gbk').decode(buf);
    if (!gbk.includes('\uFFFD'))
        return gbk;
    throw new Error(`cannot detect text encoding of "${filePath}": 不是有效的 UTF-8/UTF-16/GBK，请将文件另存为 UTF-8 编码`);
}
function formatImport(value) {
    const lines = [`<path>${value.src}</path>`, `<type>novel-import-${value.mode}</type>`, '<content>', ''];
    lines.push(`扫描结果：${value.groups.reduce((n, g) => n + g.files.length, 0)} 个文件 → ${value.groups.length} 组` + (value.skipped.length > 0 ? `（跳过 ${value.skipped.length} 个无法读取的文件）` : ''));
    for (const group of value.groups) {
        const from = group.from === 'file' ? '文件名' : group.from === 'content' ? '文件头内容' : group.from === 'forced' ? '强制指定' : '未分类';
        lines.push('', `[${group.book}] (来自${from}, ${group.files.length} 个文件)`);
        for (const f of group.files) {
            const ch = f.chapter === void 0 ? '?' : `第${f.chapter}章`;
            lines.push(`  - ${ch} ${f.file}`);
        }
    }
    if (value.imported.length > 0) {
        lines.push('', `已导入 ${value.imported.length} 个文件：`);
        for (const item of value.imported)
            lines.push(`  - ${item.project}/${item.file}`);
    }
    lines.push('', '</content>');
    return lines.join('\n');
}
/* ───────────────── 时间跳词表（novel_continuity_check 衔接用） ───────────────── */
const TIME_JUMP_WORDS = {
    hard: ['第二天', '第三天', '第四天', '第五天', '三天后', '四天后', '五天后', '六天后', '七天后', '十天后', '数天后', '一周后', '两周后', '半个月后', '一个月后', '两个月后', '三个月后', '半年后', '一年后', '两年后', '三年后', '多年后', '数日后', '几天后', '几天前', '几年后', '不久后', '很久以后'],
    soft: ['次日', '翌日', '次日清晨', '次日黄昏', '隔天', '深夜', '黎明', '清晨', '黄昏', '午夜', '当天晚上', '当晚'],
};
/** 每项目的侧车数据目录（dataDir/projects/<projectId>/）。Store.projectDir 为 private，故此处由 dataDir 推导。 */
function projectDirOf(dataDir, projectId) {
    return join(dataDir, 'projects', projectId);
}
/* ───────────────── 工具集构造 ───────────────── */
export function buildPortTools(ctx) {
    const { store, dataDir } = ctx;
    const tools = [];
    /* ── 1. novel_plot：伏笔/剧情线登记表 ── */
    tools.push(defineTool({
        name: 'novel_plot',
        description: '伏笔/剧情线登记表：维护某部作品（项目）的伏笔与剧情钩子（open 待回收 / done 已回收）。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            action: { type: 'string', enum: ['list', 'add', 'update', 'done', 'delete', 'scan'], description: 'list=查看；add=登记新伏笔；update=修改；done=标记已回收；delete=删除；scan=扫描章节文本，自动更新伏笔提及章节。' },
            id: { type: 'string', description: '伏笔 id（update/done/delete 时需要）。' },
            content: { type: 'string', description: 'add/update 时：伏笔内容描述。' },
            chapter: { type: 'string', description: '可选：伏笔出现的章节。' },
            note: { type: 'string', description: '可选：备注（如何回收/何时回收）。' },
            type: { type: 'string', enum: ['剧情', '设定', '道具', '人物', '其他'], description: '可选：伏笔类型。' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '可选：优先级。' },
            relatedCharacters: { type: 'array', items: { type: 'string' }, description: '可选：关联人物。' },
            locations: { type: 'array', items: { type: 'string' }, description: '可选：关联地点。' },
            payoffCondition: { type: 'string', description: '可选：回收条件。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    entries: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true }, content: { type: 'string', required: true },
                                chapter: { type: 'string' }, note: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' },
                                relatedCharacters: { type: 'array', items: { type: 'string' } }, locations: { type: 'array', items: { type: 'string' } },
                                payoffCondition: { type: 'string' }, mentionedIn: { type: 'array', items: { type: 'string' } }, lastMentioned: { type: 'string' },
                                status: { type: 'string', enum: ['open', 'done'], required: true },
                                createdAt: { type: 'string' }, updatedAt: { type: 'string' },
                            },
                        },
                    },
                    message: { type: 'string' },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`<path>${r.projectId}</path>`, '<type>novel-plot</type>', '<content>', ''];
                if (r.message)
                    lines.push(r.message);
                const open = r.entries.filter((e) => e.status === 'open');
                const done = r.entries.filter((e) => e.status === 'done');
                lines.push(`未回收伏笔 ${open.length} 条：`);
                if (open.length === 0)
                    lines.push('  （无）');
                for (const e of open) {
                    const tags = [e.type, e.priority, e.chapter ? '出自 ' + e.chapter : '', e.payoffCondition ? '回收:' + e.payoffCondition : '', e.lastMentioned ? '最近提及:' + e.lastMentioned : ''].filter(Boolean).join(' | ');
                    lines.push(`  - [${e.id}] ${e.content}${tags ? '（' + tags + '）' : ''}${e.note ? '｜' + e.note : ''}`);
                }
                if (done.length > 0) {
                    lines.push(`已回收 ${done.length} 条：`);
                    for (const e of done)
                        lines.push(`  - [${e.id}] ${e.content}`);
                }
                lines.push('', '</content>');
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const project = store.load(a.projectId);
            const projectDir = projectDirOf(dataDir, a.projectId);
            const action = ['add', 'update', 'done', 'delete', 'scan'].includes(a.action ?? '') ? a.action : 'list';
            let entries = readPlots(projectDir);
            let lastPlotId;
            const now = nowIso();
            let message = '';
            if (action === 'add') {
                const content = optionalString(a, 'content');
                assert(content !== void 0, 'novel_plot add 需要 content 参数');
                const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                const entry = {
                    id, content, status: 'open', createdAt: now, updatedAt: now,
                };
                const ch = optionalString(a, 'chapter');
                if (ch)
                    entry.chapter = ch;
                const note = optionalString(a, 'note');
                if (note)
                    entry.note = note;
                if (['剧情', '设定', '道具', '人物', '其他'].includes(a.type ?? ''))
                    entry.type = a.type;
                if (['high', 'medium', 'low'].includes(a.priority ?? ''))
                    entry.priority = a.priority;
                if (Array.isArray(a.relatedCharacters))
                    entry.relatedCharacters = a.relatedCharacters.map(String);
                if (Array.isArray(a.locations))
                    entry.locations = a.locations.map(String);
                const payoff = optionalString(a, 'payoffCondition');
                if (payoff)
                    entry.payoffCondition = payoff;
                entries.push(entry);
                lastPlotId = id;
                message = `已登记伏笔 #${id}`;
            }
            else if (action === 'scan') {
                const scanChapter = optionalString(a, 'chapter');
                const rows = chapterRows(project);
                assert(rows.length > 0, `作品 "${project.project.name}" 下没有章节文件`);
                const targets = scanChapter !== void 0 ? [resolveChapter(project, scanChapter)] : rows;
                let mentioned = 0;
                for (const chapter of targets) {
                    const chapterText = store.readChapterContent(a.projectId, chapter.id);
                    for (const entry of entries) {
                        if (entry.status !== 'open')
                            continue;
                        const keywords = plotKeywords(String(entry.content ?? ''));
                        if (keywords.length > 0 && keywords.some((k) => chapterText.includes(k))) {
                            const mentionedIn = Array.isArray(entry.mentionedIn) ? entry.mentionedIn : [];
                            if (!mentionedIn.includes(chapter.file)) {
                                entry.mentionedIn = mentionedIn.concat(chapter.file);
                                entry.lastMentioned = chapter.file;
                                entry.updatedAt = now;
                                mentioned += 1;
                            }
                        }
                    }
                }
                message = `扫描 ${targets.length} 章，更新 ${mentioned} 条伏笔的提及记录`;
            }
            else if (action === 'update' || action === 'done' || action === 'delete') {
                const id = optionalString(a, 'id');
                assert(id !== void 0, `novel_plot ${action} 需要 id 参数`);
                lastPlotId = id;
                const index = entries.findIndex((e) => e.id === id);
                assert(index !== -1, `伏笔 #${id} 不存在（可用 novel_plot 查看列表）`);
                if (action === 'delete') {
                    entries.splice(index, 1);
                    message = `已删除伏笔 #${id}`;
                }
                else if (action === 'done') {
                    entries[index].status = 'done';
                    entries[index].updatedAt = now;
                    message = `已标记伏笔 #${id} 为已回收`;
                }
                else {
                    if (a.content !== void 0)
                        entries[index].content = String(a.content);
                    if (a.note !== void 0)
                        entries[index].note = String(a.note);
                    if (a.chapter !== void 0)
                        entries[index].chapter = String(a.chapter);
                    if (['剧情', '设定', '道具', '人物', '其他'].includes(a.type ?? ''))
                        entries[index].type = a.type;
                    if (['high', 'medium', 'low'].includes(a.priority ?? ''))
                        entries[index].priority = a.priority;
                    if (Array.isArray(a.relatedCharacters))
                        entries[index].relatedCharacters = a.relatedCharacters.map(String);
                    if (Array.isArray(a.locations))
                        entries[index].locations = a.locations.map(String);
                    if (a.payoffCondition !== void 0)
                        entries[index].payoffCondition = String(a.payoffCondition);
                    entries[index].updatedAt = now;
                    message = `已更新伏笔 #${id}`;
                }
            }
            if (action !== 'list')
                writePlots(projectDir, entries);
            let cleanEntries = entries.map((e) => normalizePlotEntry(e)).filter((e) => e !== null);
            cleanEntries.sort((a, b) => (a.status === b.status ? String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) : a.status === 'open' ? -1 : 1));
            if (action === 'add' || action === 'update') {
                const target = cleanEntries.find((e) => e.id === lastPlotId);
                return unk({ projectId: a.projectId, action, entries: target ? [target] : [], ...(message ? { message } : {}) });
            }
            return unk({ projectId: a.projectId, action, entries: cleanEntries, ...(message ? { message } : {}) });
        },
    }));
    /* ── 2. novel_settings：五张设定表 ── */
    const CATEGORY_LABEL_MAP = { character: '人物卡', location: '地点卡', item: '道具清单', timeline: '时间线', worldview: '世界观/用语规范' };
    const CATEGORY_LIST_KEY = { character: 'characters', location: 'locations', item: 'items', timeline: 'timeline', worldview: 'worldview' };
    tools.push(defineTool({
        name: 'novel_settings',
        description: '设定管理（五张表：人物/地点/道具/时间线/世界观用语规范），list/add/update/delete/scan 按 category 维护，detect 自动判断文化基准。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            category: { type: 'string', enum: ['character', 'location', 'item', 'timeline', 'worldview'], description: '表类别。detect 固定 worldview。' },
            action: { type: 'string', enum: ['list', 'add', 'update', 'delete', 'scan', 'detect'], description: 'list=查看；add=登记；update=修改；delete=删除；scan=扫描章节提取候选；detect=自动判断世界观文化基准。' },
            name: { type: 'string', description: '条目名（人物名/地名/道具名；timeline 用 day）。' },
            description: { type: 'string', description: '可选：描述。' },
            traits: { type: 'string', description: 'character 专用：性格/外貌。' },
            relationships: { type: 'string', description: 'character 专用：人际关系。' },
            alias: { type: 'array', items: { type: 'string' }, description: 'character 专用：别名。' },
            firstSeen: { type: 'string', description: '可选：首次出现章节。' },
            owner: { type: 'string', description: 'item 专用：当前持有者。' },
            status: { type: 'string', description: 'item 专用：状态。' },
            lastSeen: { type: 'string', description: 'item 专用：最近出现章节。' },
            day: { type: 'string', description: 'timeline 专用：时间点。' },
            event: { type: 'string', description: 'timeline 专用：事件。' },
            chapter: { type: 'string', description: 'timeline 专用：对应章节。' },
            notes: { type: 'string', description: '可选：备注。' },
            basis: { type: 'string', description: 'worldview 专用：判断依据/文化基准说明。' },
            ritual: { type: 'string', description: 'worldview 专用：仪式规范。' },
            speechStyle: { type: 'object', additionalProperties: true, description: 'worldview 专用：说话方式规范。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    category: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    characters: { type: 'array', items: { type: 'json' } },
                    locations: { type: 'array', items: { type: 'json' } },
                    items: { type: 'array', items: { type: 'json' } },
                    timeline: { type: 'array', items: { type: 'json' } },
                    worldview: { type: 'array', items: { type: 'json' } },
                    total: { type: 'integer' },
                    culture: { type: 'string' }, confidence: { type: 'number' },
                    scores: { type: 'object', additionalProperties: true }, evidence: { type: 'object', additionalProperties: true }, totalHits: { type: 'integer' },
                    genre: { type: 'object', additionalProperties: true }, theme: { type: 'object', additionalProperties: true },
                    candidates: { type: 'array', items: { type: 'string' } },
                    message: { type: 'string' },
                    vibe: { type: 'object', additionalProperties: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`<path>${String(r.projectId)}</path>`, '<type>novel-settings</type>', '<content>', ''];
                if (r.message)
                    lines.push(String(r.message));
                const categoryLabel = CATEGORY_LABEL_MAP[String(r.category)] ?? String(r.category);
                const list = (r.characters ?? r.locations ?? r.items ?? r.timeline ?? r.worldview ?? []);
                lines.push(`${categoryLabel}（${list.length} 条）：`);
                for (const e of list) {
                    const dayPart = e.day ? String(e.day) + (e.event ? ' ' + e.event : '') : (e.event || '');
                    const extra = [e.traits, e.description, e.relationships, e.owner, e.status, e.lastSeen, dayPart, e.basis, e.ritual,
                        Array.isArray(e.bannedWords) ? '禁用词:' + e.bannedWords.join('/') : '',
                        e.recommended ? '替代:' + Object.entries(e.recommended).map(([k, val]) => k + '→' + val).join('/') : ''].filter(Boolean).join(' | ');
                    lines.push(`  - ${String(e.name ?? '')}${extra ? '：' + extra : ''}${e.chapter ? '（' + e.chapter + '）' : ''}`);
                }
                if (r.culture && r.evidence) {
                    const ev = r.evidence;
                    lines.push(`判断结果：${String(r.message ?? r.culture)}（西${r.scores?.western ?? 0} / 东${r.scores?.eastern ?? 0}）`);
                    lines.push('证据：' + (ev.western ?? []).slice(0, 5).join(' ') + ' | ' + (ev.eastern ?? []).slice(0, 5).join(' '));
                }
                if (Array.isArray(r.candidates) && r.candidates.length > 0) {
                    lines.push('', '扫描候选（供登记）：');
                    for (const cand of r.candidates)
                        lines.push('  ? ' + cand);
                }
                const vibe = r.vibe;
                if (vibe && Array.isArray(vibe.axes) && vibe.axes.length > 0) {
                    lines.push('', '🎭 氛围光谱（v2.1.0）：');
                    for (const ax of vibe.axes.slice(0, 5)) {
                        const bar = '█'.repeat(Math.round((ax.score ?? 0) * 12)).padEnd(12, '░');
                        lines.push('  ' + ax.name.padEnd(5) + ' ' + bar + ' ' + (ax.score ?? 0).toFixed(2));
                    }
                    if (vibe.conclusion)
                        lines.push('  结论：' + vibe.conclusion + '（置信度 ' + vibe.confidence + '）');
                    if (Array.isArray(vibe.evidence) && vibe.evidence.length > 0)
                        lines.push('  证据：' + vibe.evidence.join(' | '));
                }
                lines.push('', '</content>');
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            store.load(a.projectId);
            const projectDir = projectDirOf(dataDir, a.projectId);
            const isDetect = a.action === 'detect';
            const category = isDetect ? 'worldview' : (['character', 'location', 'item', 'timeline', 'worldview'].includes(a.category ?? '') ? a.category : 'character');
            const action = ['add', 'update', 'delete', 'scan', 'detect'].includes(a.action ?? '') ? a.action : 'list';
            const data = readSettingsData(projectDir);
            const categoryLabel = CATEGORY_LABEL_MAP[category] ?? category;
            const listKey = CATEGORY_LIST_KEY[category];
            let message = '';
            let lastSettingName;
            const list = data[listKey];
            if (action === 'add') {
                const name = optionalString(a, 'name') ?? optionalString(a, 'day');
                assert(name !== void 0, 'novel_settings add 需要 name（timeline 用 day）参数');
                const entry = { name };
                if (category === 'timeline')
                    entry.day = name;
                for (const key of ['description', 'traits', 'relationships', 'firstSeen', 'owner', 'status', 'lastSeen', 'event', 'chapter', 'notes', 'basis', 'ritual']) {
                    if (a[key] !== void 0)
                        entry[key] = String(a[key]);
                }
                if (Array.isArray(a.alias))
                    entry.alias = a.alias.map(String);
                if (category === 'worldview' && a.speechStyle === void 0) {
                    const basisText = String(a.basis ?? '');
                    const detected = /中|东|中式|古装|古风|客栈|老爷|少侠|江湖/.test(basisText) ? { culture: 'eastern' }
                        : /west|欧|西式|教廷|教堂|神甫|公爵/.test(basisText) ? { culture: 'western' }
                            : detectCulture(basisText);
                    if (detected.culture === 'eastern') {
                        entry.speechStyle = {
                            title: SPEECH_STYLE_RULES.eastern.titleGuideline,
                            honorBad: SPEECH_STYLE_RULES.eastern.honorBad,
                            honorGood: { ...SPEECH_STYLE_RULES.eastern.honorGood },
                            ritualBadPatterns: SPEECH_STYLE_RULES.eastern.ritualBadPatterns.map((x) => x.source),
                            ritualGoodNote: SPEECH_STYLE_RULES.eastern.ritualGoodNote,
                            tone: SPEECH_STYLE_RULES.eastern.toneGuideline,
                        };
                        if (!entry.ritual)
                            entry.ritual = SPEECH_STYLE_RULES.eastern.ritualGoodNote;
                    }
                }
                if (a.speechStyle !== void 0 && typeof a.speechStyle === 'object') {
                    entry.speechStyle = { ...a.speechStyle };
                }
                else if (category === 'worldview' && /west|欧|西式|教廷|教堂|神甫|公爵/.test(String(a.basis ?? ''))) {
                    entry.speechStyle = {
                        title: SPEECH_STYLE_RULES.western.titleGuideline,
                        honorBad: SPEECH_STYLE_RULES.western.honorBad,
                        honorGood: { ...SPEECH_STYLE_RULES.western.honorGood },
                        ritualBadPatterns: SPEECH_STYLE_RULES.western.ritualBadPatterns.map((x) => x.source),
                        ritualGoodNote: SPEECH_STYLE_RULES.western.ritualGoodNote,
                        tone: SPEECH_STYLE_RULES.western.toneGuideline,
                    };
                    if (!entry.ritual)
                        entry.ritual = SPEECH_STYLE_RULES.western.ritualGoodNote;
                }
                list.push(entry);
                lastSettingName = entry.name;
                message = `已登记 ${categoryLabel}：${name}`;
                writeSettingsData(projectDir, data);
                const result = { projectId: a.projectId, category, action, message };
                result[listKey] = [normalizeSettingEntry(entry)];
                return unk(result);
            }
            else if (action === 'update' || action === 'delete') {
                const name = optionalString(a, 'name') ?? optionalString(a, 'day');
                assert(name !== void 0, `novel_settings ${action} 需要 name（timeline 用 day）参数`);
                const index = list.findIndex((e) => e.name === name || (category === 'timeline' && e.day === name));
                assert(index !== -1, `${categoryLabel}中不存在「${name}」`);
                if (action === 'delete') {
                    list.splice(index, 1);
                    message = `已删除 ${categoryLabel}：${name}`;
                }
                else {
                    for (const key of ['description', 'traits', 'relationships', 'firstSeen', 'owner', 'status', 'lastSeen', 'event', 'chapter', 'notes', 'basis', 'ritual', 'day']) {
                        if (a[key] !== void 0)
                            list[index][key] = String(a[key]);
                    }
                    if (a.speechStyle !== void 0 && a.speechStyle !== null && typeof a.speechStyle === 'object') {
                        list[index].speechStyle = { ...(list[index].speechStyle ?? {}), ...a.speechStyle };
                    }
                    if (Array.isArray(a.alias))
                        list[index].alias = a.alias.map(String);
                    message = `已更新 ${categoryLabel}：${name}`;
                    lastSettingName = name;
                }
                writeSettingsData(projectDir, data);
                if (action === 'update') {
                    const updated = list.find((e) => e.name === lastSettingName);
                    const result = { projectId: a.projectId, category, action, message };
                    result[listKey] = updated ? [normalizeSettingEntry(updated)] : [];
                    return unk(result);
                }
            }
            else if (action === 'scan') {
                const rows = chapterRows(store.load(a.projectId));
                const fullText = allChapterText(store, a.projectId, rows);
                const nameCounts = new Map();
                for (const m of fullText.matchAll(/([\u4e00-\u9fff]{2,3})(?:说|道|问|喊|叫|笑|叹|点头|摇头)/g)) {
                    const n = m[1];
                    if (/^[他她我你它又再还这那谁]./.test(n))
                        continue;
                    if (!['那个', '这个', '什么', '怎么', '自己', '她们', '他们', '你们', '我们'].includes(n)) {
                        nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
                    }
                }
                const known = new Set(list.map((e) => String(e.name)));
                const candidates = [...nameCounts.entries()].filter(([n, count]) => count >= 2 && !known.has(n)).map(([n, count]) => n + '（' + count + '次）').slice(0, 15);
                message = `扫描全书，提取 ${candidates.length} 个人物候选`;
                const result = { projectId: a.projectId, category, action, candidates, message };
                result.characters = data.characters.map(normalizeSettingEntry);
                result.locations = data.locations.map(normalizeSettingEntry);
                result.items = data.items.map(normalizeSettingEntry);
                result.timeline = data.timeline.map(normalizeSettingEntry);
                result.worldview = data.worldview.map(normalizeSettingEntry);
                return unk(result);
            }
            else if (action === 'detect') {
                const rows = chapterRows(store.load(a.projectId));
                const fullText = allChapterText(store, a.projectId, rows);
                const detection = detectCulture(fullText);
                const result = { projectId: a.projectId, category: 'worldview', action, ...detection };
                const genre = detectGenreFromText(fullText);
                const theme = detectThemeFromText(fullText);
                result.genre = genre;
                result.theme = theme;
                const genreNote = genre.dominant ? '｜流派：' + genre.dominant : '';
                const themeNote = theme.dominant ? '｜题材：' + theme.dominant + (theme.secondary ? '/' + theme.secondary : '') : '';
                result.worldview = data.worldview.map(normalizeSettingEntry);
                result.message = `自动判断：${CULTURE_MARKERS[detection.culture]?.label ?? '无法判断（词表未命中）'}（置信度 ${Math.round(detection.confidence * 100)}%）${genreNote}${themeNote}`;
                try {
                    const analysis = analyzeText(fullText, {});
                    result.vibe = computeVibe(result, analysis.emotion, fullText);
                }
                catch (e) {
                    result.vibe = { axes: [], top: [], conclusion: '气质聚合失败: ' + String(e).slice(0, 60), confidence: 0, evidence: [] };
                }
                return unk(result);
            }
            const result = { projectId: a.projectId, category, action };
            result.total = data.characters.length + data.locations.length + data.items.length + data.timeline.length + data.worldview.length;
            result.characters = data.characters.map(normalizeSettingEntry);
            result.locations = data.locations.map(normalizeSettingEntry);
            result.items = data.items.map(normalizeSettingEntry);
            result.timeline = data.timeline.map(normalizeSettingEntry);
            result.worldview = data.worldview.map(normalizeSettingEntry);
            if (message)
                result.message = message;
            return unk(result);
        },
    }));
    /* ── 3. novel_summary：章节摘要 ── */
    tools.push(defineTool({
        name: 'novel_summary',
        description: '章节摘要（模型生成、插件存储）：读摘要回忆剧情、避免重读。add/update/get/list/delete 按章节管理。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            action: { type: 'string', enum: ['list', 'get', 'add', 'update', 'delete'], description: 'list=全部摘要（默认）；get=取某章；add=新增/覆盖摘要；update=修改；delete=删除。' },
            chapter: { type: 'string', description: '章节标识（章号/标题/章节 id）。' },
            summary: { type: 'string', description: 'add/update 时：本章摘要（200-500 字）。' },
            keyEvents: { type: 'array', items: { type: 'string' }, description: '可选：关键事件列表。' },
            keySettings: { type: 'array', items: { type: 'string' }, description: '可选：本章出现的关键设定/信息。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    summaries: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                chapter: { type: 'string', required: true }, summary: { type: 'string', required: true },
                                keyEvents: { type: 'array', items: { type: 'string' } }, keySettings: { type: 'array', items: { type: 'string' } }, updatedAt: { type: 'string' },
                            },
                        },
                    },
                    message: { type: 'string' },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`<path>${r.projectId}</path>`, '<type>novel-summary</type>', '<content>', ''];
                if (r.message)
                    lines.push(r.message);
                for (const s of r.summaries) {
                    lines.push(`【${s.chapter}】`);
                    lines.push(String(s.summary));
                    if (Array.isArray(s.keyEvents) && s.keyEvents.length > 0)
                        lines.push('关键事件：' + s.keyEvents.join('；'));
                    if (Array.isArray(s.keySettings) && s.keySettings.length > 0)
                        lines.push('关键设定：' + s.keySettings.join('；'));
                    lines.push('');
                }
                lines.push('</content>');
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            store.load(a.projectId);
            const projectDir = projectDirOf(dataDir, a.projectId);
            const action = ['get', 'add', 'update', 'delete'].includes(a.action ?? '') ? a.action : 'list';
            const summaries = readSummaries(projectDir);
            const now = nowIso();
            let message = '';
            if (action !== 'list') {
                const chapterArg = optionalString(a, 'chapter');
                assert(chapterArg !== void 0, `novel_summary ${action} 需要 chapter 参数`);
                const normArg = normalizeChapterKey(chapterArg);
                const index = summaries.findIndex((s) => normalizeChapterKey(String(s.chapter)) === normArg);
                if (action === 'get') {
                    const found = index !== -1 ? [summaries[index]] : [];
                    return unk({ projectId: a.projectId, action, summaries: found.map((s) => ({ ...s })) });
                }
                if (action === 'delete') {
                    if (index !== -1)
                        summaries.splice(index, 1);
                    message = `已删除 ${chapterArg} 的摘要`;
                }
                else {
                    const summary = optionalString(a, 'summary');
                    assert(summary !== void 0, `novel_summary ${action} 需要 summary 参数`);
                    const entry = { chapter: normalizeChapterKey(chapterArg), summary, updatedAt: now };
                    if (Array.isArray(a.keyEvents))
                        entry.keyEvents = a.keyEvents.map(String);
                    if (Array.isArray(a.keySettings))
                        entry.keySettings = a.keySettings.map(String);
                    if (index !== -1)
                        summaries[index] = entry;
                    else
                        summaries.push(entry);
                    message = `已保存 ${chapterArg} 的摘要`;
                }
                mkdirSync(projectDir, { recursive: true });
                atomicWriteJson(summariesFile(projectDir), { summaries });
                if (action === 'add' || action === 'update') {
                    const single = summaries[index !== -1 ? index : summaries.length - 1];
                    const cleanSingle = { chapter: String(single.chapter), summary: String(single.summary) };
                    if (Array.isArray(single.keyEvents))
                        cleanSingle.keyEvents = single.keyEvents.map(String);
                    if (Array.isArray(single.keySettings))
                        cleanSingle.keySettings = single.keySettings.map(String);
                    if (single.updatedAt !== void 0)
                        cleanSingle.updatedAt = single.updatedAt;
                    return unk({ projectId: a.projectId, action, message, summaries: [cleanSingle] });
                }
            }
            summaries.sort((a2, b2) => (parseChapterNumber(String(a2.chapter)) ?? 999) - (parseChapterNumber(String(b2.chapter)) ?? 999) || String(a2.chapter).localeCompare(String(b2.chapter)));
            const clean = summaries.map((s) => {
                const out = { chapter: String(s.chapter), summary: String(s.summary) };
                if (Array.isArray(s.keyEvents))
                    out.keyEvents = s.keyEvents.map(String);
                if (Array.isArray(s.keySettings))
                    out.keySettings = s.keySettings.map(String);
                if (s.updatedAt !== void 0)
                    out.updatedAt = s.updatedAt;
                return out;
            });
            return unk({ projectId: a.projectId, action, summaries: clean, ...(message ? { message } : {}) });
        },
    }));
    /* ── 4. novel_outline：创作资料管理 ── */
    tools.push(defineTool({
        name: 'novel_outline',
        description: '维护原创小说的创作资料（创作设定/主要人物/次要人物/剧情大纲/钩子记录/创作状态卡）于项目下 创作资料/ 目录。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            action: { type: 'string', enum: ['init', 'read', 'bible', 'character', 'chapter', 'hook', 'status'], description: 'init=初始化；read=读文件；bible=写创作设定；character=登记/提升人物；chapter=补大纲方向行；hook=回填章节结尾钩子；status=刷新创作状态卡。' },
            file: { type: 'string', enum: ['bible', 'characters-main', 'characters-minor', 'outline', 'hooks', 'status'], description: 'read 时指定；省略=status。' },
            content: { type: 'string', description: 'bible/status 时用：全文。' },
            role: { type: 'string', enum: ['main', 'minor'], description: 'character 时：main=主要人物 / minor=次要人物。' },
            name: { type: 'string', description: 'character 时：人物名。' },
            description: { type: 'string', description: 'character 时：人物简介。' },
            number: { type: 'integer', description: 'chapter/hook 时：章节号。' },
            title: { type: 'string', description: 'chapter 时：本章标题/方向（一行）。' },
            body: { type: 'string', description: 'hook 时：本章结尾钩子。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    message: { type: 'string' },
                    content: { type: 'string' },
                    files: { type: 'array', items: { type: 'string' } },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                return text([`<path>${r.projectId}/创作资料</path>`, '<type>novel-outline</type>', '<content>', r.content || r.message || '', '', '</content>'].join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            store.load(a.projectId);
            const projectDir = projectDirOf(dataDir, a.projectId);
            const dir = creationDir(projectDir);
            const action = a.action ?? 'read';
            const openFile = (key) => join(dir, CREATION_FILES[key] ?? key);
            if (action === 'init') {
                mkdirSync(dir, { recursive: true });
                const createdFiles = [];
                for (const key of Object.keys(CREATION_FILES)) {
                    const f = openFile(key);
                    if (existsSync(f))
                        continue;
                    writeFileSync(f, creationTemplate(key), 'utf8');
                    createdFiles.push(CREATION_FILES[key]);
                }
                return unk({ projectId: a.projectId, action, message: '创作资料已初始化（6 个文件）', files: createdFiles });
            }
            if (action === 'read') {
                const key = ['bible', 'characters-main', 'characters-minor', 'outline', 'hooks', 'status'].includes(a.file ?? '') ? a.file : 'status';
                const f = openFile(key);
                assert(existsSync(f), `创作资料文件 ${CREATION_FILES[key]} 不存在——先用 novel_outline init 初始化`);
                let content = readFileSync(f, 'utf8');
                if (key === 'status' || key === 'outline') {
                    try {
                        const outlinePath = openFile('outline');
                        const hooksPath = openFile('hooks');
                        const outlineText = readFileSync(outlinePath, 'utf8');
                        const hooksText = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : '';
                        const outlineNums = new Set([...outlineText.matchAll(/^[-*] (\d+)/gm)].map((m) => Number(m[1])));
                        const hookNums = new Set([...hooksText.matchAll(/^[-*] (\d+)/gm)].map((m) => Number(m[1])));
                        const missing = [...outlineNums].filter((n) => !hookNums.has(n)).sort((x, y) => x - y).slice(0, 20);
                        if (missing.length > 0)
                            content += `\n\n📌 已大纲未回填钩子的章节：${missing.join('、')}（用 novel_outline hook 补）`;
                    }
                    catch { /* 无大纲文件忽略 */ }
                }
                return unk({ projectId: a.projectId, action, file: key, content });
            }
            if (action === 'bible' || action === 'status') {
                const content = requiredString(a, 'content');
                mkdirSync(dir, { recursive: true });
                writeFileSync(openFile(action), content + '\n', 'utf8');
                return unk({ projectId: a.projectId, action, message: action === 'bible' ? `创作设定已写入（${content.length} 字）` : '创作状态卡已刷新' });
            }
            if (action === 'character') {
                const role = a.role === 'main' ? 'main' : 'minor';
                const name = requiredString(a, 'name');
                const description = String(a.description ?? '').replace(/\s*\n+\s*/g, '; ').trim();
                const f = openFile(a.role === 'main' ? 'characters-main' : 'characters-minor');
                mkdirSync(dir, { recursive: true });
                if (!existsSync(f))
                    writeFileSync(f, creationTemplate(a.role === 'main' ? 'characters-main' : 'characters-minor'), 'utf8');
                const cur = readFileSync(f, 'utf8');
                const re = new RegExp(`(^|\\n)[-*][ \\t]*${escapeRegExp(name)}(：|$|\\s)`);
                if (re.test(cur))
                    return unk({ projectId: a.projectId, action, message: `人物「${name}」已存在（未重复登记）` });
                const line = `- ${name}：${description}\n`;
                writeFileSync(f, cur.endsWith('\n') ? cur + line : cur + '\n' + line, 'utf8');
                return unk({ projectId: a.projectId, action, message: `已登记人物：${name}` });
            }
            if (action === 'chapter') {
                const number = a.number;
                assert(typeof number === 'number' && Number.isInteger(number), 'novel_outline chapter 需要 number 参数（章节号）');
                const title = String(a.title ?? '').replace(/\s*\n+\s*/g, ' ').trim();
                assert(title !== '', 'novel_outline chapter 需要 title 参数');
                const f = openFile('outline');
                mkdirSync(dir, { recursive: true });
                if (!existsSync(f))
                    writeFileSync(f, creationTemplate('outline'), 'utf8');
                const cur = readFileSync(f, 'utf8');
                if (cur.includes(`- ${number} `) || cur.includes(`- ${number}`))
                    return unk({ projectId: a.projectId, action, message: `第 ${number} 章已存在于大纲（不重复添加）` });
                writeFileSync(f, cur.endsWith('\n') ? cur + `- ${number} ${title}\n` : cur + `\n- ${number} ${title}\n`, 'utf8');
                return unk({ projectId: a.projectId, action, message: `大纲已补：第 ${number} 章 ${title}` });
            }
            if (action === 'hook') {
                const number = a.number;
                assert(typeof number === 'number' && Number.isInteger(number), 'novel_outline hook 需要 number 参数（章节号）');
                let body = String(a.body ?? '').replace(/\s*\n+\s*/g, ' ').replace(/^- \d+ /, '').trim();
                assert(body !== '', 'novel_outline hook 需要 body 参数');
                const f = openFile('hooks');
                mkdirSync(dir, { recursive: true });
                if (!existsSync(f))
                    writeFileSync(f, creationTemplate('hooks'), 'utf8');
                let cur = readFileSync(f, 'utf8');
                const lineRe = new RegExp(`^[-*] ${number} [^\\n]*(?:\\n|$)`, 'm');
                const line = `- ${number} ${body}\n`;
                if (lineRe.test(cur)) {
                    if (!cur.endsWith('\n'))
                        cur += '\n';
                    cur = cur.replace(lineRe, line);
                }
                else {
                    if (cur !== '' && !cur.endsWith('\n'))
                        cur += '\n';
                    cur += line;
                }
                writeFileSync(f, cur, 'utf8');
                return unk({ projectId: a.projectId, action, message: `第 ${number} 章钩子已回填` });
            }
            throw new Error(`未知 action：${action}`);
        },
    }));
    /* ── 5. novel_continuity_check：连贯性审计 ── */
    tools.push(defineTool({
        name: 'novel_continuity_check',
        description: '连贯性审计：对照设定表扫描全书，输出矛盾候选（数字口径/人物缺场/别名/重复）供修正。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'string', description: '衔接检查模式：指定章节（章号/标题/章节 id），对比其与上一章的开头衔接。' },
            outline: { type: 'boolean', description: '大纲对照模式：对比创作资料剧情大纲方向行与正文关键词重合率。' },
            ooc: { type: 'boolean', description: 'OOC 哨兵模式：对比每章角色附近文本情绪值 vs 全书基线。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                    chapter: { type: 'string' },
                    candidates: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                type: { type: 'string', required: true }, detail: { type: 'string', required: true }, chapters: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    },
                    reportFile: { type: 'string' },
                    advice: { type: 'string', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const lines = [`<path>${r.projectId}</path>`, '<type>novel-continuity-check</type>', '<content>', ''];
                if (r.candidates.length === 0)
                    lines.push('未发现明显矛盾候选。');
                else {
                    lines.push(`矛盾候选 ${r.candidates.length} 条（供人工判断）：`);
                    for (const cand of r.candidates) {
                        lines.push(`  - [${cand.type}] ${cand.detail}${Array.isArray(cand.chapters) && cand.chapters.length > 0 ? '（涉及：' + cand.chapters.join('、') + '）' : ''}`);
                    }
                }
                lines.push('', '【建议】' + r.advice, '', '</content>');
                return text(lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const project = store.load(a.projectId);
            const projectDir = projectDirOf(dataDir, a.projectId);
            const rows = chapterRows(project);
            assert(rows.length > 0, `作品 "${project.project.name}" 下没有章节文件`);
            // 【衔接模式】目标章 vs 上一章
            if (a.chapter !== void 0) {
                const target = resolveChapter(project, a.chapter);
                const ti = rows.findIndex((c) => c.id === target.id);
                if (ti <= 0)
                    return unk({ projectId: a.projectId, action: '衔接', candidates: [], advice: '第一章无上一章可比对——衔接检查从第二章起可用。' });
                const prev = rows[ti - 1];
                const out = [];
                const prevText = store.readChapterContent(a.projectId, prev.id);
                const currText = store.readChapterContent(a.projectId, target.id);
                const prevTail = prevText.slice(-600);
                const currHead = currText.slice(0, 800);
                if (prevTail.trim() && currHead.trim()) {
                    const hardHit = TIME_JUMP_WORDS.hard.filter((w) => currHead.includes(w));
                    const softHit = TIME_JUMP_WORDS.soft.filter((w) => currHead.includes(w));
                    const prevHasTime = TIME_JUMP_WORDS.hard.some((w) => prevTail.includes(w)) || TIME_JUMP_WORDS.soft.some((w) => prevTail.includes(w));
                    if (hardHit.length > 0) {
                        out.push({ type: '衔接·时间跳跃', detail: `本章开头出现「${hardHit.slice(0, 2).join('/')}」（时间硬跳）——建议确认开头有过渡句，否则补 1 句时间流逝`, chapters: [prev.file, target.file] });
                    }
                    else if (softHit.length > 0 && !prevHasTime) {
                        out.push({ type: '衔接·时间过渡', detail: `本章开头出现「${softHit.slice(0, 2).join('/')}」（软跳），可接受但建议确认时间线连贯`, chapters: [prev.file, target.file] });
                    }
                    // 语义相似度
                    try {
                        if (await embedding.isAvailable()) {
                            const [vPrev, vCurr] = await Promise.all([embedding.embed(prevTail), embedding.embed(currHead)]);
                            if (Array.isArray(vPrev) && Array.isArray(vCurr)) {
                                const sim = embedding.cosine(vPrev, vCurr);
                                if (sim < 0.3)
                                    out.push({ type: '衔接·语义距离', detail: `上章结尾与本章开头语义相似度 ${sim.toFixed(2)}（偏低）——开头可能未承接上章场景，建议加承接句`, chapters: [prev.file, target.file] });
                                else if (sim < 0.45)
                                    out.push({ type: '衔接·语义距离', detail: `语义相似度 ${sim.toFixed(2)}（一般）——建议确认本章开头与上章结尾的承接`, chapters: [prev.file, target.file] });
                            }
                        }
                    }
                    catch { /* 语义不可用跳过 */ }
                    // 人物延续
                    try {
                        const st = readSettingsData(projectDir);
                        const chars = (st.characters).filter((c) => typeof c.name === 'string' && String(c.name).length >= 2);
                        const prevNames = chars.filter((c) => prevTail.includes(String(c.name))).map((c) => String(c.name));
                        const currNames = chars.filter((c) => currHead.includes(String(c.name))).map((c) => String(c.name));
                        if (prevNames.length > 0 && currNames.length === 0) {
                            out.push({ type: '衔接·人物断线', detail: `上章结尾出场人物（${prevNames.slice(0, 3).join('/')}）本章开头 800 字均未出现——角色线可能断掉，建议让至少一人承接`, chapters: [prev.file, target.file] });
                        }
                    }
                    catch { /* 设定未登记跳过 */ }
                    // 承接卡（上一章钩子）
                    try {
                        const hooksPath = join(creationDir(projectDir), CREATION_FILES.hooks);
                        if (existsSync(hooksPath)) {
                            const hooks = readFileSync(hooksPath, 'utf8');
                            const hookLines = hooks.split('\n').filter((l) => /^- \d+ /.test(l));
                            const prevNum = prev.order;
                            const prevHookLine = hookLines.find((l) => parseInt((l.match(/^- (\d+)/) || [''])[1], 10) === prevNum);
                            if (prevHookLine) {
                                const lastHook = prevHookLine.replace(/^- \d+ /, '');
                                const hookChars = new Set(lastHook.replace(/[，。！？、\s]/g, '').split(''));
                                const headChars = new Set(currHead.slice(0, 300).split(''));
                                let hit = 0;
                                for (const ch of hookChars)
                                    if (headChars.has(ch))
                                        hit += 1;
                                const ratio = hookChars.size > 0 ? hit / hookChars.size : 1;
                                if (ratio < 0.25 && lastHook.length > 4) {
                                    out.push({ type: '衔接·钩子未接', detail: `上一章钩子「${lastHook.slice(0, 24)}…」与本章开头字符命中率仅 ${Math.round(ratio * 100)}%——开头可能没接上钩子（若本章确已接续请忽略）`, chapters: [prev.file, target.file] });
                                }
                            }
                        }
                    }
                    catch { /* 无创作资料跳过 */ }
                }
                return unk({
                    projectId: a.projectId, action: '衔接', chapter: target.file, candidates: out,
                    advice: out.length === 0 ? '未发现明显衔接问题：时间线、人物延续与钩子承接均正常。' : `发现 ${out.length} 处衔接风险点——按提示补过渡/承接后重查。`,
                });
            }
            const candidates = [];
            const chapterTexts = rows.map((c) => ({ file: c.file, text: store.readChapterContent(a.projectId, c.id) }));
            const settings = readSettingsData(projectDir);
            const creationDirPath = creationDir(projectDir);
            // 【大纲对照模式】
            if (a.outline === true) {
                const outlinePath = join(creationDirPath, CREATION_FILES.outline);
                try {
                    const outlineText = readFileSync(outlinePath, 'utf8');
                    const directionLines = outlineText.split('\n').filter((l) => /^- \d+ /.test(l));
                    if (directionLines.length === 0)
                        return unk({ projectId: a.projectId, action: '大纲对照', candidates: [], advice: '创作资料大纲没有方向行——先 novel_outline chapter 补每章方向' });
                    const out = [];
                    for (const l of directionLines) {
                        const num = parseInt((l.match(/^- (\d+)/) || [''])[1], 10);
                        const direction = l.replace(/^- \d+ /, '').trim();
                        if (direction.length < 4)
                            continue;
                        const ch = rows.find((c) => c.order === num);
                        if (!ch)
                            continue;
                        const chapterText = store.readChapterContent(a.projectId, ch.id).slice(0, 600);
                        const grams = new Set();
                        for (let i = 0; i < direction.length - 1; i += 1)
                            grams.add(direction.slice(i, i + 2));
                        let hit = 0;
                        for (const g of grams)
                            if (chapterText.includes(g))
                                hit += 1;
                        const ratio = grams.size > 0 ? hit / grams.size : 0;
                        if (ratio < 0.12)
                            out.push({ type: '大纲·可能偏离', detail: `第 ${num} 章方向「${direction.slice(0, 20)}…」与正文开头关键词重合率仅 ${Math.round(ratio * 100)}%——该章可能偏离大纲，建议核对`, chapters: [ch.file] });
                    }
                    return unk({ projectId: a.projectId, action: '大纲对照', candidates: out, advice: out.length === 0 ? '各章与大纲方向基本一致。' : `发现 ${out.length} 章可能与大纲方向偏离——逐条核对（偏离不一定是错，但要有意为之）。` });
                }
                catch {
                    return unk({ projectId: a.projectId, action: '大纲对照', candidates: [], advice: '该书无创作资料（创作资料/剧情大纲.md）——先 novel_outline init + chapter 补大纲方向' });
                }
            }
            // 【OOC 模式】
            if (a.ooc === true) {
                const characters = (settings.characters).filter((c) => typeof c.name === 'string' && String(c.name).length >= 2);
                if (characters.length === 0)
                    return unk({ projectId: a.projectId, action: 'OOC', candidates: [], advice: '未登记角色（novel_settings character）——先登记角色才能检测情绪偏离' });
                const per = {};
                for (const ch of chapterTexts) {
                    for (const c of characters) {
                        const name = String(c.name);
                        const around = [];
                        let pos = -1;
                        while ((pos = ch.text.indexOf(name, pos + 1)) !== -1 && around.length < 5) {
                            around.push(ch.text.slice(Math.max(0, pos - 120), pos + 120));
                        }
                        if (around.length === 0)
                            continue;
                        const vs = valenceStats(around.join(' '));
                        (per[name] = per[name] || []).push({ file: ch.file, val: vs.meanValence ?? 0 });
                    }
                }
                const out = [];
                for (const name of Object.keys(per)) {
                    const list = per[name];
                    if (list.length < 2)
                        continue;
                    const vals = list.map((x) => x.val);
                    const mu = vals.reduce((s2, x) => s2 + x, 0) / vals.length;
                    const variance = vals.reduce((s2, x) => s2 + (x - mu) * (x - mu), 0) / vals.length;
                    const sigma = Math.sqrt(variance) || 0.05;
                    const thr = list.length <= 4 ? 0.3 : 2 * sigma;
                    for (const item of list) {
                        if (Math.abs(item.val - mu) > thr) {
                            out.push({ type: 'OOC·情绪偏离', detail: `角色「${name}」在 ${item.file} 的情绪值 ${item.val.toFixed(2)} 偏离其全书均值 ${mu.toFixed(2)}（阈值 ${thr === 0.3 ? '小样本固定 0.3' : '全书 2σ'}）——若有重大剧情触发情绪变化可忽略，否则可能 OOC`, chapters: [item.file] });
                        }
                    }
                }
                return unk({ projectId: a.projectId, action: 'OOC', candidates: out, advice: out.length === 0 ? '登记角色情绪基线未见异常。' : `发现 ${out.length} 处角色情绪偏离——先确认是否有剧情触发，无触发则可能 OOC。` });
            }
            // 【默认全书扫描】
            // 1) 数字写法差异
            const numberForms = new Map();
            for (const { file, text: t } of chapterTexts) {
                for (const m of t.matchAll(/\d+\s*(?:万亿|千万|百万|十万|[万亿千百])|[一二三四五六七八九十]{1,2}(?:万亿|千万|百万|十万|[万亿千百])/g)) {
                    const form = m[0].replace(/\s/g, '');
                    if (!/[万亿千百]$/.test(form))
                        continue;
                    if (/^[十百千万亿]$/.test(form))
                        continue;
                    if (!numberForms.has(form))
                        numberForms.set(form, []);
                    if (!numberForms.get(form).includes(file))
                        numberForms.get(form).push(file);
                }
            }
            if (numberForms.size >= 2) {
                const forms = [...numberForms.entries()];
                for (let i = 0; i < forms.length; i += 1) {
                    for (let j = i + 1; j < forms.length; j += 1) {
                        const [x, cx] = forms[i];
                        const [y, cy] = forms[j];
                        if (x !== y)
                            candidates.push({ type: '数字口径', detail: `「${x}」与「${y}」写法并存（可能指同一数量），请确认口径`, chapters: [...new Set(cx.concat(cy))] });
                    }
                }
            }
            // 2) 人物出现分布
            for (const character of settings.characters) {
                const name = String(character.name ?? '');
                if (!name)
                    continue;
                const absent = chapterTexts.filter(({ text: t }) => !t.includes(name)).map(({ file }) => file);
                if (absent.length === chapterTexts.length) {
                    candidates.push({ type: '人物缺失', detail: `设定表人物「${name}」在全书章节中均未出现，请确认是否已出场`, chapters: absent });
                }
                else if (absent.length > 0 && chapterTexts.length > 1) {
                    candidates.push({ type: '人物缺场', detail: `设定表人物「${name}」未出现在 ${absent.length} 个章节中（如无出场必要可忽略）`, chapters: absent.slice(0, 5) });
                }
                if (Array.isArray(character.alias) && character.alias.length > 0) {
                    const aliasList = character.alias.map(String);
                    const used = chapterTexts.filter(({ text: t }) => aliasList.some((al) => t.includes(al))).map(({ file }) => file);
                    if (used.length === 0)
                        candidates.push({ type: '别名未用', detail: `人物「${name}」登记的别名 ${aliasList.join('、')} 在全书未出现`, chapters: [] });
                }
            }
            // 3) 设定重复
            for (const key of ['characters', 'locations', 'items']) {
                const names = settings[key].map((e) => String(e.name ?? ''));
                const dup = names.filter((n, i) => n && names.indexOf(n) !== i);
                if (dup.length > 0)
                    candidates.push({ type: '设定重复', detail: `${key} 中存在重复条目：${[...new Set(dup)].join('、')}`, chapters: [] });
            }
            // 4) 用语风格扫描
            const worldviewEntry = Array.isArray(settings.worldview)
                ? settings.worldview.slice().reverse().find((e) => e && e.speechStyle) ?? settings.worldview[0]
                : void 0;
            const entryHasBanned = worldviewEntry && Array.isArray(worldviewEntry.bannedWords) && worldviewEntry.bannedWords.length > 0;
            let styleRule = entryHasBanned
                ? { culture: String(worldviewEntry.name ?? ''), bannedWords: worldviewEntry.bannedWords.map(String), recommended: worldviewEntry.recommended }
                : DEFAULT_BANNED_WORDS;
            if (!entryHasBanned) {
                const detCulture = detectCulture(chapterTexts.map(({ text: t }) => t).join('\n')).culture;
                if (detCulture === 'eastern' || /东方|中式|eastern|古代/i.test(String(worldviewEntry?.name ?? ''))) {
                    styleRule = { culture: '东方/中式古代（默认）', bannedWords: ['Miss', '先生', '阁下', '神甫', '修士', '教堂', '弥撒', '圣器', '城堡', '骑士', '公爵', '伯爵', '庄园', '葡萄酒', '钟楼', '教典', '祈祷', '礼拜', '蜡烛', '烛台', '点烛'], recommended: { '先生': '老爷/相公', '阁下': '大人/官人', '神甫': '和尚/法师', '教堂': '庙/寺', '弥撒': '法事', '点烛': '上香' } };
                }
                else if (detCulture === 'modern') {
                    styleRule = { culture: '现代都市（默认）', bannedWords: [], recommended: {} };
                }
            }
            const cultureName = (worldviewEntry && worldviewEntry.name) ? String(worldviewEntry.name) : styleRule.culture;
            for (const word of styleRule.bannedWords) {
                const hits = chapterTexts.filter(({ text: t }) => t.includes(word)).map(({ file }) => file);
                if (hits.length > 0) {
                    const rec = styleRule.recommended?.[word] ? `（建议改为「${styleRule.recommended[word]}」）` : '';
                    candidates.push({ type: '用语冲突', detail: `「${word}」×${hits.length}章 与当前文化基准「${cultureName}」不符${rec}${worldviewEntry ? '' : '（未登记 worldview，使用默认基准；可用 novel_settings detect 自动判断）'}`, chapters: hits });
                }
            }
            // 5) 语用扫描
            const speech = worldviewEntry?.speechStyle;
            if (speech && Array.isArray(speech.honorBad)) {
                const honorHits = new Map();
                for (const { file, text: t } of chapterTexts) {
                    for (const word of speech.honorBad) {
                        if (t.includes(word)) {
                            if (!honorHits.has(word))
                                honorHits.set(word, []);
                            if (!honorHits.get(word).includes(file))
                                honorHits.get(word).push(file);
                        }
                    }
                }
                for (const [word, files] of honorHits) {
                    const honorGood = speech.honorGood;
                    const rec = honorGood?.[word] ? `（建议改「${honorGood[word]}」）` : '';
                    candidates.push({ type: '语用冲突·客套', detail: `「${word}」×${files.length}章 属于「${styleRule.culture}」禁用表达${rec}`, chapters: files });
                }
            }
            if (speech && Array.isArray(speech.ritualBadPatterns)) {
                for (const pattern of speech.ritualBadPatterns) {
                    let regex = null;
                    try {
                        if (typeof pattern === 'string' && pattern.length <= 200)
                            regex = new RegExp(pattern, 'g');
                    }
                    catch {
                        regex = null;
                    }
                    if (!regex)
                        continue;
                    const ritualHits = [];
                    for (const { file, text: t } of chapterTexts) {
                        if (regex.test(t))
                            ritualHits.push(file);
                        regex.lastIndex = 0;
                    }
                    if (ritualHits.length > 0)
                        candidates.push({ type: '语用冲突·仪式', detail: `检测到仪式类表达（规范：${String(speech.ritualGoodNote ?? '见 worldview 设定')}）`, chapters: ritualHits });
                }
            }
            if (speech && typeof speech.title === 'string' && (speech.title.includes('小姐') || speech.title.includes('不用'))) {
                let count = 0;
                const titleHits = [];
                for (const { file, text: t } of chapterTexts) {
                    const m = t.match(/[A-Za-z\u4e00-\u9fff]+小姐/g);
                    if (m) {
                        count += m.length;
                        if (!titleHits.includes(file))
                            titleHits.push(file);
                    }
                }
                if (count > 0)
                    candidates.push({ type: '语用冲突·称谓', detail: `「XX小姐」×${count} 与称谓规范不符（${speech.title}）`, chapters: titleHits });
            }
            const advice = candidates.length === 0
                ? '设定表与章节基本一致。建议继续登记新章节出现的新人物/新地点。'
                : '以上为规则候选，请逐条人工判断：确认为矛盾则更新设定表（novel_settings update）或修正正文；非矛盾（如回忆/刻意缺席）可忽略。';
            // 落盘审计报告
            const auditDir = join(projectDir, 'audits');
            mkdirSync(auditDir, { recursive: true });
            const sha = createHash('sha1').update(a.projectId + '|' + rows.map((c) => c.file).join(',')).digest('hex').slice(0, 16);
            const reportFile = join(auditDir, a.projectId + '-' + sha + '.json');
            try {
                atomicWriteJson(reportFile, { projectId: a.projectId, generatedAt: nowIso(), candidates });
            }
            catch { /* 落盘失败不阻塞 */ }
            return unk({ projectId: a.projectId, action: '全书扫描', candidates, reportFile, advice });
        },
    }));
    /* ── 6. novel_semantic_search：真实 embedding 语义检索 ── */
    tools.push(defineTool({
        name: 'novel_semantic_search',
        description: '语义检索（本地 embedding，0 token）：自然语言检索全书语义相关段落，无关键词也能命中。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            query: { type: 'string', required: true, description: '要检索的语义描述，如「与血统秘密相关的段落」。自然语言越具体越好。' },
            top: { type: 'integer', description: '返回条数（默认 5，最大 10）。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    query: { type: 'string', required: true },
                    available: { type: 'boolean', required: true },
                    cache: { type: 'string', enum: ['hit', 'built'] },
                    indexSize: { type: 'integer' },
                    results: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: { id: { type: 'string', required: true }, chapter: { type: 'string', required: true }, text: { type: 'string', required: true }, score: { type: 'number', required: true } },
                        },
                    },
                    message: { type: 'string', required: true },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                const head = `语义检索「${r.query}」`;
                if (!r.available)
                    return text(head + '（不可用）\n' + (r.message ?? ''));
                const lines = r.results.map((result) => `- [${result.score}] ${result.chapter}: ${result.text}`);
                return text(head + `（命中 ${r.results.length} 段，索引 ${r.indexSize ?? 0} 段）\n` + lines.join('\n'));
            },
        },
        async execute(args) {
            const a = args;
            const query = String(a.query ?? '');
            const projectId = a.projectId;
            try {
                const project = store.load(projectId);
                const top = Math.min(Math.max(Number(a.top) || 5, 1), 10);
                assert(query !== '', 'novel_semantic_search 需要 query 参数');
                const ready = await embedding.isAvailable();
                if (!ready) {
                    return { projectId, query, available: false, results: [], message: '语义引擎不可用（模型文件缺失/加载失败）：确认 lib/legacy/models/ 含 bge-large-zh-v1.5 模型文件；插件已回退纯规则模式，不影响其他功能。' };
                }
                const rows = chapterRows(project);
                const chunks = [];
                for (const c of rows) {
                    const t = store.readChapterContent(projectId, c.id);
                    for (const p of embedding.chunkText(t))
                        chunks.push({ ...p, id: c.title + '|' + p.id, chapter: c.title });
                }
                const { items: cachedIndex, fp: cachedFp } = embedding.loadIndexMeta(dataDir, projectId);
                const indexFp = embedding.fingerprint(chunks);
                let index = cachedIndex;
                let cache = 'hit';
                if (!index || index.length === 0 || cachedFp !== indexFp) {
                    index = await embedding.buildIndexIncremental(chunks, cachedIndex);
                    cache = 'built';
                    embedding.saveIndex(dataDir, projectId, index, indexFp);
                }
                const results = (await embedding.search(query, index, top));
                return {
                    projectId, query, available: true, cache: cache, indexSize: (index || []).length,
                    results: results.map((r) => ({ id: r.id, chapter: r.chapter || String(r.id).split('|')[0] || '全书', text: String(r.text || '').replace(/\r/g, '').slice(0, 200), score: Math.round(r.score * 10000) / 10000 })),
                    message: cache === 'hit' ? '使用本地语义索引（缓存）' : '首次建索引完成，已缓存',
                };
            }
            catch (e) {
                return { projectId, query, available: false, results: [], message: '语义检索安全降级：' + String(e).slice(0, 120) + '（不影响其他工具）' };
            }
        },
    }));
    /* ── 7. novel_import：稿件导入 ── */
    tools.push(defineTool({
        name: 'novel_import',
        description: '批量导入原稿件：扫描文件夹自动识别书名/章号并分组，可一键导入为项目章节（scan 预览 / apply 按组建/并入项目）。',
        parameters: {
            src: { type: 'string', required: true, description: '待导入的原稿件文件夹路径（可含多本小说的章节文本，支持子文件夹）。' },
            mode: { type: 'string', enum: ['scan', 'apply'], description: 'scan=只分析并返回分组建议（默认，不写盘）；apply=按分组导入。' },
            book: { type: 'string', description: 'apply 时可选：强制把所有（或 files 指定的）文件归入该书名（同项目名），用于合并异名同书。' },
            files: { type: 'array', items: { type: 'string' }, description: 'apply 时可选：只处理这些文件（相对 src 的路径）。' },
            move: { type: 'boolean', description: 'apply 时是否移动原文件（默认 false=复制）。' },
            recursive: { type: 'boolean', description: '是否递归扫描子文件夹。默认 true。' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    src: { type: 'string', required: true },
                    mode: { type: 'string', required: true },
                    groups: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: {
                                book: { type: 'string', required: true },
                                from: { type: 'string', enum: ['file', 'content', 'forced', 'unclassified'] },
                                maybe: { type: 'array', items: { type: 'string' } },
                                files: {
                                    type: 'array', required: true, items: {
                                        type: 'object', additionalProperties: false,
                                        properties: { file: { type: 'string', required: true }, chapter: { type: 'integer' }, title: { type: 'string' } },
                                    },
                                },
                            },
                        },
                    },
                    skipped: { type: 'array', required: true, items: { type: 'string' } },
                    imported: {
                        type: 'array', required: true, items: {
                            type: 'object', additionalProperties: false,
                            properties: { projectId: { type: 'string' }, project: { type: 'string', required: true }, file: { type: 'string', required: true }, chapter: { type: 'integer' } },
                        },
                    },
                },
            },
            render: (_a, v) => text(formatImport(unk(v))),
        },
        async execute(args) {
            const a = args;
            const src = requiredString(a, 'src');
            const mode = a.mode === 'apply' ? 'apply' : 'scan';
            const forcedBook = optionalString(a, 'book');
            const onlyFiles = Array.isArray(a.files) && a.files.length > 0
                ? new Set(a.files.map((f) => String(f).replace(/\\/g, '/').replace(/^\.?\//, '')))
                : null;
            const move = a.move === true;
            const recursive = a.recursive !== false;
            const files = collectTextFiles(src, recursive);
            const skipped = [];
            const rows = [];
            for (const rel of files) {
                const norm = rel.replace(/\\/g, '/');
                if (onlyFiles !== null && !onlyFiles.has(norm))
                    continue;
                const full = join(src, rel);
                try {
                    if (!statSync(full).isFile())
                        continue;
                }
                catch {
                    continue;
                }
                const fileName = basename(rel);
                let text = '';
                try {
                    const buf = readFileSync(full);
                    text = decodeTextBuffer(buf, full);
                }
                catch {
                    skipped.push(rel);
                    continue;
                }
                if (text.trim() === '') {
                    skipped.push(rel);
                    continue;
                }
                rows.push({ file: rel, chapter: parseChapterNumber(fileName), nameFromFile: bookNameFromFileName(fileName), nameFromContent: bookNameFromContent(text) });
            }
            const groupMap = new Map();
            for (const row of rows) {
                const isChapterFile = row.chapter !== void 0 || row.nameFromContent !== void 0;
                let book;
                let from;
                if (forcedBook !== void 0) {
                    book = forcedBook;
                    from = 'forced';
                }
                else if (isChapterFile && row.nameFromFile !== void 0) {
                    book = row.nameFromFile;
                    from = 'file';
                }
                else if (isChapterFile && row.nameFromContent !== void 0) {
                    book = row.nameFromContent;
                    from = 'content';
                }
                else {
                    book = '未分类';
                    from = 'unclassified';
                }
                if (!groupMap.has(book))
                    groupMap.set(book, { rows: [], from });
                groupMap.get(book).rows.push(row);
            }
            const groups = [];
            for (const [book, grp] of groupMap) {
                grp.rows.sort((x, y) => (x.chapter ?? Number.MAX_SAFE_INTEGER) - (y.chapter ?? Number.MAX_SAFE_INTEGER) || x.file.localeCompare(y.file));
                groups.push({
                    book, from: grp.from,
                    files: grp.rows.map((r) => ({
                        file: r.file,
                        ...(r.chapter === void 0 ? {} : { chapter: r.chapter }),
                        ...(r.nameFromContent === void 0 ? {} : { title: r.nameFromContent }),
                    })),
                });
            }
            for (const group of groups) {
                const maybe = [];
                for (const other of groups) {
                    if (other === group || other.book === group.book)
                        continue;
                    const ma = String(group.book).replace(/\s/g, '');
                    const mb = String(other.book).replace(/\s/g, '');
                    if (ma.length < 2 || mb.length < 2)
                        continue;
                    const contained = ma.includes(mb) || mb.includes(ma);
                    const setA = new Set(ma);
                    const setB = new Set(mb);
                    let common = 0;
                    for (const ch of setA)
                        if (setB.has(ch))
                            common += 1;
                    const overlap = common / Math.max(setA.size, setB.size, 1);
                    if (contained || overlap >= 0.6)
                        maybe.push(other.book);
                }
                if (maybe.length > 0)
                    group.maybe = maybe;
            }
            const imported = [];
            if (mode === 'apply') {
                for (const group of groups) {
                    if (group.book === '未分类')
                        continue;
                    const safeName = sanitizeSegment(group.book, 'book');
                    // 按名字找现存项目，否则新建
                    let projectId;
                    const existing = store.listProjects().find((p) => p.name === safeName) ?? store.listProjects().find((p) => p.name.includes(safeName) || safeName.includes(p.name));
                    if (existing)
                        projectId = existing.id;
                    else {
                        const meta = { id: uid('p'), name: safeName, genre: '', style: '', premise: '', styleCards: [], createdAt: nowIso(), updatedAt: nowIso() };
                        store.createProject(meta);
                        projectId = meta.id;
                    }
                    const data = store.load(projectId);
                    for (const gfile of group.files) {
                        const full = join(src, gfile.file);
                        let content = '';
                        try {
                            content = decodeTextBuffer(readFileSync(full), full);
                        }
                        catch {
                            continue;
                        }
                        const order = gfile.chapter !== void 0 ? gfile.chapter : data.chapters.length + 1;
                        const chId = uid('ch');
                        const chap = {
                            id: chId, projectId, title: `第${String(order).padStart(2, '0')}章`, order, status: 'draft', wordCount: content.length, volumeId: null,
                            summary: '', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [],
                            createdAt: nowIso(), updatedAt: nowIso(),
                        };
                        data.chapters.push(chap);
                        store.writeChapterContent(projectId, chId, content);
                        imported.push({ projectId, project: safeName, file: gfile.file, chapter: order });
                        if (move) {
                            try {
                                rmSync(full, { force: true });
                            }
                            catch { /* 忽略 */ }
                        }
                    }
                    store.save(projectId);
                }
            }
            const out = { src, mode, groups, skipped, imported };
            return unk(out);
        },
    }));
    /* ── 8. novel_new_chapter：新建空白章节 ── */
    tools.push(defineTool({
        name: 'novel_new_chapter',
        description: '为某部作品（项目）创建新章节（默认取下一个章号）。可指定显式章号与标题；传 volumeId 把章节同时挂到大纲的卷节点下（建成大纲 type=chapter 节点，可直接 novel_chapter_write）。',
        parameters: {
            projectId: { type: 'string', required: true, description: '项目 id' },
            chapter: { type: 'integer', description: '可选。显式指定章号；省略则取现有最大章号 + 1。' },
            title: { type: 'string', description: '可选。章节标题。' },
            volumeId: { type: 'string', description: '可选。目标卷节点 id（大纲中 type=volume 的节点；不传则仅建正文记录）' },
        },
        output: {
            schema: {
                type: 'object', additionalProperties: false,
                properties: {
                    projectId: { type: 'string', required: true },
                    chapterId: { type: 'string', required: true },
                    order: { type: 'integer', required: true },
                    title: { type: 'string', required: true },
                    message: { type: 'string' },
                    contentPreview: { type: 'string' },
                },
            },
            render: (_a, v) => {
                const r = unk(v);
                return text(`<path>${r.chapterId}</path>\n<type>novel-chapter-created</type>\n<content>\nCreated 第${String(r.order).padStart(2, '0')}章 ${r.title}${r.message ? '\n' + r.message : ''}${r.contentPreview ? '\n\n' + r.contentPreview : ''}\n</content>`);
            },
        },
        async execute(args) {
            const a = args;
            const data = store.load(a.projectId);
            let order = a.chapter;
            if (order === void 0)
                order = data.chapters.reduce((max, c) => Math.max(max, c.order), 0) + 1;
            else {
                const exists = data.chapters.some((c) => c.order === order);
                assert(!exists, `第 ${order} 章已存在——不会覆盖旧稿；如需更新请使用其他章号`);
            }
            const chId = uid('ch');
            const title = optionalString(a, 'title') ?? `第${String(order).padStart(2, '0')}章`;
            // 分卷：传 volumeId 时同时建大纲 chapter 节点（parentId=卷，保证 chapter id 与记录一致）
            let volumeId = null;
            if (a.volumeId) {
                const vol = data.outline.find(n => n.id === a.volumeId && n.type === 'volume');
                assert(vol, `卷不存在（需要 type=volume 的节点 id）: ${a.volumeId}`);
                volumeId = vol.id;
                const now = nowIso();
                const siblings = data.outline.filter(n => n.type === 'chapter' && n.parentId === vol.id);
                const inVolOrder = siblings.reduce((m, n) => Math.max(m, n.order), 0) + 1;
                data.outline.push({
                    id: chId, projectId: a.projectId, type: 'chapter', title, summary: '', parentId: vol.id,
                    order: inVolOrder, status: 'planned', beats: [], createdAt: now, updatedAt: now,
                });
            }
            const chap = {
                id: chId, projectId: a.projectId, title, order, status: 'draft', wordCount: 0, volumeId,
                summary: '', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [],
                createdAt: nowIso(), updatedAt: nowIso(),
            };
            data.chapters.push(chap);
            store.writeChapterContent(a.projectId, chId, `# ${title}\n`);
            store.save(a.projectId);
            return unk({ projectId: a.projectId, chapterId: chId, order, title, message: `已创建第 ${order} 章${volumeId ? `（已划入卷《${data.outline.find(n => n.id === volumeId)?.title}》）` : ''}`, contentPreview: `# ${title}\n` });
        },
    }));
    return tools;
}
/** 转义正则特殊字符（novel_outline character 判重用）。 */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=port-tools.js.map