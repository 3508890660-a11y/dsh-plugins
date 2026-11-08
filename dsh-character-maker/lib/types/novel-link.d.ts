export interface NovelCharacter {
    id: string;
    name: string;
    role: string;
    appearance?: string;
    personality?: string;
    background?: string;
    goal?: string;
    relationships?: unknown;
    arc?: unknown;
    currentState?: {
        location?: string;
        condition?: string;
        possessions?: string[];
        notes?: string;
    };
    personalityProfile?: string;
    [k: string]: any;
}
export interface NovelProject {
    id: string;
    name: string;
    genre: string;
    style?: string;
    premise?: string;
}
export declare class NovelLink {
    private dataDir;
    constructor(dataDir: string);
    get root(): string;
    private projectFile;
    private settingsFile;
    listProjects(): {
        id: string;
        name: string;
        genre: string;
        characterCount: number;
    }[];
    listCharacters(projectId: string): NovelCharacter[];
    getCharacter(projectId: string, characterId: string): NovelCharacter | null;
    /**
     * §8.20：取项目上下文（premise + genre/style + 大纲概要），供「动机」自动锚定故事用。
     * outline 支持三种常见形态：数组(平铺节拍) / 树(含 children) / 卷->章->节拍。
     * 对标题/摘要做紧凑递归拼接，上限约 600 字，避免塞爆提示词。
     */
    projectContext(projectId: string): {
        premise: string;
        genre: string;
        style: string;
        outlineText: string;
    };
    /** 大纲 → 紧凑文本（标题＋摘要，递归卷/章；不落每个节拍细节） */
    private serializeOutline;
    /**
     * §8.7 修复：本文件原有的 guessEnneagramFromText（与 engine.ts 版本词表不同、过滤规则也不同）
     * 已删除——统一使用 engine.ts 的加权实现 `guessEnneagramScored / guessEnneagramFromText`。
     */
    /** 写回 personalityProfile 到 data.json（经统一写入契约） */
    writePersonalityProfile(projectId: string, characterId: string, profile: string, opts?: {
        expectedRevision?: number;
    }): {
        ok: boolean;
        message: string;
        revision?: number;
        conflict?: boolean;
    };
    /**
     * 通用：更新某个 novel 人物的若干字段（统一写入契约 §8.12）。
     *
     * 不再自己「读整包 → 改 → 写整包」：改走 project-contract 的
     * `mutateProjectFile`——文件锁内基于最新盘面定位人物、只应用补丁、revision 统一 +1。
     * 这样即使小说工坊同时保存，也不会把对方刚写的字段覆盖掉；
     * 若带 expectedRevision 且已被推进，返回冲突信息而不是静默成功。
     */
    updateCharacter(projectId: string, characterId: string, patch: Record<string, unknown>, opts?: {
        expectedRevision?: number;
    }): {
        ok: boolean;
        message: string;
        revision?: number;
        conflict?: boolean;
    };
    private readProject;
    private readSettings;
}
