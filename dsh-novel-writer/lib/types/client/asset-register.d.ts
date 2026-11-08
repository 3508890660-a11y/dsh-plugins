export interface AssetRegisterInput {
    projectId: string;
    kind: 'portrait' | 'illustration' | 'map' | 'voice' | 'other';
    /** 写入方插件 id，如 dsh-illustrator */
    source: string;
    /** 写入方任务 id（同 id 追加版本） */
    sourceId: string;
    title: string;
    /** 每个版本一个 URL（多图任务会登记成多个版本） */
    urls: string[];
    characterId?: string;
    characterName?: string;
    chapterId?: string;
    geoId?: string;
    prompt?: string;
    model?: string;
    provider?: string;
    size?: string;
    note?: string;
}
/** 登记（best-effort）：返回 ok=false 时调用方可忽略 */
export declare function registerAssets(input: AssetRegisterInput): Promise<{
    ok: boolean;
    error?: string;
}>;
