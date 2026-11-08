/**
 * Host HTTP API（UI 面板数据源）：prefix /@dsh-external/dsh-novel-writer/api
 *   GET  /api/health                          -> { ok, dataDir, route }
 *   GET  /api/projects                        -> 项目列表（含概览）
 *   GET  /api/projects/:pid                   -> 项目完整数据（大纲/人物/世界观/伏笔/章节记忆）
 *   GET  /api/projects/:pid/chapters/:cid     -> 章节正文 + 记忆
 *   GET  /api/projects/:pid/export/:file      -> 下载导出文件
 *   POST /api/import                          -> 设定文件 AI 解析导入 { projectId, filePath, mode?, dryRun?, encoding? }
 *   POST /api/polish                          -> AI 智能编辑：润色章节 { projectId, chapterId, mode?, focus?, save? }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from './store.js';
import type { Generator } from './generator.js';
export declare function registerRoutes(addRoute: (route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}) => () => void, deps: {
    store: Store;
    generator: Generator;
    dataDir: string;
    styleKbDir: string;
}): () => void;
