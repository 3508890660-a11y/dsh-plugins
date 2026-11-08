/**
 * shortnovel-workflow 数据持久化：每项目一目录 dataDir/shortnovel/<id>/data.json。
 * 原子写（tmp + rename），内存缓存。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso, wordCountOf } from './types.js';
export class ShortNovelStore {
    dataDir;
    cache = new Map();
    constructor(dataDir) {
        this.dataDir = dataDir;
        mkdirSync(join(dataDir, 'shortnovel'), { recursive: true });
    }
    projectDir(id) {
        return join(this.dataDir, 'shortnovel', id);
    }
    dataFile(id) {
        return join(this.projectDir(id), 'data.json');
    }
    writeJson(path, value) {
        const tmp = path + '.tmp';
        writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
        renameSync(tmp, path);
    }
    createProject(meta) {
        const dir = this.projectDir(meta.id);
        mkdirSync(dir, { recursive: true });
        const data = {
            id: meta.id,
            topic: meta.topic,
            genre: meta.genre,
            style: meta.style,
            title: meta.title,
            stage: 'brainstorm',
            content: {},
            styleCards: [],
            novelParts: [],
            goals: [],
            targetChars: meta.targetChars,
            done: false,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        this.writeJson(this.dataFile(meta.id), data);
        this.cache.set(meta.id, data);
        return data;
    }
    listProjects() {
        const root = join(this.dataDir, 'shortnovel');
        const out = [];
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const f = join(root, entry.name, 'data.json');
            if (!existsSync(f))
                continue;
            try {
                const p = this.load(entry.name);
                out.push({
                    id: p.id, topic: p.topic, title: p.title, genre: p.genre,
                    stage: p.stage, done: p.done, wordCount: wordCountOf(p),
                    createdAt: p.createdAt, updatedAt: p.updatedAt,
                });
            }
            catch { /* 损坏项目跳过 */ }
        }
        return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
    load(id) {
        const cached = this.cache.get(id);
        if (cached)
            return cached;
        const f = this.dataFile(id);
        if (!existsSync(f))
            throw new Error(`短篇小说项目不存在: ${id}`);
        const data = JSON.parse(readFileSync(f, 'utf8'));
        this.cache.set(id, data);
        return data;
    }
    save(id) {
        const p = this.load(id);
        p.updatedAt = nowIso();
        this.writeJson(this.dataFile(id), p);
    }
    delete(id) {
        this.cache.delete(id);
        rmSync(this.projectDir(id), { recursive: true, force: true });
    }
}
//# sourceMappingURL=store.js.map