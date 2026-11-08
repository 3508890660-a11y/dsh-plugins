import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Store } from './store.js';
export declare function buildAnalysisTools(ctx: {
    store: Store;
    dataDir: string;
}): ToolDefinition[];
