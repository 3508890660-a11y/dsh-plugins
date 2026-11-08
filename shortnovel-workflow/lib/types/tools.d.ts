import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ShortNovelStore } from './store.js';
import type { WorkflowGenerator } from './generator.js';
export interface ToolDeps {
    store: ShortNovelStore;
    generator: WorkflowGenerator;
    dataDir: string;
}
export declare function buildTools(deps: ToolDeps): ToolDefinition[];
