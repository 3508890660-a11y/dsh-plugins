import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
export const name = '@dsh-external/dsh-llm-probe';
export const inject = ['llm'];
export function apply(ctx) {
    const logFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'super-injector', 'llm-probe.log');
    const log = (msg) => {
        try {
            mkdirSync(dirname(logFile), { recursive: true });
            appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + msg + '\n');
        }
        catch { /* 静默 */ }
    };
    try {
        const providers = ctx.llm.listProviders();
        log('listProviders: ' + JSON.stringify(providers));
        const runtime = ctx.llm;
        if (typeof runtime.listConfigurableProviders === 'function') {
            log('configurableProviders: ' + JSON.stringify(runtime.listConfigurableProviders()));
        }
        void (runtime.listModels?.('ollama') ?? Promise.resolve([])).then((models) => log('ollama models: ' + JSON.stringify(models)), (e) => log('ollama models ERR: ' + String(e)));
    }
    catch (e) {
        log('probe error: ' + String(e));
    }
}
