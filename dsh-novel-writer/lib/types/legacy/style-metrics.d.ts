/**
 * 六维测量。
 */
export function measureStyleMetrics(text: any): {
    metrics: {
        complexity: number;
        modifierDensity: number;
        abstractDensity: number;
        actionDensity: number;
        hedgeDensity: number;
        gapIndex: number;
    };
    detail: {
        totalChars: number;
        sentenceCount: number;
        smallClauseTotal: number;
        adjMods: number;
        advMods: number;
        abstractCount: number;
        actionCount: number;
        hedgeCount: number;
        ellipsis: number;
        dash: number;
        unfinishedCount: number;
    };
};
/**
 * 从每章测量值计算基线带（μ/σ）——style_report 用全部章，style_check 排除目标章后现算。
 */
export function computeBaselineFromPerChapter(perChapter: any, opts: any): {};
/**
 * 基线带：按章节测量 → 每维 μ/σ（含每章测量值 perChapter）。
 */
export function computeBaseline(chapters: any, opts: any): {
    baseline: {};
    perChapter: {
        file: any;
        metrics: {
            complexity: number;
            modifierDensity: number;
            abstractDensity: number;
            actionDensity: number;
            hedgeDensity: number;
            gapIndex: number;
        };
    }[];
    chapterCount: number;
};
/**
 * 偏离判定：新章 vs 基线，输出每维偏差百分比（相对 μ）与判定。
 */
export function judgeAgainstBaseline(metrics: any, baseline: any, tolerance: any): {
    verdicts: {
        metric: string;
        label: any;
        mu: any;
        value: number;
        devPct: number;
        sigma: number;
        tolerance: {
            low: number;
            high: any;
        };
        status: string;
    }[];
    outOfBand: {
        metric: string;
        label: any;
        mu: any;
        value: number;
        devPct: number;
        sigma: number;
        tolerance: {
            low: number;
            high: any;
        };
        status: string;
    }[];
    outCount: number;
    summary: string;
};
export namespace METRIC_LABELS {
    let complexity: string;
    let modifierDensity: string;
    let abstractDensity: string;
    let actionDensity: string;
    let hedgeDensity: string;
    let gapIndex: string;
}
/** 六维顺序。 */
export const METRIC_ORDER: string[];
