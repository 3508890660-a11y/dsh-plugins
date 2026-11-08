/**
 * analyze.ts - 文本 AI 痕迹的客观统计特征分析器。
 *
 * 提供确定性计算（无 LLM）：
 *  - 句长指标：平均/中位/标准差/最值/短·中·长分布（句长均匀度是强 AI 信号）
 *  - 词汇多样性：Bigram 类型-词符比 TTR（中文整词切分不稳定，用相邻二字组近似）
 *  - 书面连接词密度（然而/此外/值得注意的是/综上所述/因此…）每千字次数
 *  - 对称并列结构密度（不仅…而且、既…又… 等）
 *  - 绝对化/强化词密度（无疑/彻底/极其/显然…）
 *  - 标点节拍：分号/破折号/省略号/感叹号密度
 *  - 碎片短句（<12 字）占比（语感呼吸点）
 * 返回结构化诊断数据 + 可读摘要，供 AI 痕迹诊断工具与去痕复核使用。
 */
/** 常见的"AI 腔"书面连接词（正则片段） */
const CONNECTIVE_RE = /然而|此外|值得注意的是|综上所述|总而言之|不仅如此|由此可见|不难看出|需要注意的是|与此同时|再者说|换而言之|归根结底|总体而言|首先|其次|最后|因此|所以|但是|不过|并且|同时/g;
/** 对称并列结构（成对模板化，AI 高频） */
const SYMMETRY_RE = /不仅[^，。！？；]*而且|既[^，。！？；]*又[^，。！？；]*|一方面[^，。！？；]*另一方面|与其[^，。！？；]*不如|越[^，。！？；]*越/g;
/** 绝对化/强化词（把话说过头，稀释真实感） */
const ABSOLUTE_RE = /无疑|彻底|极其|显然|根本|完全|非常|绝对|十分|异常|颇为|尤为/g;
/** 段落切分：空行 / 换行折行 */
function splitParagraphs(t) {
    return t.split(/\n\s*\n|\n/).map(p => p.trim()).filter(p => p.length > 0);
}
/** 句子切分：中文句末标点，返回整句字数（去配对括号） */
function splitSentences(t) {
    const lengths = [];
    for (const raw of t.split(/[。！？；!?;\n]/)) {
        const s = raw.replace(/[“”‘’「」『』（）()]/g, '').trim();
        if (s.length >= 1)
            lengths.push(s.length);
    }
    return lengths;
}
/** Bigram 类型-词符比：整词切分对中文不稳，用去标点后的相邻二字组近似词汇多样性 */
function bigramTtr(t) {
    const plain = t.replace(/[\s\u3000，。！？；：、""''（）《》——…·,.;:!?"'()]/g, '');
    if (plain.length < 4)
        return 0;
    const grams = new Map();
    for (let i = 0; i + 1 < plain.length; i++) {
        const g = plain.slice(i, i + 2);
        grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    const total = [...grams.values()].reduce((a, b) => a + b, 0);
    const uniq = grams.size;
    return total > 0 ? uniq / total : 0;
}
/** 一组数的统计量（跳过空数组） */
function stats(nums) {
    if (nums.length === 0)
        return { avg: 0, sd: 0, min: 0, max: 0, median: 0 };
    const sorted = [...nums].sort((a, b) => a - b);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - avg) ** 2, 0) / nums.length;
    const sd = Math.sqrt(variance);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { avg: +avg.toFixed(1), sd: +sd.toFixed(1), min: sorted[0], max: sorted[sorted.length - 1], median: +median.toFixed(1) };
}
function countMatches(reg, t) {
    reg.lastIndex = 0;
    const m = t.match(reg);
    return m ? m.length : 0;
}
/** 分析文本的 AI 痕迹统计特征 */
export function analyzeAiTraces(t) {
    const chars = t.replace(/[\s\u3000]/g, '').length;
    const paragraphs = splitParagraphs(t).length;
    const sentLens = splitSentences(t);
    const sentences = sentLens.length;
    const s = stats(sentLens);
    const shortPct = sentences ? (sentLens.filter(x => x < 15).length / sentences) * 100 : 0;
    const midPct = sentences ? (sentLens.filter(x => x >= 15 && x <= 30).length / sentences) * 100 : 0;
    const longPct = sentences ? (sentLens.filter(x => x > 30).length / sentences) * 100 : 0;
    const fragmentPct = sentences ? (sentLens.filter(x => x < 12).length / sentences) * 100 : 0;
    const ttr = bigramTtr(t);
    const perK = (n) => (chars > 0 ? (n / chars) * 1000 : 0);
    const connective = countMatches(CONNECTIVE_RE, t);
    const symmetry = countMatches(SYMMETRY_RE, t);
    const absolute = countMatches(ABSOLUTE_RE, t);
    const dash = (t.match(/——/g) ?? []).length;
    const ellipsis = (t.match(/……/g) ?? []).length;
    const exclaim = (t.match(/[！!]/g) ?? []).length;
    const semicolon = (t.match(/[；;]/g) ?? []).length;
    const connectivePerK = perK(connective);
    const symmetryPerK = perK(symmetry);
    const absolutePerK = perK(absolute);
    const flags = [];
    if (sentences >= 12 && s.sd < 3.5)
        flags.push(`句长标准差 ${s.sd}<3.5，节奏过于均匀（${sentences} 句）`);
    else if (sentences >= 8 && s.sd < 4.5)
        flags.push(`句长标准差 ${s.sd}<4.5，节奏偏平`);
    if (fragmentPct < 5)
        flags.push(`碎片短句仅 ${fragmentPct.toFixed(0)}%，缺少留白与残缺断句`);
    if (connectivePerK > 8)
        flags.push(`书面连接词 ${connectivePerK.toFixed(1)} 千分之，密度偏高`);
    else if (connective > 5)
        flags.push(`书面连接词 ${connective} 处，建议删减`);
    if (symmetryPerK > 3)
        flags.push(`对称并列 ${symmetryPerK.toFixed(1)} 千分之，存在模板化对仗`);
    else if (symmetry > 2)
        flags.push(`对称并列 ${symmetry} 处，注意对仗感`);
    if (absolutePerK > 4)
        flags.push(`绝对化词 ${absolutePerK.toFixed(1)} 千分之，话说得太满`);
    if (dash === 0 && ellipsis === 0 && exclaim === 0)
        flags.push('破折号/省略号/感叹号均缺失，标点节拍单调');
    if (paragraphs >= 6 && flags.length === 0)
        flags.push('段落结构较规整，留意是否"首句观点+末句总结"模板');
    const summary = `共 ${chars} 字 / ${paragraphs} 段 / ${sentences} 句；` +
        `句长 均值${s.avg} 中位${s.median} 标准差${s.sd}（短${shortPct.toFixed(0)}%/中${midPct.toFixed(0)}%/长${longPct.toFixed(0)}%，碎片${fragmentPct.toFixed(0)}%），` +
        `词汇多样性 TTR ${ttr.toFixed(2)}，` +
        `连接词 ${connectivePerK.toFixed(1)}/千字，对称 ${symmetryPerK.toFixed(1)}/千字，绝对化 ${absolutePerK.toFixed(1)}/千字` +
        `${flags.length ? `；可疑项：${flags.join('；')}` : '；未见明显统计异常'}`;
    return {
        chars, paragraphs, sentences,
        sentence: { ...s, shortPct: +shortPct.toFixed(1), midPct: +midPct.toFixed(1), longPct: +longPct.toFixed(1), fragmentPct: +fragmentPct.toFixed(1) },
        ttr: +ttr.toFixed(3),
        connectivePerK: +connectivePerK.toFixed(2), symmetryPerK: +symmetryPerK.toFixed(2), absolutePerK: +absolutePerK.toFixed(2),
        punctuation: {
            dashPerK: +perK(dash).toFixed(2), ellipsisPerK: +perK(ellipsis).toFixed(2),
            exclaimPerK: +perK(exclaim).toFixed(2), semicolonPerK: +perK(semicolon).toFixed(2),
        },
        flags, summary,
    };
}
//# sourceMappingURL=analyze.js.map