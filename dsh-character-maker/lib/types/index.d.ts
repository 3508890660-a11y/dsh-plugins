/**
 * @dsh-external/dsh-character-maker — 角色设定工作坊（重建·旧版思路）。
 *
 * 独立能力：填写资料 / 跑人格问卷 / 基于已有档案完善角色模型，输出：
 *   九型人格为主干（主型→侧翼→本能副型→健康层级）+ MBTI 与大五(BFI-2) 为补充；
 *   角色人格详析、角色特质、思维与行为模式、情景样例（LLM 深度画像六节）。
 *
 * 联动：webServer API + 工具可从 dsh-novel-writer 项目拉人物档案（完善九型），
 *       并把九型角色模型写回其 personalityProfile（生成章节时自动注入【人物档案】）。
 *
 * ⚠️ 输出约定（AGENTS.md）：所有工具 output.render 返回值必须是
 *   `[{ type: 'text', text }]` 结构（content 数组），禁止裸字符串，否则前端崩溃。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type LlmService from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import type { QuestionnaireKind } from './types.js';
import type { QuestionBank } from './engine.js';
export declare const name = "@dsh-external/dsh-character-maker";
export declare const inject: string[];
export interface Config {
    dataDir: string;
    novelDataDir: string;
    provider: string;
    model: string;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    dataDir: z<string, string, "defined">;
    novelDataDir: z<string, string, "defined">;
    provider: z<string, string, "defined">;
    model: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dataDir: z<string, string, "defined">;
    novelDataDir: z<string, string, "defined">;
    provider: z<string, string, "defined">;
    model: z<string, string, "defined">;
}>>, "plain">;
/** MBTI 解析摘要：subtitle + 概览要点 + 特点小节 */
export declare function mbtiAnalysis(code: string, bank: QuestionBank): string;
/** 各问卷的题目键清单（用于完整性校验；ipip 优先用题目 uuid，兼容题序） */
export declare function bankPositions(kind: QuestionnaireKind, bank: QuestionBank): (number | string)[];
export interface AnswerCheck {
    total: number;
    answered: number;
    missing: number[];
    /** 缺失比例（0-1） */
    ratio: number;
    ok: boolean;
    note: string;
}
/**
 * 校验作答完整性（§8.8）。
 * 判定「缺题」时同时接受：题号数字键、题号字符串键、题序（1..N，用于无题号的 mbti-93 与 ipip uuid 题库）。
 * `tolerance` 为允许的缺失比例上限（默认 0.1 = 10%）。
 */
export declare function checkAnswers(kind: QuestionnaireKind, bank: QuestionBank, ans: Record<string | number, any>, tolerance?: number): AnswerCheck;
/** 把缺题清单压缩成可读片段（最多展示 24 个） */
export declare function formatMissing(missing: number[]): string;
export interface UiQuestion {
    /** 作答键（数字题号；ipip 用题序，计分器兼容） */
    no: number;
    text: string;
    /** bool=是/否；ab=二选一；scale=李克特量表 */
    type: 'bool' | 'ab' | 'scale';
    /** ab 题的两个选项文本 */
    a?: string;
    b?: string;
    scaleMin?: number;
    scaleMax?: number;
    scaleLabels?: string[];
    dimension?: string;
}
/** 全部 15 种问卷的元信息（UI 下拉用） */
export declare function listQuizMeta(bank: QuestionBank): {
    id: QuestionnaireKind;
    name: string;
    count: number;
}[];
/** 把某问卷的题库规范化为 UI 题目列表（可选区间分页 --from/--to，1 基） */
export declare function buildUiQuestions(kind: QuestionnaireKind, bank: QuestionBank, from?: number, to?: number): UiQuestion[];
/**
 * §8.10 互动登记入参校验。
 * 返回错误信息字符串表示校验失败，返回 null 表示通过。
 */ export declare function validateInteractionInput(body: any): string | null;
/** 从 LLM 输出里提取第一个 JSON 对象（容忍代码块与前后缀文字） */
export declare function extractJsonObject<T = any>(raw: string): T | null;
export declare function apply(ctx: Context & {
    tools: any;
    webServer: WebServer;
    llm: LlmService;
}, config: Config): void;
