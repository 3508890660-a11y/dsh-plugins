import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { ProjectConflictError } from './project-contract.js';
import { StyleKb } from './style-kb.js';
import { AssetStore } from './assets.js';
import { runImport, runPolish } from './tools.js';
import { exportEpub, exportMarkdown, exportTxt } from './exporter.js';
const MIME = {
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.epub': 'application/epub+zip',
};
function sendJson(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': MIME['.json'] });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(Buffer.from(c)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
export function registerRoutes(addRoute, deps) {
    const API = '/@dsh-external/dsh-novel-writer/api';
    const styleKb = new StyleKb(deps.styleKbDir);
    const assets = new AssetStore(deps.dataDir);
    const handler = async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const parts = url.pathname.slice(API.length).split('/').filter(Boolean);
        try {
            // /health
            if (parts[0] === 'health') {
                const route = deps.generator.effectiveRoute();
                return sendJson(res, 200, { ok: true, dataDir: deps.dataDir, provider: route?.provider ?? '', model: route?.model ?? '' });
            }
            // /projects
            if (parts[0] === 'projects' && parts.length === 1) {
                const projects = deps.store.listProjects().map(p => {
                    const d = deps.store.load(p.id);
                    return {
                        ...p,
                        chaptersWritten: d.chapters.length,
                        characters: d.characters.length,
                        outlineNodes: d.outline.length,
                        openForeshadowings: d.foreshadowings.filter(f => f.status === 'open').length,
                    };
                });
                return sendJson(res, 200, { projects });
            }
            // /projects/:pid
            if (parts[0] === 'projects' && parts.length === 2) {
                const data = deps.store.load(parts[1]);
                // revision 随数据一起返回：面板据此判断是否需要重新拉取（外部插件写回也会递增）
                return sendJson(res, 200, { ...data, revision: deps.store.revisionOf(parts[1]) });
            }
            // GET /projects/:pid/revision → { revision }（轻量轮询，避免整包传输）
            if (parts[0] === 'projects' && parts[2] === 'revision' && parts.length === 3) {
                if (req.method !== 'GET')
                    return sendJson(res, 405, { error: 'method not allowed (use GET)' });
                const data = deps.store.load(parts[1]);
                return sendJson(res, 200, {
                    revision: deps.store.revisionOf(parts[1]),
                    updatedAt: data.project.updatedAt,
                    characters: data.characters.length,
                    chapters: data.chapters.length,
                });
            }
            // GET /projects/:pid/orphans → 孤儿章节（有正文/记录但大纲已无节点）
            if (parts[0] === 'projects' && parts[2] === 'orphans' && parts.length === 3) {
                if (req.method !== 'GET')
                    return sendJson(res, 405, { error: 'method not allowed (use GET)' });
                return sendJson(res, 200, { orphans: deps.store.listOrphans(parts[1]) });
            }
            // POST /projects/:pid/orphans/:cid/restore { volumeId?, title?, order? } → 恢复到大纲
            if (parts[0] === 'projects' && parts[2] === 'orphans' && parts[4] === 'restore' && parts.length === 5) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const b = JSON.parse((await readBody(req)) || '{}');
                const r = deps.store.restoreOrphan(parts[1], parts[3], {
                    volumeId: typeof b.volumeId === 'string' ? b.volumeId : null,
                    title: typeof b.title === 'string' ? b.title : undefined,
                    order: typeof b.order === 'number' ? b.order : undefined,
                });
                return sendJson(res, r.ok ? 200 : 400, r);
            }
            // GET /projects/:pid/exports → 已导出文件清单
            if (parts[0] === 'projects' && parts[2] === 'exports' && parts.length === 3) {
                if (req.method !== 'GET')
                    return sendJson(res, 405, { error: 'method not allowed (use GET)' });
                return sendJson(res, 200, { files: deps.store.listExports(parts[1]) });
            }
            // POST /projects/:pid/export { format } → 生成导出文件（markdown / txt / epub）
            if (parts[0] === 'projects' && parts[2] === 'export' && parts.length === 3) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const b = JSON.parse((await readBody(req)) || '{}');
                const format = b.format === 'txt' ? 'txt' : b.format === 'epub' ? 'epub' : 'markdown';
                const data = deps.store.load(parts[1]);
                const outDir = deps.store.exportDir(parts[1]);
                const r = format === 'epub' ? exportEpub(deps.store, data, outDir)
                    : format === 'txt' ? exportTxt(deps.store, data, outDir)
                        : exportMarkdown(deps.store, data, outDir);
                return sendJson(res, 200, { ok: true, ...r, file: basename(r.filePath) });
            }
            // ═══ 统一资产注册表（立绘/插画/地图/配音）═══
            // GET  /projects/:pid/assets?kind=&characterId=&chapterId= → 资产清单
            if (parts[0] === 'projects' && parts[2] === 'assets' && parts.length === 3 && req.method === 'GET') {
                return sendJson(res, 200, {
                    assets: assets.list(parts[1], {
                        kind: url.searchParams.get('kind') ?? undefined,
                        characterId: url.searchParams.get('characterId') ?? undefined,
                        chapterId: url.searchParams.get('chapterId') ?? undefined,
                    }),
                });
            }
            // POST /projects/:pid/assets → 登记（其他插件生成成功后调用；同 id 追加版本）
            if (parts[0] === 'projects' && parts[2] === 'assets' && parts.length === 3) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const b = JSON.parse((await readBody(req)) || '{}');
                if (!b.sourceId && !b.id)
                    return sendJson(res, 400, { error: 'sourceId 或 id 必填' });
                const rec = assets.upsert(parts[1], b);
                return sendJson(res, 200, { ok: true, asset: rec });
            }
            // POST /projects/:pid/assets/:aid/current { index } → 切换当前版本
            if (parts[0] === 'projects' && parts[2] === 'assets' && parts[4] === 'current' && parts.length === 5) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const b = JSON.parse((await readBody(req)) || '{}');
                const rec = assets.setCurrent(parts[1], parts[3], Number(b.index));
                return rec
                    ? sendJson(res, 200, { ok: true, asset: rec })
                    : sendJson(res, 404, { error: '资产或版本不存在' });
            }
            // DELETE /projects/:pid/assets/:aid → 取消登记（不删源文件）
            if (parts[0] === 'projects' && parts[2] === 'assets' && parts.length === 4 && req.method === 'DELETE') {
                return assets.remove(parts[1], parts[3])
                    ? sendJson(res, 200, { ok: true })
                    : sendJson(res, 404, { error: '资产不存在' });
            }
            // ═══ 文风知识库（style-kb）═══
            // GET /style-kb → 全卡片清单
            if (parts[0] === 'style-kb' && parts.length === 1) {
                if (!styleKb.available)
                    return sendJson(res, 200, { available: false, count: 0, cards: [] });
                const cards = styleKb.list({ q: url.searchParams.get('q') ?? undefined, tag: url.searchParams.get('tag') ?? undefined })
                    .map(c => ({ key: c.key, title: c.title, tags: c.tags, kind: c.kind }));
                return sendJson(res, 200, { available: true, count: styleKb.count, matched: cards.length, cards });
            }
            // GET /projects/:pid/style-kb → 绑定卡片
            // POST /projects/:pid/style-kb { cards, enabled? } → 绑定（缺省 enabled）
            // DELETE /projects/:pid/style-kb { cards } → 解除（空数组=清空）
            if (parts[0] === 'projects' && parts[2] === 'style-kb' && parts.length === 3) {
                const pid = parts[1];
                const data = deps.store.load(pid);
                const bindings = Array.isArray(data.project.styleCards) ? data.project.styleCards : [];
                if (req.method === 'GET') {
                    const bound = bindings.map(b => {
                        const card = styleKb.available ? styleKb.read(b.key) : null;
                        return { key: b.key, enabled: b.enabled, title: card?.title ?? '（卡片缺失）', tags: card?.tags ?? [] };
                    });
                    return sendJson(res, 200, { available: styleKb.available, bound });
                }
                if (req.method === 'POST') {
                    const b = JSON.parse((await readBody(req)) || '{}');
                    const refs = Array.isArray(b.cards) ? b.cards.filter(x => typeof x === 'string') : [];
                    if (refs.length === 0)
                        return sendJson(res, 400, { error: 'cards 必填（字符串数组）' });
                    const enabled = b.enabled === true;
                    const known = new Set(bindings.map(x => x.key));
                    for (const ref of refs) {
                        const r = styleKb.resolve(ref);
                        if (!r.matched)
                            continue;
                        const ex = bindings.find(x => x.key === r.key);
                        if (ex)
                            ex.enabled = enabled;
                        else
                            bindings.push({ key: r.key, enabled });
                    }
                    data.project.styleCards = bindings;
                    deps.store.save(pid);
                    const bound = bindings.map(b => ({ key: b.key, enabled: b.enabled }));
                    return sendJson(res, 200, { ok: true, bound });
                }
                if (req.method === 'DELETE') {
                    const b = JSON.parse((await readBody(req)) || '{}');
                    if (Array.isArray(b.cards) && b.cards.length > 0) {
                        const drop = new Set(b.cards.filter(x => typeof x === 'string'));
                        data.project.styleCards = bindings.filter(x => !drop.has(x.key) && !drop.has(styleKb.resolve(x.key).key));
                    }
                    else {
                        data.project.styleCards = [];
                    }
                    deps.store.save(pid);
                    return sendJson(res, 200, { ok: true, bound: data.project.styleCards });
                }
                return sendJson(res, 405, { error: 'method not allowed (use GET/POST/DELETE)' });
            }
            // GET /projects/:pid/style-kb/preview → 项目注入文风块预览
            if (parts[0] === 'projects' && parts[2] === 'style-kb' && parts[3] === 'preview' && parts.length === 4) {
                if (req.method !== 'GET')
                    return sendJson(res, 405, { error: 'method not allowed (use GET)' });
                const data = deps.store.load(parts[1]);
                const active = (data.project.styleCards ?? []).filter(x => x.enabled).map(x => x.key);
                if (active.length === 0)
                    return sendJson(res, 200, { available: styleKb.available, preview: '' });
                const preview = deps.generator.styleCardBlocks(active, 700, 3);
                return sendJson(res, 200, { available: styleKb.available, preview });
            }
            // GET /projects/:pid/chapters/:cid（正文读取；PUT 走下方编辑分支）
            if (req.method === 'GET' && parts[0] === 'projects' && parts[2] === 'chapters' && parts.length === 4) {
                const data = deps.store.load(parts[1]);
                const rec = data.chapters.find(c => c.id === parts[3]);
                const content = deps.store.readChapterContent(parts[1], parts[3]);
                return sendJson(res, 200, { record: rec ?? null, content });
            }
            // /projects/:pid/export/:file
            if (parts[0] === 'projects' && parts[2] === 'export' && parts.length === 4) {
                const file = basename(parts[3]);
                const full = join(deps.store.exportDir(parts[1]), file);
                if (!existsSync(full) || !statSync(full).isFile())
                    return sendJson(res, 404, { error: 'not found' });
                res.writeHead(200, {
                    'content-type': MIME[extname(full)] ?? 'application/octet-stream',
                    'content-length': statSync(full).size,
                    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
                });
                createReadStream(full).pipe(res);
                return;
            }
            // POST /import（设定文件 AI 解析导入）
            if (parts[0] === 'import' && parts.length === 1) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const body = JSON.parse((await readBody(req)) || '{}');
                if (!body.projectId || !body.filePath)
                    return sendJson(res, 400, { error: 'projectId 与 filePath 必填' });
                const result = await runImport(deps.store, deps.generator, body);
                return sendJson(res, 200, result);
            }
            // ═══ 编辑 / 删除端点（UI 直接修改内容）═══
            // PUT /projects/:pid/worldview/:wid   { category?, title?, content? }
            // PUT /projects/:pid/characters/:cid  { name?, role?, appearance?, personality?, background?, goal?, location?, condition?, possessions?, aliases? }
            // PUT /projects/:pid/outline/:nid     { title?, summary?, beats?, status?, parentId? }（parentId=移动章节到卷/移出卷）
            // PUT /projects/:pid/foreshadowings/:fid { description?, notes?, status? }
            // PUT /projects/:pid/geo/:gid         { name?, aliases?, type?, description?, mapX?, mapY? }
            // PUT /projects/:pid/items/:iid       { name?, aliases?, category?, description?, owner?, location?, status? }
            // PUT /projects/:pid/chapters/:cid    { content }
            // DELETE 同上路径（chapter 除外）
            const editRoutes = [
                { kind: 'worldview', seg: 'worldview', index: 2 },
                { kind: 'characters', seg: 'characters', index: 2 },
                { kind: 'outline', seg: 'outline', index: 2 },
                { kind: 'foreshadowings', seg: 'foreshadowings', index: 2 },
                { kind: 'geo', seg: 'geo', index: 2 },
                { kind: 'items', seg: 'items', index: 2 },
            ];
            const er = parts[0] === 'projects' && parts.length === 4 ? editRoutes.find(r => r.seg === parts[2]) : undefined;
            if (er) {
                const pid = parts[1], id = parts[3];
                const data = deps.store.load(pid);
                if (req.method === 'PUT') {
                    const b = JSON.parse((await readBody(req)) || '{}');
                    const str = (v) => typeof v === 'string' ? v.trim() : undefined;
                    // 坐标：接受 number 与合法数字字符串（UI input 天然是字符串）；空串/非法值 → null（清空）
                    const num01 = (v) => {
                        if (v === null || v === undefined || v === '')
                            return null;
                        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
                        return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
                    };
                    const entry = (kind) => {
                        if (kind === 'worldview')
                            return data.worldview.find(x => x.id === id);
                        if (kind === 'characters')
                            return data.characters.find(x => x.id === id);
                        if (kind === 'outline')
                            return data.outline.find(x => x.id === id);
                        if (kind === 'foreshadowings')
                            return data.foreshadowings.find(x => x.id === id);
                        if (kind === 'geo')
                            return (data.geo ?? []).find(x => x.id === id);
                        if (kind === 'items')
                            return (data.items ?? []).find(x => x.id === id);
                        return undefined;
                    };
                    const e = entry(er.kind);
                    if (!e)
                        return sendJson(res, 404, { error: `${er.kind} 条目不存在: ${id}` });
                    if (er.kind === 'worldview') {
                        const w = e;
                        const t = str(b.title);
                        if (t)
                            w.title = t.slice(0, 100);
                        const c = str(b.category);
                        if (c && ['geography', 'history', 'rules', 'culture', 'power-system', 'other'].includes(c))
                            w.category = c;
                        const ct = str(b.content);
                        if (ct !== undefined)
                            w.content = ct.slice(0, 5000);
                    }
                    else if (er.kind === 'characters') {
                        const c = e;
                        const n = str(b.name);
                        if (n)
                            c.name = n.slice(0, 50);
                        const r = str(b.role);
                        if (r && ['protagonist', 'supporting', 'antagonist', 'minor'].includes(r))
                            c.role = r;
                        const a = str(b.appearance);
                        if (a !== undefined)
                            c.appearance = a.slice(0, 500);
                        const pe = str(b.personality);
                        if (pe !== undefined)
                            c.personality = pe.slice(0, 500);
                        const bg = str(b.background);
                        if (bg !== undefined)
                            c.background = bg.slice(0, 1000);
                        const g = str(b.goal);
                        if (g !== undefined)
                            c.goal = g.slice(0, 500);
                        const loc = str(b.location);
                        if (loc !== undefined)
                            c.currentState.location = loc.slice(0, 100);
                        const cond = str(b.condition);
                        if (cond !== undefined)
                            c.currentState.condition = cond.slice(0, 200);
                        if (Array.isArray(b.possessions))
                            c.currentState.possessions = b.possessions.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 20);
                        if (Array.isArray(b.aliases))
                            e.aliases = b.aliases.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8);
                    }
                    else if (er.kind === 'outline') {
                        const o = e;
                        const t = str(b.title);
                        if (t)
                            o.title = t.slice(0, 100);
                        const s = str(b.summary);
                        if (s !== undefined)
                            o.summary = s.slice(0, 1000);
                        if (Array.isArray(b.beats))
                            o.beats = b.beats.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 20);
                        const st = str(b.status);
                        if (st && ['planned', 'writing', 'done'].includes(st))
                            o.status = st;
                        // parentId：移动章节到卷（UI 分卷操作）；同时同步正文记录 volumeId（大纲为事实来源）
                        if (b.parentId !== undefined) {
                            const pid = b.parentId === null || b.parentId === '' ? null : typeof b.parentId === 'string' ? b.parentId.trim() : null;
                            if (pid) {
                                const vol = data.outline.find(n => n.id === pid && n.type === 'volume');
                                if (!vol)
                                    return sendJson(res, 400, { error: `parentId 需指向 volume 节点: ${pid}` });
                            }
                            o.parentId = pid;
                            if (o.type === 'chapter') {
                                const rec = data.chapters.find(c => c.id === o.id);
                                if (rec)
                                    rec.volumeId = pid;
                            }
                        }
                    }
                    else if (er.kind === 'foreshadowings') {
                        const f = e;
                        const d = str(b.description);
                        if (d)
                            f.description = d.slice(0, 300);
                        const n = str(b.notes);
                        if (n !== undefined)
                            f.notes = n.slice(0, 200);
                        const st = str(b.status);
                        if (st && ['open', 'resolved', 'abandoned'].includes(st))
                            f.status = st;
                    }
                    else if (er.kind === 'geo') {
                        const g = e;
                        const n = str(b.name);
                        if (n)
                            g.name = n.slice(0, 100);
                        if (Array.isArray(b.aliases))
                            g.aliases = b.aliases.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8);
                        const t = str(b.type);
                        if (t && ['country', 'region', 'city', 'terrain', 'building', 'other'].includes(t))
                            g.type = t;
                        const d = str(b.description);
                        if (d !== undefined)
                            g.description = d.slice(0, 5000);
                        if (b.mapX !== undefined)
                            g.mapX = num01(b.mapX);
                        if (b.mapY !== undefined)
                            g.mapY = num01(b.mapY);
                    }
                    else if (er.kind === 'items') {
                        const it = e;
                        const n = str(b.name);
                        if (n)
                            it.name = n.slice(0, 100);
                        if (Array.isArray(b.aliases))
                            it.aliases = b.aliases.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8);
                        const c = str(b.category);
                        if (c && ['weapon', 'artifact', 'tool', 'material', 'drug', 'document', 'other'].includes(c))
                            it.category = c;
                        const d = str(b.description);
                        if (d !== undefined)
                            it.description = d.slice(0, 5000);
                        const o = str(b.owner);
                        if (o !== undefined)
                            it.owner = o.slice(0, 100);
                        const l = str(b.location);
                        if (l !== undefined)
                            it.location = l.slice(0, 100);
                        const s = str(b.status);
                        if (s !== undefined)
                            it.status = s.slice(0, 100);
                    }
                    deps.store.save(pid);
                    return sendJson(res, 200, { ok: true });
                }
                if (req.method === 'DELETE') {
                    if (er.kind === 'worldview') {
                        const i = data.worldview.findIndex(x => x.id === id);
                        if (i < 0)
                            return sendJson(res, 404, { error: 'worldview 条目不存在' });
                        data.worldview.splice(i, 1);
                    }
                    else if (er.kind === 'characters') {
                        const i = data.characters.findIndex(x => x.id === id);
                        if (i < 0)
                            return sendJson(res, 404, { error: 'character 不存在' });
                        data.characters.splice(i, 1);
                    }
                    else if (er.kind === 'outline') {
                        // mode 决定章节记录与正文如何处置（见 Store.deleteOutlineNode）：
                        //   outline=只删大纲（正文留作孤儿，可恢复）｜archive=正文归档（默认）｜purge=连正文删除
                        const rawMode = url.searchParams.get('mode') ?? '';
                        const mode = rawMode === 'outline' || rawMode === 'purge' ? rawMode : 'archive';
                        const r = deps.store.deleteOutlineNode(pid, id, mode);
                        if (!r)
                            return sendJson(res, 404, { error: 'outline 节点不存在' });
                        return sendJson(res, 200, { ok: true, mode, ...r });
                    }
                    else if (er.kind === 'foreshadowings') {
                        const i = data.foreshadowings.findIndex(x => x.id === id);
                        if (i < 0)
                            return sendJson(res, 404, { error: 'foreshadowing 不存在' });
                        data.foreshadowings.splice(i, 1);
                    }
                    else if (er.kind === 'geo') {
                        if (!Array.isArray(data.geo))
                            data.geo = [];
                        const i = data.geo.findIndex(x => x.id === id);
                        if (i < 0)
                            return sendJson(res, 404, { error: 'geo 条目不存在' });
                        data.geo.splice(i, 1);
                    }
                    else if (er.kind === 'items') {
                        if (!Array.isArray(data.items))
                            data.items = [];
                        const i = data.items.findIndex(x => x.id === id);
                        if (i < 0)
                            return sendJson(res, 404, { error: 'item 条目不存在' });
                        data.items.splice(i, 1);
                    }
                    deps.store.save(pid);
                    return sendJson(res, 200, { ok: true });
                }
                return sendJson(res, 405, { error: 'method not allowed (use PUT/DELETE)' });
            }
            // POST /polish（AI 智能编辑：润色章节；save=false 只返回润色稿）
            if (parts[0] === 'polish' && parts.length === 1) {
                if (req.method !== 'POST')
                    return sendJson(res, 405, { error: 'method not allowed (use POST)' });
                const body = JSON.parse((await readBody(req)) || '{}');
                if (!body.projectId || !body.chapterId)
                    return sendJson(res, 400, { error: 'projectId 与 chapterId 必填' });
                const result = await runPolish(deps.store, deps.generator, body);
                return sendJson(res, 200, result);
            }
            // PUT /projects/:pid/chapters/:cid（编辑正文：写 md + 更新字数）
            if (parts[0] === 'projects' && parts[2] === 'chapters' && parts.length === 4) {
                if (req.method !== 'PUT')
                    return sendJson(res, 405, { error: 'method not allowed (use PUT)' });
                const b = JSON.parse((await readBody(req)) || '{}');
                if (typeof b.content !== 'string')
                    return sendJson(res, 400, { error: 'content 必填（字符串）' });
                const data = deps.store.load(parts[1]);
                const rec = data.chapters.find(c => c.id === parts[3]);
                if (!rec)
                    return sendJson(res, 404, { error: `章节记录不存在: ${parts[3]}` });
                // 覆盖前自动备份原文（chapters/backup/），手动编辑与 AI 润色保存都留后路
                const old = deps.store.readChapterContent(parts[1], parts[3]);
                if (old && old !== b.content)
                    deps.store.writeChapterBackup(parts[1], parts[3], old);
                deps.store.writeChapterContent(parts[1], parts[3], b.content);
                rec.wordCount = b.content.replace(/\s/g, '').length;
                deps.store.save(parts[1]);
                return sendJson(res, 200, { ok: true, wordCount: rec.wordCount });
            }
            return sendJson(res, 404, { error: 'unknown api path' });
        }
        catch (e) {
            // 写入冲突：别的插件（角色工作坊/地图/配音）在你读取之后改过同一项目。
            // 返回 409 + 当前 revision，前端提示刷新而不是静默覆盖。
            if (e instanceof ProjectConflictError) {
                return sendJson(res, 409, { error: e.message, code: e.code, expected: e.expected, current: e.current });
            }
            return sendJson(res, 500, { error: String(e).slice(0, 300) });
        }
    };
    return addRoute({ kind: 'prefix', path: API, handler });
}
//# sourceMappingURL=routes.js.map