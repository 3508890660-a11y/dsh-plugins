/** 文本内部完整性检测（无需原文对照）：重复/替换符/字符堆叠/残留标记/元话语 */
export function detectTextDamage(polished) {
    const issues = [];
    // 长段重复：相邻整行完全相同（≥20 字）
    const lines = polished.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === lines[i - 1] && lines[i].length >= 20) {
            issues.push(`段落重复：第 ${i + 1} 行与上一行完全相同（「${lines[i].slice(0, 24)}…」）`);
            break;
        }
    }
    // 内容重复：40 字窗口子串出现 ≥2 次（防换行错位导致的重复）
    if (!issues.some(x => x.includes('段落重复'))) {
        const norm = polished.replace(/\s/g, '');
        const seen = new Set();
        for (let i = 0; i + 40 <= norm.length; i++) {
            const sub = norm.slice(i, i + 40);
            if (seen.has(sub)) {
                issues.push(`内容重复：40 字片段「${sub.slice(0, 20)}…」出现 ≥2 次`);
                break;
            }
            seen.add(sub);
        }
    }
    if (polished.includes('\uFFFD'))
        issues.push('输出含替换符 \uFFFD（编码杂讯）');
    const stack = polished.match(/(.)\1{7,}/g);
    if (stack)
        issues.push(`字符堆叠：${stack[0].slice(0, 8)}…（同一字符连串 ≥8 次）`);
    // 小模型残留：think 标签 / imdi 退化 / 模板标记
    if (/<think>|<\/think>/i.test(polished))
        issues.push('输出含 <think> 思考标签残留');
    if (/imdi/i.test(polished))
        issues.push('输出含 imdi 退化标记（LoRA 训练痕迹）');
    if (/^【润色后】|^【编辑后】/.test(polished.trim()))
        issues.push('输出含【润色后】/【编辑后】模板标记');
    // 编辑元话语/无关内容
    for (const line of polished.split('\n')) {
        const t = line.trim();
        if (!t || t.length < 6)
            continue;
        if (/^(纠错|注|说明|提示|备注|综上所述|以上)[：:]/.test(t)
            || /(请提供|需要你|请您|可以帮|建议修改|原文内容)/.test(t)) {
            issues.push(`疑似编辑元话语/无关内容：${t.slice(0, 40)}…`);
            break;
        }
    }
    return { ok: issues.length === 0, issues };
}
/** 编辑稿 vs 原文的完整性检测（用于 save 前把关；ratio<0.5 截断 / >2.5 膨胀） */
export function detectEditDamage(original, polished) {
    const oLen = original.replace(/\s/g, '').length;
    const pLen = polished.replace(/\s/g, '').length;
    const ratio = oLen > 0 ? pLen / oLen : 0;
    const { ok, issues } = detectTextDamage(polished);
    if (ratio < 0.5) {
        issues.push(`输出过短（${pLen} 字 / 原文 ${oLen} 字，比 ${ratio.toFixed(2)}），疑似截断`);
    }
    else if (ratio > 2.5) {
        issues.push(`输出过长（${pLen} 字 / 原文 ${oLen} 字，比 ${ratio.toFixed(2)}），疑似膨胀/重复`);
    }
    return { ok: issues.length === 0, issues, ratio };
}
//# sourceMappingURL=check.js.map