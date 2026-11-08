/** 状态探测（不触发加载）。 */
export function status(): {
    modelPresent: boolean;
    loaded: boolean;
    error: null;
};
/** 可用性（懒加载后返回；失败不抛）。 */
export function isAvailable(): Promise<boolean>;
/** 嵌入单段文本 → 512 维归一化向量。 */
export function embed(text: any): Promise<number[] | null>;
/** 批量嵌入（并发 4）。 */
export function embedMany(chunks: any): Promise<any[]>;
/** 余弦相似度（长度防御）。 */
export function cosine(a: any, b: any): number;
/** 语义检索（query 维度跟随索引：首次直出 512 维 / 缓存命中 128 维）。 */
export function search(query: any, index: any, k?: number): Promise<any>;
/** 保存索引（v2.6.0：统一 128 维 + 4 位小数降精度 + zstd 压缩，体积约 1/10；fp=内容指纹）。 */
export function saveIndex(root: any, book: any, index: any, fp?: string): boolean;
/** 读取索引缓存（不存在返回 null）。 */
export function loadIndex(root: any, book: any): any;
/** 读取索引缓存 + 内容指纹（旧格式无 fp 时 fp=null，视为失效需重建；不靠版本号失效）。 */
export function loadIndexMeta(root: any, book: any): {
    items: any;
    fp: any;
};
/** 内容指纹（sha1，id+text）：章节内容/章节集变化 → 指纹变化 → 索引自动重建（不依赖版本号）。 */
export function fingerprint(chunks: any): string;
/** 单段文本哈希（增量索引对比用，短 sha1）。 */
export function textHash(text: any): string;
/**
 * v2.6.0 增量构建索引：按段落 id + 文本哈希复用旧向量，只对新/变化的段落做推理。
 * 输出统一 128 维（新向量降采样），与缓存/检索维度一致。
 * @param {Array<{id,text}>} chunks 当前全部段落
 * @param {Array<{id,text,th,vec}>|null} oldItems 旧索引条目（loadIndexMeta 的 items）
 */
export function buildIndexIncremental(chunks: Array<{
    id: any;
    text: any;
}>, oldItems: Array<{
    id: any;
    text: any;
    th: any;
    vec: any;
}> | null): Promise<any[]>;
/** 全文 → 语义段落（按空行/150 字切块，带章节标记）。 */
export function chunkText(text: any): any[];
/** 显式释放（仅重置单例，WASM 内存由 GC 回收）。 */
export function reset(): void;
/**
 * v2.0.0 语义隐性情感检测：用情感原型句扫全书索引，聚合出"词表外疑似意象段落"。
 * @param index 全书语义索引（[{id, chapter, text, vec}]，128 维）
 * @param topPerEmotion 每个情感原型取前 N 段（默认 2）
 * @returns { hits: [{id, chapter, text, top, score}], distribution: {情感: 段数} }
 */
export function detectImplicitEmotions(index: any, topPerEmotion?: number): hits;
/**
 * v2.0.0 语义隐性情感：情感原型句（规则词表之外，找"语义相近但无关键词"的段落）。
 * 每个原型是一句典型情感场景，与全书段落向量做余弦，高分段=疑似该情感的隐性表达。
 */
export const IMPLICIT_EMOTION_PROTOTYPES: readonly {
    emotion: string;
    text: string;
}[];
export const MODEL_DIR: string;
/** 索引落盘缓存路径（按书）。 */
export function cachePath(root: any, book: any): string;
