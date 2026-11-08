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
export interface AiTraceReport {
    chars: number;
    paragraphs: number;
    sentences: number;
    sentence: {
        avg: number;
        sd: number;
        min: number;
        max: number;
        median: number;
        shortPct: number;
        midPct: number;
        longPct: number;
        fragmentPct: number;
    };
    ttr: number;
    connectivePerK: number;
    symmetryPerK: number;
    absolutePerK: number;
    punctuation: {
        dashPerK: number;
        ellipsisPerK: number;
        exclaimPerK: number;
        semicolonPerK: number;
    };
    flags: string[];
    summary: string;
}
/** 分析文本的 AI 痕迹统计特征 */
export declare function analyzeAiTraces(t: string): AiTraceReport;
