/** 文本 → 段落块：空行分段；无空行时每行视为一段。过滤 Markdown 标题。 */
export function splitBlocks(text: any): string[];
/** 段落 → 句子：按 。！？… 分句，吞并连续结束符与后随的闭合引号。 */
export function splitSentences(block: any): string[];
/**
 * 单句分类（优先级：对话 > 心理 > 反问 > 疑问 > 感叹 > 祈使 > 环境 > 省略 > 陈述）。
 * 引语优先：引号内的直接引语算对话；引号内含心理标记（内心独白）算心理。
 */
export function classifySentence(raw: any): {
    type: string;
    text: string;
    quoted: boolean;
};
/** 跑长编码压缩排列序列（来自 v0.4.0）：S×8 ENV×2 PSY×3 … */
export function compressSequence(codes: any, maxRuns?: number): string;
/** 生成给模型的节奏建议文本（来自 v0.4.0 buildGuidance，适配九类）。 */
export function buildGuidance(ratios: any, topPatterns: any, chapterSequences: any): string;
/** v2.1.0：查找多方向载体命中（返回所有方向条目 + 上下文命中触发词）。 */
export function matchAmbiguousCarriers(text: any): {
    word: string;
    ctx: any;
    entries: {
        triggerHit: string | null;
        valence: number;
        label: string;
        triggers: string[];
    }[];
}[];
/** v1.6.0 隐性载体扫描：意象/动作 → 负向/正向占比 + top 载体 + 脆弱标记。 */
export function implicitEmotionScan(text: any, semResolver?: null): {
    negative: number;
    positive: number;
    ambiguousRatio: number;
    fragile: boolean;
    totalHits: number;
    ambiguous: {
        word: string;
        reason: string;
        ctx: any;
    }[];
    topCarriers: {
        carrier: any;
        label: any;
        count: any;
    }[];
};
/** v1.6.0 滑动窗口：每 100 字算平均效价 → 时间序列 + 正负词计数。 */
export function valenceSeries(text: any, winChars?: number): {
    series: number[];
    posWords: number;
    negWords: number;
    windowCount: number;
    windowPosNeg: {
        pos: number;
        neg: number;
    }[];
};
/** v1.6.0 三指标：方差 V + 相邻撕裂 V_adj + 斜率 Δ（最小二乘+鲁棒版）+ 矛盾指数 C。 */
export function valenceStats(text: any): {
    windows: number;
    variance: number;
    adjVariance: number;
    delta: number;
    deltaRobust: number;
    conflict: number;
    posRatio: number;
    negRatio: number;
    meanValence: number;
};
/** v1.6.0 显隐对比：显性均值 vs 隐性方向 → 表里不一。 */
export function explicitImplicitCompare(explicitMean: any, implicit: any): {
    explicitImplicitConflict: boolean;
    explicitSign: string;
    implicitSign: string;
};
/** v1.6.0 复合情感共现（规则）：同段多情感类别 → 高频矛盾对。 */
export function compositeEmotionPairs(blocks: any): {
    pair: any;
    count: any;
    label: any;
}[];
/** v1.6.0 单章分布（五维 clean）→ 熵/多样性/主次。 */
export function chapterEmotionStats(counts: any): {
    entropy: number;
    diversity: number;
    dominant: string;
    dominantRatio: number;
    secondary: string;
    secondaryRatio: number;
} | null;
/** v1.6.0 全书聚合：复杂度评分 0-1（熵归一化0.5 + 多样性0.25 + 主次冲突0.25）+ 章间漂移。 */
export function emotionComplexity(perChapter: any): {
    score: number;
    level: string;
    entropy: number;
    maxEntropy: number;
    diversity: number;
    dominant: string;
    dominantRatio: number;
    secondary: string;
    secondaryRatio: number;
    conflict: string;
    conflictStrength: number;
    chapterDrift: {
        meanEntropy: number;
        entropyVariance: number;
        swinging: boolean;
    };
};
/**
 * v1.6.0 情感量化入口：三指标 + 显隐对比 + 复杂度 + 复合共现（纯规则 0 token）。
 */
