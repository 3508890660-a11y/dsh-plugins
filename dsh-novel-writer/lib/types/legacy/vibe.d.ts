/**
 * @param {object} detect  novel_settings detect 的输出（culture/scores/evidence/genre/theme）
 * @param {object} emotion novel_sentence_analysis 的 emotion 块
 * @returns 氛围光谱 { axes, top, conclusion, confidence, evidence }
 */
export function computeVibe(detect: object, emotion: object, text?: string): {
    axes: {
        key: string;
        name: any;
        score: number;
        signals: any;
    }[];
    top: {
        name: any;
        score: number;
    }[];
    conclusion: string;
    confidence: number;
    evidence: string[];
};
/**
 * 计算全书与各风格原型的语义距离表。
 * @param {string} text 全书文本
 * @param {object} emb embedding 模块（embed/cosine/chunkText/fingerprint）
 * @param {object} [opts] 可选 { root, book }——提供后段落向量按书缓存（内容指纹失效重建，不靠版本号）
 * @returns {Array<{name:string,score:number}>} 按相似度降序
 */
export function semanticStyleDistances(text: string, emb: object, opts?: object): Array<{
    name: string;
    score: number;
}>;
export namespace STYLE_PROTOTYPES {
    let 克苏鲁诡异: string[];
    let 甜宠日常: string[];
    let 热血燃向: string[];
    let 文艺忧郁: string[];
    let 悬疑紧张: string[];
    let 压抑致郁: string[];
    let 温馨治愈: string[];
    let 荒诞吐槽: string[];
    let 情欲暧昧: string[];
    let 史诗庄严: string[];
    let 怀旧乡愁: string[];
    let 孤独疏离: string[];
}
