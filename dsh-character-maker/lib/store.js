/**
 * 独立角色库持久化：dataDir/characters.json（角色模型 + 问卷记录 + 角色互动）
 *
 * ⚠️ 数据同步：每次落盘都会递增 data.revision，客户端轮询 /revision，
 * 发现版本变化即整体刷新——保证工具在对话里产生的更新（角色/互动）自动同步进 UI。
 *
 * §8.1 修复：quizResults 由「只存 {kind, finishedAt}」升级为存完整结果
 *            （answers 原始作答 + scores 计分明细 + characterId + missing），可复盘/重算/对比历史。
 * §8.2 修复：引入 schemaVersion + 自动迁移（旧数据 enneagram 文案漂移、遗留 persona 字段等）。
 * §8.5 修复：读损坏时先备份为 characters.corrupt-<ts>.json 再返回空结构，不再静默丢数据。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateCharacter, healCharacter } from './migrate.js';
/** 当前数据 schema 版本（1/2 = 旧版 dsh-character-maker 数据；3 = 本版：完整问卷记录 + 类型化动态字段） */
export const SCHEMA_VERSION = 3;
function emptyData() {
    return { schemaVersion: SCHEMA_VERSION, revision: 0, characters: [], quizResults: [], interactions: [] };
}
export class CharacterStore {
    dataDir;
    file;
    /** 迁移日志（本次进程内累计，供 /status 展示） */
    migrationNotes = [];
    constructor(dataDir) {
        this.dataDir = dataDir;
        mkdirSync(dataDir, { recursive: true });
        this.file = join(dataDir, 'characters.json');
        if (!existsSync(this.file))
            this.save(emptyData());
    }
    load() {
        let raw;
        try {
            raw = readFileSync(this.file, 'utf8');
        }
        catch {
            return emptyData();
        }
        try {
            const d = JSON.parse(raw);
            const data = {
                schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1,
                revision: typeof d.revision === 'number' ? d.revision : 0,
                characters: Array.isArray(d.characters) ? d.characters : [],
                quizResults: Array.isArray(d.quizResults) ? d.quizResults : [],
                interactions: Array.isArray(d.interactions) ? d.interactions : [],
            };
            return this.migrate(data);
        }
        catch (e) {
            // §8.5：不再静默丢数据——先备份坏文件再返回空结构
            const bak = this.file.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`;
            try {
                copyFileSync(this.file, bak);
                this.migrationNotes.push(`检测到 characters.json 损坏，已备份到 ${bak}：${String(e).slice(0, 200)}`);
            }
            catch { /* 备份失败也继续 */ }
            return emptyData();
        }
    }
    /** §8.2：按 schemaVersion 逐级迁移到当前版本（幂等，仅首次执行会落盘） */
    migrate(data) {
        // 先做一遍幂等自愈（补齐后加派生的字段，如 levelName），与版本无关
        let healed = 0;
        for (const ch of data.characters) {
            try {
                if (healCharacter(ch))
                    healed += 1;
            }
            catch { /* 单个失败不影响其他 */ }
        }
        if (data.schemaVersion >= SCHEMA_VERSION) {
            if (healed > 0) {
                this.migrationNotes.push(`已为 ${healed} 个角色补齐派生素材字段（levelName）`);
                try {
                    this.save(data);
                }
                catch { /* 落盘失败下次再试 */ }
            }
            return data;
        }
        const from = data.schemaVersion;
        const notes = [];
        for (const ch of data.characters) {
            try {
                migrateCharacter(ch, m => notes.push(m));
            }
            catch (e) {
                notes.push(`角色「${ch?.name ?? '?'}」迁移失败，已保留原样：${String(e).slice(0, 160)}`);
            }
        }
        // 旧版 quizResults：只有 kind+finishedAt，补 id 便于历史引用
        for (const q of data.quizResults) {
            if (!q.id)
                q.id = 'q-' + Math.random().toString(36).slice(2, 10);
        }
        data.schemaVersion = SCHEMA_VERSION;
        // 迁移前留档，便于用户回滚
        try {
            const bak = this.file.replace(/\.json$/, '') + `.pre-v${SCHEMA_VERSION}.bak`;
            if (existsSync(this.file) && !existsSync(bak))
                copyFileSync(this.file, bak);
        }
        catch { /* 留档失败不阻断 */ }
        this.migrationNotes.push(`characters.json 已从 schemaVersion ${from} 迁移到 ${SCHEMA_VERSION}`);
        for (const n of notes.slice(0, 40))
            this.migrationNotes.push(n);
        try {
            this.save(data);
        }
        catch { /* 迁移落盘失败下次再试 */ }
        return data;
    }
    /** 迁移日志（挂到 /status 与角色卡说明） */
    getMigrationNotes() {
        return this.migrationNotes.slice();
    }
    save(data) {
        data.schemaVersion = SCHEMA_VERSION;
        data.revision = (data.revision ?? 0) + 1;
        const tmp = this.file + '.tmp';
        writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        renameSync(tmp, this.file);
    }
    /** 当前数据版本（增量变化检测，供 UI 轮询同步） */
    getRevision() {
        try {
            return this.load().revision;
        }
        catch {
            return 0;
        }
    }
    /** 当前 schema 版本（落盘值） */
    getSchemaVersion() {
        const raw = readFileSync(this.file, 'utf8');
        try {
            return JSON.parse(raw).schemaVersion ?? 1;
        }
        catch {
            return 0;
        }
    }
    listCharacters() {
        return this.load().characters;
    }
    getCharacter(id) {
        return this.load().characters.find(c => c.id === id) ?? null;
    }
    findBySource(projectId, characterId) {
        return this.load().characters.find(c => c.source?.kind === 'novel' && c.source.projectId === projectId && c.source.characterId === characterId) ?? null;
    }
    upsertCharacter(ch) {
        const data = this.load();
        const now = new Date().toISOString();
        if (!ch.id)
            ch.id = 'c-' + Math.random().toString(36).slice(2, 10);
        ch.updatedAt = now;
        if (!ch.createdAt)
            ch.createdAt = now;
        const i = data.characters.findIndex(c => c.id === ch.id);
        if (i >= 0)
            data.characters[i] = ch;
        else
            data.characters.push(ch);
        this.save(data);
        return ch;
    }
    deleteCharacter(id) {
        const data = this.load();
        const before = data.characters.length;
        data.characters = data.characters.filter(c => c.id !== id);
        this.save(data);
        return data.characters.length < before;
    }
    // ── 问卷作答记录（§8.1：存完整结果） ──
    /**
     * 记录一次问卷作答。传完整字段时可复盘/重算；只传 kind 时退化为旧行为。
     * 保留上限 500 条（原 50 条对"对比历史"太紧）。
     */
    addQuizResult(result) {
        const data = this.load();
        const rec = {
            id: result.id ?? 'q-' + Math.random().toString(36).slice(2, 10),
            kind: result.kind,
            characterId: result.characterId,
            answers: result.answers,
            scores: result.scores,
            summary: result.summary,
            missing: result.missing,
            finishedAt: result.finishedAt ?? new Date().toISOString(),
        };
        data.quizResults.unshift(rec);
        if (data.quizResults.length > 500)
            data.quizResults = data.quizResults.slice(0, 500);
        this.save(data);
        return rec;
    }
    /** 全部作答记录（可按角色过滤） */
    listQuizResults(characterId) {
        const all = this.load().quizResults;
        return characterId ? all.filter(q => q.characterId === characterId) : all;
    }
    /** 某角色某问卷的最近一次作答（用于对比/重算） */
    latestQuizResult(kind, characterId) {
        return this.listQuizResults(characterId).find(q => q.kind === kind) ?? null;
    }
    // ── 角色互动（关系网） ──
    listInteractions(projectId) {
        const all = this.load().interactions;
        return projectId ? all.filter(x => x.projectId === projectId) : all;
    }
    getInteraction(id) {
        return this.load().interactions.find(x => x.id === id) ?? null;
    }
    findInteraction(aKey, bKey, projectId) {
        return this.load().interactions.find(x => x.projectId === (projectId ?? undefined) &&
            ((x.aKey === aKey && x.bKey === bKey) || (x.aKey === bKey && x.bKey === aKey))) ?? null;
    }
    upsertInteraction(it) {
        const data = this.load();
        const now = new Date().toISOString();
        if (!it.id)
            it.id = 'r-' + Math.random().toString(36).slice(2, 10);
        it.updatedAt = now;
        if (!it.createdAt)
            it.createdAt = now;
        const i = data.interactions.findIndex(x => x.id === it.id);
        if (i >= 0)
            data.interactions[i] = it;
        else
            data.interactions.push(it);
        this.save(data);
        return it;
    }
    deleteInteraction(id) {
        const data = this.load();
        const before = data.interactions.length;
        data.interactions = data.interactions.filter(x => x.id !== id);
        this.save(data);
        return data.interactions.length < before;
    }
}
//# sourceMappingURL=store.js.map