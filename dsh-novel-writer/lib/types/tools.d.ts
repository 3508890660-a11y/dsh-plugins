import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Store } from './store.js';
import type { Generator } from './generator.js';
export interface ToolDeps {
    store: Store;
    generator: Generator;
    dataDir: string;
    /** 地图插件（dsh-map-forge）记录索引目录（maps.json 所在；空=不可达，novel_map_list 返回提示） */
    mapForgeDataDir: string;
    /** 文风知识库根目录（含 cards/ 子目录；空=不可达，novel_style_kb 返回提示） */
    styleKbDir: string;
}
export interface ImportArgs {
    projectId: string;
    filePath: string;
    mode?: string;
    dryRun?: boolean;
    encoding?: string;
}
export interface PolishArgs {
    projectId: string;
    chapterId: string;
    mode?: 'light' | 'deep';
    focus?: string;
    save?: boolean;
}
export interface PolishDamage {
    ok: boolean;
    issues: string[];
    ratio: number;
}
/**
 * 润色稿完整性检测——novel-polish 等本地小模型重写长文时可能截断/段落重复/杂讯/顺序颠倒。
 * 已验证的检测方法：字符数比（<0.5 截断 / >2.5 膨胀）+ 长段重复 + 替换符 + 字符堆叠。
 * 顺序颠倒难以可靠自动检测 → 未通过检测时返回全文预览，由用户确认后再落盘。
 */
export declare function detectPolishDamage(original: string, polished: string): PolishDamage;
/** AI 润色主流程（工具 execute 与 HTTP API 共用）：读原文 -> LLM 润色 -> 完整性自检 -> 预览或落盘（原文备份） */
export declare function runPolish(store: Store, generator: Generator, a: PolishArgs): Promise<Record<string, unknown>>;
export interface ImportResult {
    files: string;
    imported: string;
    skipped: string;
    preview: string;
}
/** 设定导入主流程（工具 execute 与 HTTP API 共用）：读文件 -> AI 解析 -> 幂等写入 */
export declare function runImport(store: Store, generator: Generator, a: ImportArgs): Promise<ImportResult>;
export declare function buildTools(deps: ToolDeps): ToolDefinition[];
