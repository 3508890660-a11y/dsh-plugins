export type AssetKind = 'portrait' | 'illustration' | 'map' | 'voice' | 'other';
export declare const ASSET_KINDS: AssetKind[];
/** 单次生成的产物 */
export interface AssetVersion {
    /** 其它插件提供的相对 URL（同源可直接 <img src>） */
    url: string;
    /** 本地文件绝对路径（配音等需要下载/播放的场景） */
    file?: string;
    prompt?: string;
    model?: string;
    provider?: string;
    size?: string;
    note?: string;
    createdAt: string;
}
export interface AssetRecord {
    id: string;
    kind: AssetKind;
    title: string;
    /** 写入方插件 id */
    source: string;
    /** 写入方内部任务 id */
    sourceId: string;
    characterId: string;
    characterName: string;
    chapterId: string;
    geoId: string;
    currentVersion: number;
    versions: AssetVersion[];
    createdAt: string;
    updatedAt: string;
}
export interface AssetInput {
    id?: string;
    kind?: string;
    title?: string;
    source?: string;
    sourceId?: string;
    characterId?: string;
    characterName?: string;
    chapterId?: string;
    geoId?: string;
    url?: string;
    file?: string;
    prompt?: string;
    model?: string;
    provider?: string;
    size?: string;
    note?: string;
}
export declare class AssetStore {
    private dataDir;
    constructor(dataDir: string);
    private file;
    private load;
    private save;
    list(projectId: string, filter?: {
        kind?: string;
        characterId?: string;
        chapterId?: string;
    }): AssetRecord[];
    /** 登记一次生成产物：同 id 追加版本，不同 id 新建 */
    upsert(projectId: string, input: AssetInput): AssetRecord;
    setCurrent(projectId: string, assetId: string, index: number): AssetRecord | null;
    remove(projectId: string, assetId: string): boolean;
    /** 只清登记，不删源文件（源文件归各自插件管） */
    clearProject(projectId: string): void;
}
