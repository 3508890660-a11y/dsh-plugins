import type { QuestionBank } from './engine.js';
export interface SelfTestResult {
    report: string;
    passed: number;
    failed: number;
}
export declare function runSelfTest(bank: QuestionBank): SelfTestResult;
