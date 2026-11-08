export interface StyleCardInfo {
    /** 绑定 id：文件名去 .md（唯一、稳定，供持久化引用） */
    key: string;
    /** 卡片文件名（含 .md） */
    file: string;
    /** frontmatter title，如 `文风·米泽穗信（冰菓/寻狗事务所）`（检索主键） */
    title: string;
    category: string;
    tags: string[];
    kind: '文风' | '手法' | '其他';
}
export interface StyleCard extends StyleCardInfo {
    /** frontmatter 之后的正文 markdown */
    body: string;
}
/**
 * 蒸馏：把一张长篇卡片的「生成相关」章节浓缩成紧凑指引块（capChars 上限，不含指令头）。
 * 文风卡保留：一句话定位 / 题材与叙事 / 文风指纹 / 适用场景；
 * 手法卡保留：一句话定位 / 核心手法 / 可套用句式骨架 / 反模式。
 * 剔除：原文采样、语法信息/语料信息、参考卡、source 等元数据。
 */
export declare function distillCard(card: StyleCard, capChars: number): string;
export declare class StyleKb {
    private cardsDir;
    private cache;
    /** rootDir 为 style-kb 根目录（含 cards/ 子目录）；空或不可达 → available=false */
    constructor(rootDir?: string);
    get available(): boolean;
    get rootDir(): string;
    get cardsDirname(): string;
    private scan;
    /** 列出卡片；可按 tag / 标题·作者·作品子串过滤 */
    list(opts?: {
        tag?: string;
        q?: string;
    }): StyleCardInfo[];
    get count(): number;
    /** 读取单卡完整内容；key=文件名去 .md */
    read(key: string): StyleCard | null;
    /**
     * 柔性解析用户输入 → 卡片 key：
     * 1) 精确 key/file/title；2) 归一化后唯一前缀匹配（title 或 key）。
     * 返回 { key, matched }；无匹配或歧义时 matched=false 并给 hint。
     */
    resolve(ref: string): {
        key: string;
        matched: boolean;
        hint?: string;
    };
    /** 把一组 key 蒸馏成注入块；miss 的 key 跳过；超过 maxCards 的 key 追加提示。返回 '' 表示无可注入内容 */
    distillKeys(keys: string[], capChars?: number, maxCards?: number): string;
}