export function emotionalQuantification(text: any, perChapter: any, blocks: any, semResolver?: null): {
    stats: {
        windows: number;
        variance: number;
        adjVariance: number;
        delta: number;
        deltaRobust: number;
        conflict: number;
        posRatio: number;
        negRatio: number;
        meanValence: number;
    };
    implicit: {
        negative: number;
        positive: number;
        ambiguousRatio: number;
        fragile: boolean;
        totalHits: number;
        ambiguous: {
            word: string;
            reason: string;
            ctx: any;
        }[];
        topCarriers: {
            carrier: any;
            label: any;
            count: any;
        }[];
    };
    compare: {
        explicitImplicitConflict: boolean;
        explicitSign: string;
        implicitSign: string;
    };
    complexity: {
        score: number;
        level: string;
        entropy: number;
        maxEntropy: number;
        diversity: number;
        dominant: string;
        dominantRatio: number;
        secondary: string;
        secondaryRatio: number;
        conflict: string;
        conflictStrength: number;
        chapterDrift: {
            meanEntropy: number;
            entropyVariance: number;
            swinging: boolean;
        };
    };
    composites: {
        pair: any;
        count: any;
        label: any;
    }[];
};
/**
 * 全书/单章句式模式分析主入口（v1.6.0 合并版）。
 * @param text 正文文本。
 * @param options { top: 句式模板条数（默认 8）, maxSentences: 采样上限（默认 20000）, chapterTexts: [{chapter, text}] 可选分章输入 }
 * @returns 结构化分析结果（与 novel_sentence_analysis 输出 schema 一致）。
 */
