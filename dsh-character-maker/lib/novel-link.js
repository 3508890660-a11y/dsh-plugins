/**
 * novel-writer 联动：读取小说项目人物档案，写回 personalityProfile。
 *
 * 数据约定（与 dsh-novel-writer 一致）：
 *   dataRoot/projects/<projectId>/data.json  → { project, outline, characters:[...], worldview, ... }
 *   人物字段：id/name/role/appearance/personality/background/goal/currentState.{location,condition,notes}/personalityProfile
 *   dataRoot/projects/<projectId>/settings.json → characters/locations/items...（字符较少时也存这里）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mutateProjectFile, ProjectConflictError } from './project-contract.js';
export class NovelLink {
    dataDir;
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    get root() {
        return this.dataDir;
    }
    projectFile(projectId) {
        return join(this.dataDir, 'projects', projectId, 'data.json');
    }
    settingsFile(projectId) {
        return join(this.dataDir, 'projects', projectId, 'settings.json');
    }
    listProjects() {
        if (!this.dataDir || !existsSync(this.dataDir))
            return [];
        const projectsDir = join(this.dataDir, 'projects');
        if (!existsSync(projectsDir))
            return [];
        const out = [];
        for (const entry of readdir(projectsDir)) {
            if (!entry.startsWith('p-'))
                continue;
            const f = this.projectFile(entry);
            try {
                if (existsSync(f)) {
                    const j = JSON.parse(readFileSync(f, 'utf8'));
                    const proj = j?.project ?? {};
                    out.push({
                        id: entry,
                        name: proj.name ?? entry,
                        genre: proj.genre ?? '',
                        characterCount: Array.isArray(j?.characters) ? j.characters.length : 0,
                    });
                }
            }
            catch { /* 忽略坏 json */ }
        }
        return out;
    }
    listCharacters(projectId) {
        const j = this.readProject(projectId);
        if (j && Array.isArray(j.characters))
            return j.characters;
        // 退路：settings.json
        const sj = this.readSettings(projectId);
        return sj && Array.isArray(sj.characters) ? sj.characters : [];
    }
    getCharacter(projectId, characterId) {
        return this.listCharacters(projectId).find(c => c.id === characterId) ?? null;
    }
    /**
     * §8.20：取项目上下文（premise + genre/style + 大纲概要），供「动机」自动锚定故事用。
     * outline 支持三种常见形态：数组(平铺节拍) / 树(含 children) / 卷->章->节拍。
     * 对标题/摘要做紧凑递归拼接，上限约 600 字，避免塞爆提示词。
     */
    projectContext(projectId) {
        const j = this.readProject(projectId);
        const proj = j?.project ?? {};
        const outline = j?.outline;
        const outlineText = this.serializeOutline(outline);
        return {
            premise: String(proj?.premise ?? ''),
            genre: String(proj?.genre ?? ''),
            style: String(proj?.style ?? ''),
            outlineText,
        };
    }
    /** 大纲 → 紧凑文本（标题＋摘要，递归卷/章；不落每个节拍细节） */
    serializeOutline(outline, limit = 700) {
        const parts = [];
        const seen = new Set();
        const walk = (node, depth) => {
            if (!node || typeof node !== 'object' || parts.join('').length >= limit)
                return;
            if (seen.has(node))
                return;
            seen.add(node);
            const title = node?.title ?? node?.name ?? node?.summary;
            if (typeof title === 'string' && title.trim())
                parts.push(title.trim());
            const sum = node?.summary;
            if (typeof sum === 'string' && sum.trim() && sum.trim() !== title)
                parts.push(sum.trim());
            // 常见：children / beats / chapters / volumes
            for (const k of ['children', 'beats', 'chapters', 'volumes']) {
                const arr = Array.isArray(node?.[k]) ? node[k] : null;
                if (arr) {
                    for (const c of arr)
                        walk(c, depth + 1);
                    break;
                }
            }
            if (Array.isArray(node) && depth === 0)
                for (const c of node)
                    walk(c, 1);
        };
        walk(outline, 0);
        let text = parts.join('；');
        if (text.length > limit)
            text = text.slice(0, limit) + '…';
        return text;
    }
    /**
     * §8.7 修复：本文件原有的 guessEnneagramFromText（与 engine.ts 版本词表不同、过滤规则也不同）
     * 已删除——统一使用 engine.ts 的加权实现 `guessEnneagramScored / guessEnneagramFromText`。
     */
    /** 写回 personalityProfile 到 data.json（经统一写入契约） */
    writePersonalityProfile(projectId, characterId, profile, opts = {}) {
        return this.updateCharacter(projectId, characterId, { personalityProfile: profile }, opts);
    }
    /**
     * 通用：更新某个 novel 人物的若干字段（统一写入契约 §8.12）。
     *
     * 不再自己「读整包 → 改 → 写整包」：改走 project-contract 的
     * `mutateProjectFile`——文件锁内基于最新盘面定位人物、只应用补丁、revision 统一 +1。
     * 这样即使小说工坊同时保存，也不会把对方刚写的字段覆盖掉；
     * 若带 expectedRevision 且已被推进，返回冲突信息而不是静默成功。
     */
    updateCharacter(projectId, characterId, patch, opts = {}) {
        if (!existsSync(this.projectFile(projectId)))
            return { ok: false, message: '项目 data.json 不存在' };
        try {
            const r = mutateProjectFile(this.dataDir, projectId, (data) => {
                if (!Array.isArray(data.characters))
                    throw new Error('characters 不是数组');
                const ch = data.characters.find((c) => c?.id === characterId);
                if (!ch)
                    throw new Error('角色不存在: ' + characterId);
                Object.assign(ch, patch);
                ch.updatedAt = new Date().toISOString();
                return String(ch.name ?? characterId);
            }, { expectedRevision: opts.expectedRevision, source: 'dsh-character-maker' });
            return { ok: true, message: '角色档案已写回 ' + r.result, revision: r.revision };
        }
        catch (e) {
            if (e instanceof ProjectConflictError) {
                return {
                    ok: false,
                    conflict: true,
                    revision: e.current,
                    message: `项目已被小说工坊修改（revision ${e.current}），请刷新后再写回`,
                };
            }
            return { ok: false, message: String(e) };
        }
    }
    readProject(projectId) {
        const f = this.projectFile(projectId);
        try {
            if (existsSync(f))
                return JSON.parse(readFileSync(f, 'utf8'));
        }
        catch { /* 忽略 */ }
        return null;
    }
    readSettings(projectId) {
        const f = this.settingsFile(projectId);
        try {
            if (existsSync(f))
                return JSON.parse(readFileSync(f, 'utf8'));
        }
        catch { /* 忽略 */ }
        return null;
    }
}
function readdir(dir) {
    return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}
//# sourceMappingURL=novel-link.js.map