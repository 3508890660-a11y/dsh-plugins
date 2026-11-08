export interface WorkbenchContext {
    projectId: string;
    chapterId: string;
    characterId: string;
    characterName: string;
    /** 最近一次写入的时间戳（ms） */
    updatedAt: number;
    /** 写入方插件 id，用于避免自己写自己读的回环 */
    source: string;
}
/** 读取当前共享上下文（localStorage 不可用时返回空值） */
export declare function readContext(): WorkbenchContext;
/**
 * 切换「当前项目」：项目变了就顺带清空章节/角色。
 * 一次写入完成，避免先清后设产生两个中间态事件。
 */
export declare function setProjectContext(projectId: string, source: string): void;
/**
 * 合并写入共享上下文。
 * 只覆盖传入的非空字段；值无变化时不写、不发事件（避免面板之间来回刷）。
 */
export declare function patchContext(patch: Partial<WorkbenchContext>, source: string): void;
/** 清空章节/角色（例如切换项目时） */
export declare function clearContextFields(fields: Array<'chapterId' | 'characterId' | 'characterName'>, source: string): void;
/** 订阅共享上下文变化，返回取消订阅函数 */
export declare function subscribeContext(fn: (ctx: WorkbenchContext) => void): () => void;
/**
 * React hook：拿到共享上下文，并在其他面板改动时重渲染。
 * `source` 用于标记本面板写入来源；返回的第二个值是写入函数。
 */
export declare function useWorkbenchContext(source: string): [WorkbenchContext, (patch: Partial<WorkbenchContext>) => void];
