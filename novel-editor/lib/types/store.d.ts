export interface ProjectMeta {
    id: string;
    name: string;
    genre?: string;
    style?: string;
    createdAt?: string;
    updatedAt?: string;
    chapterCount?: number;
}
export interface CharacterBrief {
    name: string;
    aliases: string[];
    role?: string;
    personality?: string;
    goal?: string;
    background?: string;
}
/** 宽松的项目结构（只取 novel-editor 需要的字段） */
export interface ProjectData {
    project: {
        id: string;
        name: string;
        genre?: string;
        style?: string;
        createdAt?: string;
        updatedAt?: string;
    };
    outline: unknown[];
    chapters: {
        id: string;
        title: string;
        order?: number;
    }[];
    characters: CharacterBrief[];
    [key: string]: unknown;
}
export declare class MiniStore {
    private dataDir;
    constructor(dataDir: string);
    private projectDir;
    private dataFile;
    /** 列出全部项目（无正文的项目排除） */
    listProjects(): ProjectMeta[];
    load(projectId: string): ProjectData;
    /** 章节正文（与 dsh-novel-writer store.chapterFile 一致） */
    chapterFile(projectId: string, chapterId: string): string;
    readChapterContent(projectId: string, chapterId: string): string;
    /** 原子写正文（tmp + rename，与 dsh-novel-writer 相同策略，避免半写） */
    writeChapterContent(projectId: string, chapterId: string, content: string): void;
    /** 原文备份：chapters/backup/<chapterId>-<ts>.md，返回备份路径 */
    writeChapterBackup(projectId: string, chapterId: string, content: string): string;
}
