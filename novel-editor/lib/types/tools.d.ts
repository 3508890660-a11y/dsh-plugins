import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { EditorEngine } from './editor.js';
import type { MiniStore } from './store.js';
export interface ToolDeps {
    editor: EditorEngine;
    store: MiniStore;
    dataDir: string;
    ollamaUrl: string;
}
export declare function buildTools(deps: ToolDeps): ToolDefinition[];
