/** 客户端 ctx 的结构化类型（只声明用到的面） */
interface ClientContext {
    effect(fn: () => (() => void) | Iterable<() => void>, ns?: string): void;
    slots: {
        inject(key: string, callback: () => (() => void) | Iterable<() => void>, label?: string): () => void;
        register(options: {
            name: string;
            id?: string;
            order?: number;
            label?: string | (() => string);
        }, component: unknown): () => void;
    };
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