export function analyzeText(text: any, options?: any): {
    totalChars: any;
    totalSentences: number;
    categories: {
        type: string;
        label: any;
        count: number;
        ratio: number;
        avgLength: number;
        examples: never[];
    }[];
    transitions: {
        from: any;
        to: any;
        count: any;
    }[];
    motifs: {
        pattern: any;
        count: any;
    }[];
    paragraphs: {
        total: number;
        avgSentences: number;
        opening: {
            type: any;
            count: any;
        }[];
        closing: {
            type: any;
            count: any;
        }[];
        dialogueOnly: number;
        psychologyOnly: number;
        mixed: number;
        exchanges: number;
    };
    lengths: {
        avg: number;
        median: any;
        shortRatio: number;
        mediumRatio: number;
        longRatio: number;
        distribution: {
            range: string | ((len: any) => boolean);
            count: number;
        }[];
    };
    style: {
        dialogueRatio: number;
        psychologyRatio: number;
        environmentRatio: number;
        questionRatio: number;
        exclamationRatio: number;
        shortSentenceRatio: number;
        longSentenceRatio: number;
        subjectivityIndex: number;
        emotionDensity: number;
        avgSentenceLength: number;
        firstPersonDensity: number;
    };
    emotion: {
        dominant: string;
        cleanDominant: string;
        confidence: string;
        caveat: string;
        aiAction: string;
        pollution: {
            r18: number;
            battle: number;
            horror: number;
            r18Per1000: number;
            battlePer1000: number;
            horrorPer1000: number;
        };
        scores: {
            emotion: string;
            label: any;
            count: number;
            words: any[];
        }[];
        cleanScores: {
            emotion: string;
            label: any;
            count: number;
        }[];
        intensity: number;
        topWords: {
            word: any;
            count: any;
            emotion: string;
        }[];
        curve: {
            segment: number;
            dominant: string;
            label: any;
            intensity: number;
        }[];
        quantification: {
            stats: {
                windows: number;
                variance: number;
                adjVariance: number;
                delta: number;
                deltaRobust: number;
                conflict: number;
                posRatio: number;
                negRatio: number;
                meanValence: number;
            };
            implicit: {
                negative: number;
                positive: number;
                ambiguousRatio: number;
                fragile: boolean;
                totalHits: number;
                ambiguous: {
                    word: string;
                    reason: string;
                    ctx: any;
                }[];
                topCarriers: {
                    carrier: any;
                    label: any;
                    count: any;
                }[];
            };
            compare: {
                explicitImplicitConflict: boolean;
                explicitSign: string;
                implicitSign: string;
            };
            complexity: {
                score: number;
                level: string;
                entropy: number;
                maxEntropy: number;
                diversity: number;
                dominant: string;
                dominantRatio: number;
                secondary: string;
                secondaryRatio: number;
                conflict: string;
                conflictStrength: number;
                chapterDrift: {
                    meanEntropy: number;
                    entropyVariance: number;
                    swinging: boolean;
                };
            };
            composites: {
                pair: any;
                count: any;
                label: any;
            }[];
        };
    };
    chapterPatterns: {
        chapter: string;
        sequence: string;
    }[];
    guidance: string;
    density: {
        actionVerbsPer1000: number;
        actionChainRatio: number;
        actionChainExamples: string[];
        objectNounsPer1000: number;
        sensePer1000: number;
        sense: {
            visual: number;
            auditory: number;
            tactile: number;
            olfactory: number;
            temperature: number;
        };
    };
    fingerprint: string;
};
/** 两篇文本的风格指纹相似度（0~1）：句式分布 + 句长 + 主观性的余弦相似度。 */
export function fingerprintSimilarity(a: any, b: any): number;
/** 风格偏差清单：b 相对 a 的显著差异（阈值可调）。 */
export function styleDiffs(a: any, b: any, threshold?: number): {
    dimension: string;
    diff: number;
    note: string;
}[];
/** 细节密度统计（v0.8.0）：动作链/物件名词/感官词，按千字归一。 */
export function densityOf(text: any): {
    actionVerbsPer1000: number;
    actionChainRatio: number;
    actionChainExamples: string[];
    objectNounsPer1000: number;
    sensePer1000: number;
    sense: {
        visual: number;
        auditory: number;
        tactile: number;
        olfactory: number;
        temperature: number;
    };
};
export function dutirEmotionOf(word: any): any;
/**
 * dsh-novel-writer — 句式模式分析引擎 (v1.6.0 合并版)
 *
 * 融合 v0.3.0（深度分析）与 v0.4.0（轻量节奏参考）两版引擎：
 *   - 九类句式：陈述 / 环境 / 心理 / 对话 / 疑问 / 反问 / 感叹 / 祈使 / 省略留白
 *   - 排列规律：句式转移、2/3 连句模板、段首段尾句式、按章节的压缩排列序列（跑长编码）
 *   - 风格特征：句长分布、短长句占比、对话/心理/环境密度、主观性指数、风格指纹
 *   - 主观情感：轻量情感词典（喜/怒/哀/惧/惊）+ 强度副词加权，输出情感曲线
 *   - 节奏建议：给模型的 guidance 文本（句式分布 + 高频组合 + 章节节奏序列）
 *   - 采样上限：maxSentences 保护超长文本（默认 20000 句）
 *
 * 零依赖、确定性规则，不调用任何外部服务。
 */
export const CATEGORY_LABELS: Readonly<{
    statement: "陈述";
    environment: "环境";
    psychology: "心理";
    dialogue: "对话";
    question: "疑问";
    "rhetoric-question": "反问";
    exclamation: "感叹";
    imperative: "祈使";
    ellipsis: "省略留白";
}>;
/** 输出固定顺序。 */
export const CATEGORY_ORDER: readonly string[];
/** 短码（压缩序列/指纹用）。 */
export const TYPE_CODE: Readonly<{
    statement: "S";
    environment: "ENV";
    psychology: "PSY";
    dialogue: "DLG";
    question: "Q";
    "rhetoric-question": "RQ";
    exclamation: "EX";
    imperative: "IMP";
    ellipsis: "…";
}>;
