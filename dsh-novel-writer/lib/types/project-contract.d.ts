/** 项目文件快照 */
export interface ProjectFileState {
    data: Record<string, any>;
    /** data.json 的 project.revision（缺失按 0） */
    revision: number;
    mtimeMs: number;
    size: number;
}
/** 写入冲突：调用方读到的版本已被别人推进 */
export declare class ProjectConflictError extends Error {
    readonly code = "revision_conflict";
    readonly expected: number;
    readonly current: number;
    constructor(expected: number, current: number);
}
export declare function projectDataFile(dataDir: string, projectId: string): string;
/** 读取项目文件（不加锁，用于展示；写入请用 mutate/write） */
export declare function readProjectFile(dataDir: string, projectId: string): ProjectFileState;
export interface WriteOptions {
    /** 期望的起始 revision；提供且不匹配则抛 ProjectConflictError */
    expectedRevision?: number;
    /** 写入方标识，仅用于日志/排障 */
    source?: string;
    /** false = 不改 project.updatedAt（迁移类写入） */
    touch?: boolean;
}
/**
 * 读-改-写：在锁内基于**最新盘面**应用 mutator，成功后 revision+1。
 * 补丁型写入（改某个人物/某条地理）一律用这个，避免整包覆盖。
 */
export declare function mutateProjectFile<T>(dataDir: string, projectId: string, mutator: (data: Record<string, any>, ctx: {
    revision: number;
}) => T, opts?: WriteOptions): {
    result: T;
    revision: number;
};
/**
 * 整包写入（小说工坊 Store.save 专用）：以 CAS 保护，revision 统一由本模块推进。
 * `data` 会被就地更新 revision 字段，调用方的内存缓存因此保持同步。
 */
export declare function writeProjectFile(dataDir: string, projectId: string, data: Record<string, any>, opts?: WriteOptions): {
    revision: number;
};
