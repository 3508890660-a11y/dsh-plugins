import type { OutlineNode, ProjectData, ProjectMeta } from './types.js';
/** 大纲节点删除时对章节正文的处理方式 */
export type OutlineDeleteMode = 'outline' | 'archive' | 'purge';
/** 孤儿章节（有正文/记录，但大纲里已没有对应节点） */
export interface OrphanChapter {
    id: string;
    title: string;
    wordCount: number;
    hasRecord: boolean;
    hasContent: boolean;
    updatedAt: string;
}
export declare class Store {
    private dataDir;
    private cache;
    /**
     * 每项目 data.json 的磁盘指纹（mtime:size）。
     * 其他插件（character-maker / mapforge / 手工编辑）会直写 data.json，
     * 本进程缓存必须据此失效，否则会出现「界面显示旧值」以及
     * 「小说工坊再次保存时用旧缓存覆盖别人刚写入的数据」。
     */
    private stamps;
    /**
     * 每个项目「上次从磁盘读到的 revision」。
     * save() 以它做 CAS：若期间有别的插件写入（revision 已推进），
     * 直接抛 ProjectConflictError → 路由返回 409，而不是静默覆盖。
     */
    private revs;
    constructor(dataDir: string);
    private projectDir;
    private dataFile;
    /** 磁盘指纹（读不到返回空串） */
    private stampOf;
    /** 原子写 JSON + 同步磁盘指纹 */
    private persist;
    /** 创建项目 */
    createProject(meta: ProjectMeta): ProjectData;
    /** 列出全部项目（按创建时间） */
    listProjects(): ProjectMeta[];
    /** 加载项目（带缓存 + 磁盘指纹校验）；加载后迁移：卷归属推导 + 世界观地理拆分为独立 geo 库 */
    load(projectId: string): ProjectData;
    /** 项目修订号：任何保存/外部写回都会递增（data.json 的 project.revision） */
    revisionOf(projectId: string): number;
    /** ChapterRecord.volumeId 从大纲推导回填（旧数据迁移；大纲 chapter 节点 parentId → volume 节点） */
    private migrateVolumes;
    /** 旧数据迁移：worldview.geography 条目 → 独立 geo 库（保留 id/名称/内容，类型归 other；原条目从 worldview 移除）。
     *  幂等：geo 已存在同名/同 id 条目或 worldview 已无 geography 时跳过。
     *  迁移即落盘（mapforge 等外部读者直读磁盘 data.json，需立即可见）。
     *  ⚠️ 落盘用 writeJson 直写（不经过 save→load：load 在 cache.set 前重读磁盘会导致递归迁移）。
     *  二次校正：首轮迁移把非地理条目（图鉴/格局类）也搬进了 geo——这批搬回 worldview（category=geography），
     *  保证 geo 库是纯地图要素（供地图插件精确标注）。 */
    private migrateGeo;
    /**
     * 保存项目结构化数据（统一写入契约）。
     * - 走 project-contract：文件锁内比对 revision，冲突抛 ProjectConflictError（路由 → 409）；
     * - revision 由契约统一 +1，内存缓存同步更新，外部轮询据此刷新。
     * @param opts.expectedRevision 显式指定基线（默认用上次 load 读到的 revision）
     */
    save(projectId: string, opts?: {
        expectedRevision?: number;
    }): number;
    /** 章节正文存取 */
    chapterFile(projectId: string, chapterId: string): string;
    readChapterContent(projectId: string, chapterId: string): string;
    writeChapterContent(projectId: string, chapterId: string, content: string): void;
    /** 章节原文备份（AI 润色落盘前调用）：chapters/backup/<chapterId>-<ts>.md */
    writeChapterBackup(projectId: string, chapterId: string, content: string): string;
    /** 导出目录 */
    exportDir(projectId: string): string;
    /** 已导出文件清单（UI 下载区） */
    listExports(projectId: string): {
        file: string;
        size: number;
        mtime: string;
    }[];
    /** 正文归档目录（删除大纲节点时把正文移到这里，可人工找回） */
    private archiveDir;
    /**
     * 删除大纲节点（含其全部后代）。
     * mode:
     *   outline —— 只删大纲，正文与章节记录保留（成为「孤儿章节」，可在面板恢复）
     *   archive —— 删除章节记录，正文移到 chapters/archive/（默认，可找回）
     *   purge   —— 删除章节记录 + 正文（不可恢复）
     */
    deleteOutlineNode(projectId: string, nodeId: string, mode?: OutlineDeleteMode): {
        removedNodes: number;
        chapters: string[];
        archived: string[];
        purged: string[];
    } | null;
    /** 孤儿章节：有正文或章节记录，但大纲里已无对应 chapter 节点 */
    listOrphans(projectId: string): OrphanChapter[];
    /** 把孤儿章节恢复到大纲（可指定卷与章序；缺记录时按正文补一条） */
    restoreOrphan(projectId: string, chapterId: string, opts?: {
        volumeId?: string | null;
        title?: string;
        order?: number;
    }): {
        ok: boolean;
        message: string;
        node?: OutlineNode;
    };
    /** 删除项目 */
    deleteProject(projectId: string): void;
}
