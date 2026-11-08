/**
 * 编辑稿质量检测（novel-editor 专用）：
 * 移植自 dsh-novel-writer src/tools.ts:293 detectPolishDamage 的验证方法，
 * 额外检测本地小模型常见残留：<think> 思考泄漏、imdi LoRA 退化痕迹、【润色后】/【原文】标记。
 */
export interface EditDamage {
    ok: boolean;
    issues: string[];
    /** 编辑稿/原文无空格字符数比（无原文时为 1） */
    ratio: number;
}
/** 文本内部完整性检测（无需原文对照）：重复/替换符/字符堆叠/残留标记/元话语 */
export declare function detectTextDamage(polished: string): {
    ok: boolean;
    issues: string[];
};
/** 编辑稿 vs 原文的完整性检测（用于 save 前把关；ratio<0.5 截断 / >2.5 膨胀） */
export declare function detectEditDamage(original: string, polished: string): EditDamage;
