import type { CharacterModel, QuestionnaireResult, Interaction } from './types.js';
/** 当前数据 schema 版本（1/2 = 旧版 dsh-character-maker 数据；3 = 本版：完整问卷记录 + 类型化动态字段） */
export declare const SCHEMA_VERSION = 3;
interface DataFile {
    schemaVersion: number;
    revision: number;
    characters: CharacterModel[];
    quizResults: QuestionnaireResult[];
    interactions: Interaction[];
}
export declare class CharacterStore {
    private dataDir;
    private file;
    /** 迁移日志（本次进程内累计，供 /status 展示） */
    private migrationNotes;
    constructor(dataDir: string);
    load(): DataFile;
    /** §8.2：按 schemaVersion 逐级迁移到当前版本（幂等，仅首次执行会落盘） */
    private migrate;
    /** 迁移日志（挂到 /status 与角色卡说明） */
    getMigrationNotes(): string[];
    save(data: DataFile): void;
    /** 当前数据版本（增量变化检测，供 UI 轮询同步） */
    getRevision(): number;
    /** 当前 schema 版本（落盘值） */
    getSchemaVersion(): number;
    listCharacters(): CharacterModel[];
    getCharacter(id: string): CharacterModel | null;
    findBySource(projectId: string, characterId: string): CharacterModel | null;
    upsertCharacter(ch: CharacterModel): CharacterModel;
    deleteCharacter(id: string): boolean;
    /**
     * 记录一次问卷作答。传完整字段时可复盘/重算；只传 kind 时退化为旧行为。
     * 保留上限 500 条（原 50 条对"对比历史"太紧）。
     */
    addQuizResult(result: Partial<QuestionnaireResult> & {
        kind: QuestionnaireResult['kind'];
    }): QuestionnaireResult;
    /** 全部作答记录（可按角色过滤） */
    listQuizResults(characterId?: string): QuestionnaireResult[];
    /** 某角色某问卷的最近一次作答（用于对比/重算） */
    latestQuizResult(kind: QuestionnaireResult['kind'], characterId?: string): QuestionnaireResult | null;
    listInteractions(projectId?: string): Interaction[];
    getInteraction(id: string): Interaction | null;
    findInteraction(aKey: string, bKey: string, projectId?: string): Interaction | null;
    upsertInteraction(it: Interaction): Interaction;
    deleteInteraction(id: string): boolean;
}
export {};
