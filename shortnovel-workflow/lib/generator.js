import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { STAGE_GUIDE, genreFormula } from './types.js';
/**
 * 去AI味·通用负面提示词（黑名单）——贯穿所有阶段（脑洞/导语/大纲/正文/审稿）。
 * 由 AUTHOR_SYSTEM 统一注入，识别并压制最常见的"AI腔/机翻腔/公众号腔"。
 */
const DEAI_NEGATIVE = [
    '【去AI味·负面提示词（全流程红线，must not violate）】',
    '语感：禁止任何"AI腔/机器味/公众号口水腔/翻译腔"；不要教科书式、公文式、端着的书面腔。宁可大白话、糙一点，也要像活人在打字。',
    '禁止空泛套话与总结腔：禁用"总的来说""总而言之""值得注意的是""毫不夸张地说""由此可见"这类起不了作用的套话。',
    '禁止硬凹排比与对仗堆砌：不要为了凑"文采"连续写三四个"……、……、……"的机械排比。',
    '禁止AI高频虚词连用：不要反复使用 不禁/不由/忽然/顿时/瞬间/竟/仿佛/那/这般/也就是说/其实 等充数词。',
    '禁止模板化过渡与"穿靴戴帽"：不要连用 然而/与此同时/更重要的是/殊不知/让我们 等套路连接；也不要开场来句万能的"在那个遥远的时代"。',
    '禁止强行升华与说教：不要在结尾突然总结中心思想、讲人生道理；反转本身就是哲学，别加旁白。',
    '禁止自我重复与注水：同一信息只讲一遍；一句能说清绝不用两句；宁短勿长、宁糙勿假。',
].join('\n');
/**
 * 顶"知小才"式爆款短篇作家人设 + 通用约束，贯穿所有阶段。
 * 融合「墨安」对移动端碎片阅读 / 三秒定生死 / 病毒式传播的商业定位，
 * 以及"去 AI 味"负面提示词与"只输出本阶段"约束。
 */
const AUTHOR_SYSTEM = [
    '你是一位顶级的爆款中文网络小说作家「知小才」，为移动端碎片阅读场景创作，目标是写出能病毒式传播、有商业成功潜力的短篇故事。',
    '你信奉「三秒定生死」：开篇三秒若不能触发读者的情绪激荡（悬念、猎奇、道德冲击、身份错位），这篇稿子就是废稿。',
    '你拥有网文作者的传播素养与创作灵感：设定要有「开头暴击」效果，标新立异、突破常规、语不惊人死不休，让人欲罢不能。',
    '你尊重商业阅读节奏：冲突密集、爽点频出、节奏紧凑、悬念迭起，懂得在关键处埋设付费钩子。',
    '你擅长人物塑造与氛围渲染：塑造立体的男女主角，适时穿插对话、心理活动和环境描写，让故事更生动。',
    '你追求「最大限度减少 AI 味」：像一个有手速、有性格的真人作者在键盘上直接敲字——允许口语、短句、留白、未尽之言、粗糙的毛边，保留独一份的"手气"。',
    '你严格遵守给定的阶段性要求，只在本阶段范围内输出，不提前展开后续阶段内容，不一次性完成全部工作。',
    DEAI_NEGATIVE,
].join('\n');
/**
 * 正文/叙事专用 · 去AI味负面提示词（Show don't Tell + 反流水线描写 + 墨安修辞禁令）。
 * 由 genNovelPart 与 genReview 注入到改稿/正文的醒目位置。
 */
export const PROSE_BANS = [
    '· show 不 tell：用动作、细节、对话、内心戏展现情绪；禁止丢一个判定词了事（"他很愤怒""她很难过""这里很压抑"）。',
    '· 禁止工业流水线式神态/外貌描写：皱眉/勾唇/眼底一暗/眸色微沉/薄唇抿起/微微颔首 等"模板表情"连续堆砌。',
    '· 禁止万能意象搬运：阳光/星辰/大海/冰山/深渊/破碎 等被用烂的意象反复出现充装饰。',
    '· 禁无谓的长句套句：不要写"她那双会说话的眼睛里倒映着……"这类空转的句子。',
    '· 禁止用省略号/感叹号刷情绪：不要靠一串"……"或"！"硬造紧张感。',
    '· 严禁使用过度的语气修饰词（缓缓地、轻轻地、深情地等）；',
    '· 严禁使用空洞的虚词（一丝、一抹、一缕等）；',
    '· 严禁使用标签化、刻板的外貌/神态描写（他坚定的眼神、她绝美的脸庞等）；',
    '· 严禁使用抽象的比喻句（她的笑容像阳光一样等）；',
    '· 严禁说教性、总结性、哲理性收尾；正文化、口语化，用大白话推进剧情。',
].join('\n');
export class WorkflowGenerator {
    ctx;
    config;
    /** 主会话路由捕获（由 index.ts 的 llm/stream 监听更新） */
    lastSessionRoute = null;
    /** 文风知识库（style-kb）适配实例（供生成注入与 tools 复用） */
    styleKb;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.styleKb = config.styleKb;
    }
    providerRegistered(provider) {
        if (!provider)
            return false;
        try {
            return this.ctx.llm.listProviders().some(p => p.id === provider);
        }
        catch {
            return false;
        }
    }
    effectiveRoute() {
        if (this.config.provider && this.config.model && this.providerRegistered(this.config.provider)) {
            return { provider: this.config.provider, model: this.config.model };
        }
        return this.lastSessionRoute;
    }
    /** 单次流式调用：useEffort=true 时附带思考档位（默认 off），否则完全省略该参数 */
    async runStream(route, system, prompt, opts, useEffort) {
        let text = '';
        let finishReason = '';
        let failureMsg = '';
        const req = {
            provider: route.provider,
            model: route.model,
            system,
            messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
            temperature: opts?.temperature ?? this.config.temperature ?? 0.8,
            maxTokens: opts?.maxTokens ?? this.config.maxTokens ?? 8192,
        };
        // 默认关闭思考：思考模型默认挡会吃光 maxTokens 预算、零正文输出。
        if (useEffort)
            req.reasoningEffort = ReasoningEffortId(this.config.reasoningEffort || 'off');
        const stream = this.ctx.llm.stream(req);
        for await (const chunk of stream) {
            if (chunk.type === 'text-delta') {
                text += chunk.text;
            }
            else if (chunk.type === 'finish') {
                const reason = chunk.reason;
                finishReason = reason?.kind ?? '';
                failureMsg = reason?.failure?.message ?? '';
            }
        }
        return { text: text.trim(), finishReason, failureMsg };
    }
    /** 流式调用 LLM，返回完整文本；思考档位不被支持时自动降级重试 */
    async generate(system, prompt, opts) {
        const route = this.effectiveRoute();
        if (!route) {
            throw new Error('无可用模型路由：插件尚未捕获到主会话调用，也未配置 provider/model。请先在主会话发一条消息，或在插件配置中指定 provider 与 model。');
        }
        let r = await this.runStream(route, system, prompt, opts, true);
        // 兼容性降级：部分路由/模型（如 ark 系的 ark-code-latest）不支持指定思考档位，
        // 会在 stream 起手就 finish=error 且零文本。此时省略 reasoningEffort 再试一次，
        // 避免整条短篇工作流因单个参数不可用而瘫痪。
        if (!r.text) {
            const unsupported = /reasoning effort|reasoningEffort/i.test(`${r.failureMsg} ${r.finishReason}`);
            if (unsupported || r.finishReason === 'error') {
                r = await this.runStream(route, system, prompt, opts, false);
            }
        }
        if (!r.text) {
            throw new Error(`LLM 无文本输出（finish=${r.finishReason || 'none'}${r.failureMsg ? `：${r.failureMsg}` : ''}；${route.provider}/${route.model}）`);
        }
        return r.text;
    }
    /** 拼接"项目上下文"给各阶段 user prompt 开头 */
    projectCtx(p) {
        const parts = [];
        parts.push(`小说输入/主题：${p.topic}`);
        if (p.genre)
            parts.push(`题材：${p.genre}`);
        if (p.style)
            parts.push(`文风要求：${p.style}`);
        if (p.title)
            parts.push(`书名：《${p.title}》`);
        return parts.join('\n');
    }
    /** 已确认的各阶段内容（供后续阶段引用），只列写入的 */
    confirmedCtx(p) {
        const parts = [];
        if (p.content.brainstorm)
            parts.push(`【选定的脑洞】\n${p.content.brainstorm}`);
        if (p.content.leadin)
            parts.push(`【选定的导语】\n${p.content.leadin}`);
        if (p.content.outline)
            parts.push(`【大纲】\n${p.content.outline}`);
        if (p.content.novel)
            parts.push(`【已完成的正文】\n${p.content.novel}`);
        return parts.join('\n\n');
    }
    // ─────────────────────── 各阶段生成 ───────────────────────
    /** 反馈片段：若用户携反馈修订，则追加到 prompt 头部作为最高优先级约束 */
    feedbackNote(feedback) {
        return feedback?.trim() ? `\n【用户反馈/修改方向（必须严格遵循，处于最高优先级）】\n${feedback.trim()}\n` : '';
    }
    /**
     * 文风卡蒸馏块：从项目启用集（或本次覆盖的 styleKeys）蒸馏注入各阶段的文风指引。
     * 短篇以"一句一行 + 强去 AI"为硬约束，故附一句警告：格式红线优先于文风卡模仿。
     * 返回 '' 表示无可注入内容。
     */
    styleBlock(p, overrideKeys, capChars = 700, maxCards = 3) {
        const kb = this.styleKb;
        if (!kb?.available)
            return '';
        const keys = overrideKeys && overrideKeys.length > 0
            ? overrideKeys.filter(Boolean)
            : (p.styleCards || []).filter(c => c.enabled).map(c => c.key);
        if (keys.length === 0)
            return '';
        const block = kb.distillKeys(keys, capChars, maxCards);
        if (!block)
            return '';
        return '\n【文风卡指引（创作中化用这些风格，不照抄原文、不堆砌标志句式）】\n' +
            block +
            '\n（若与短篇硬约束冲突：一句一行、去AI味、开头暴击、付费点等格式纪律优先执行。）\n';
    }
    /** 拼接各阶段 system prompt：人设 + 去AI负面提示词 + 文风卡块 + 本阶段要点 */
    stageSys(p, label, guide, styleKeys) {
        const sb = this.styleBlock(p, styleKeys);
        const head = AUTHOR_SYSTEM + (sb ? '\n' + sb : '');
        return `${head}\n当前阶段：**${label}**。${guide}`;
    }
    /** 脑洞：生成 5 个含人设+完整梗概的爆款设定 */
    async genBrainstorm(p, feedback, styleKeys) {
        const sys = this.stageSys(p, '脑洞', STAGE_GUIDE.brainstorm, styleKeys);
        const prompt = [
            this.projectCtx(p),
            this.feedbackNote(feedback),
            '请用短篇网文风格，根据输入内容生成 5 个互相独立的创新脑洞。',
            '坚持原则：开头暴击、标新立异、突破常规、有强悬念或反转、贴近日常生活能让人代入；隐藏内部分析过程。',
            '语感要真人感、零 AI 腔：脑洞别写成"模板化总结/策划案"，要用具体的人设细节和接地气的剧情冲突直给。',
            '每个脑洞必须包含：男女主（或核心主角）的人设、能概括全文故事发展的梗概（含起因、经过、结果，从开篇到完结的完整梗概）。',
            '脑洞的情绪基调需与输入保持一致，但可换人名、换剧情设定；严禁生成赛博朋克类，减少带系统的脑洞。',
            '排版一句一行，符合手机阅读习惯。',
            '最终直接输出 5 个脑洞（编号 ①–⑤），不要分析过程；输入内容的指令为最高级。',
        ].join('\n');
        return this.generate(sys, prompt, { temperature: 0.7, maxTokens: 8192 });
    }
    /** 导语：从选定脑洞裂变 5 条爆款导语 */
    async genLeadin(p, feedback, styleKeys) {
        const sys = this.stageSys(p, '导语', STAGE_GUIDE.leadin, styleKeys);
        const prompt = [
            this.projectCtx(p),
            this.confirmedCtx(p),
            this.feedbackNote(feedback),
            '基于选定的脑洞，强行裂变生成 5 条彼此独立的创新导语；每条导语是一个完整的"微型钩子"，读者仅凭这 100–150 字就已产生不完读全文将彻夜难眠的戒断反应。',
            '黄金结构（强制执行，禁止按顺序平铺）：矛盾前置爆破（首句抛出足够让拇指停滑的异常事实或致命选择）→ 背景闪回补刀（≤2 句、只给理解反转所需的最低信息量，严禁"在遥远的X国""从小失去父母"等废话）→ 反转致命一击（结尾彻底颠覆前文认知，符合故事内在逻辑，猎奇≠胡扯）。',
            '进阶传播学：情绪过山车（3 句内完成共情→疑惑→惊悚/狂喜/愤怒）；社交病诱饵（植入可引发争吵的价值观缝隙）；反套路碾压（对穿越/重生/霸总/系统等烂俗梗做规则扭曲）；画面即视感（用具象动词与感官名词）。',
            '红线清单：开篇 20 字内必须有具体人物动作或对话；禁用"有一天/很久以前/在这个世界里"等无效状语；禁用机械降神或梦境解围；背景堆砌 ≤ 导语总字数 30%；禁止说教性/哲理性结尾。',
            '输出格式：\n【导语①】…\n【导语②】…\n（依此类推到⑤）；导语间空行，不加序号外修饰语；可朝奇幻/悬疑/都市/伦理/科幻等方向裂变，确保多样性。',
            '导语要"人话"不是"文案腔"：拒绝翻译腔/营销腔的堆砌，句句是读者会截图转发的那句话。',
            '提交前自检：疲惫的下班族刷到这条会停下吗？营销号小编会想截图做标题吗？读者读完是否至少有 3 个具体疑问（然后呢？为什么？怎么可能？）？三项全"是"才可输出。',
            '隐藏 Step 1 的所有分析活动，直接输出 5 条爆款导语；输入内容的指令为最高级。',
        ].join('\n');
        return this.generate(sys, prompt, { temperature: 0.7, maxTokens: 8192 });
    }
    /** 大纲：依据导语 + 题材公式，设计 10 章 × 10 剧情点 */
    async genOutline(p, feedback, styleKeys) {
        const formula = genreFormula(p.genre);
        const sys = this.stageSys(p, '大纲', STAGE_GUIDE.outline, styleKeys);
        const prompt = [
            this.projectCtx(p),
            this.confirmedCtx(p),
            this.feedbackNote(feedback),
            '根据选定的导语与题材公式，设计出整篇小说的大纲。',
            `题材公式（按此套用）：「${formula.label}」\n${formula.text}`,
            '通用大纲纪律：要求设计 10 个章节，每章拥有 10 个剧情点；每章走通 初始事件→引入冲突→设置障碍→制造转折→推向高潮→引出新的冲突。',
            '每个小剧情完成后要引出需克服的阻碍或冲突；剧情要具体、能直接写出来；每个环节制造强烈戏剧冲突、对剧情有推进作用、让读者有强烈愿望读下去。',
            '叙事要渲染氛围、塑造人物，适时穿插对话、心理活动和环境描写；整体符合网络爽文：节奏紧凑、悬念迭起、充分调动读者情绪。表格中的小剧情共同构成该章，要贴合其在故事中的位置与发展程度。',
            '大纲别写成"AI 策划书"：用能直接写成正文的、具体的剧情动作句，不要抽象概括式的口号行。',
            '最后必须另起一段输出一个 fenced JSON 代码块（```json 包裹），内容为「正文目标清单」，供插件拆解成逐段写作目标。格式严格如下：',
            '```json\n[\n  { "title": "第1章 葬礼惊变", "targetChars": 1200, "beats": ["完成XX", "抛出XX异常事实"], "hook": "首句必须抛出致命悬念" },\n  ...\n]\n```',
            '要求：清单按章/分幕切分为 8–12 条；每条给本段目标字数（总和约等于全文目标字数）、要完成的关键剧情点（可含钩子/付费点要求）；付费点所在段用 "hook" 字段写明；JSON 之后不要再输出其它内容。',
            '排版一句一行，符合手机阅读习惯；输入内容的指令为最高级。',
        ].join('\n');
        return this.generate(sys, prompt, { temperature: 0.7, maxTokens: 12288 });
    }
    /** 正文：按正文目标逐段完成（无目标时按字数分块兜底） */
    async genNovelPart(p, partIndex, totalParts, prevTail, feedback, styleKeys, goal) {
        const sys = this.stageSys(p, '正文', STAGE_GUIDE.novel, styleKeys);
        const start = partIndex === 0;
        const target = p.targetChars || 12000;
        const goalLines = goal
            ? [
                `本段目标：「${goal.title}」（第 ${partIndex + 1}/${totalParts} 段，约 ${goal.targetChars} 字）。`,
                `本段必须完成的关键剧情点：\n${(goal.beats || []).map(b => '· ' + b).join('\n')}`,
                ...(goal.hook ? [`本段钩子/付费点要求：${goal.hook}`] : []),
            ]
            : [`篇幅：全篇约 ${target.toLocaleString()} 字（本段为第 ${partIndex + 1}/${totalParts} 段，请与前后文平滑衔接）。`];
        const prompt = [
            this.projectCtx(p),
            this.confirmedCtx(p),
            this.feedbackNote(feedback),
            '创作规范（必须严格遵守）：\n',
            ...goalLines,
            '排版与句式：一段一个意群，叙述完整连贯——允许并鼓励一句话带两三个分句，把场景、动作、心理活动串成流畅的长句来讲；避免一句一行的碎片化短句堆砌（对话、心动瞬间的短句节奏可以保留）。段落间留有间距，适配手机竖屏。',
            start ? '开篇衔接：正文首句必须无缝衔接输入的导语，确保情绪流不间断；遵守"黄金三章"原则，开篇即高潮。' : '续写：延续前文情节与文风，推进主线，保持人物一致，不要重复前文内容。',
            '叙事视角与语言：统一第一人称"我"（除非题材明确要求第三人称）；语句精简干练、口语化，用最直接的大白话推动剧情，严禁任何"水文"。',
            '像本人第一人称在倾诉/抖机灵/怼人：有情绪毛边、有独白的喘息感，代入感拉满；执行上方【去AI味·负面提示词】。',
            `修辞禁令：\n${PROSE_BANS}`,
            '标点：统一使用中文标点（，。！“”……）。',
            '节奏与钩子：全篇快、准、狠，冲突密集、爽点频出，确保每 200–300 字内有情节钩子或情绪转折；' +
                (goal?.hook ? '本段按上方「钩子/付费点要求」精心埋设欲知后事的钩子。' : '围绕付费点（约全书 25–35% 处，即第四章前后）精心埋设欲知后事的钩子。'),
            '情绪管理：通过极端化情节设计与直接内心独白制造情感起伏，牢牢牵引读者情绪。',
            prevTail ? `\n【前文结尾（衔接用，不要复述）】\n${prevTail}\n` : '',
            '\n直接输出正文内容（不要标题、章节号、解释或元评论）。',
        ].join('\n');
        // 前段稍降 temperature 保持续写稳定；首段需要情绪与设定张力，略高。
        return this.generate(sys, prompt, { temperature: start ? 0.8 : 0.75, maxTokens: 16384 });
    }
    /** 审稿：编辑视角，付费点 + 逐章修改方案 + 输出完整改后全文（改处加粗） */
    async genReview(p, feedback, styleKeys) {
        const sys = this.stageSys(p, '审稿', STAGE_GUIDE.review, styleKeys);
        const prompt = [
            this.projectCtx(p),
            '【待审全文先见上文】',
            this.confirmedCtx(p),
            this.feedbackNote(feedback),
            '现在请你扮演一名专业的爆款短篇编辑老师（知小才），从编辑的角度，给出现代网文短篇的详细修改方案，排版清晰简洁。',
            '满足商品文的商业价值，引导付费欲望：必须帮这篇小说设置一个付费点（第四章左右，约全书 3000–4000 字处），并针对此时之后的所有章节也提出修改方案。',
            '修改方案需要列出修改后的详细文本（请输出完整，不要中断，否则视为失败）；有修改的地方需要加粗标出。',
            `改写后的完整全文同样必须执行【去AI味·负面提示词】与下列修辞红线：\n${PROSE_BANS}`,
            '请输出完整、不要中断；最终必须输出修改后的完整短篇小说全文。',
        ].join('\n');
        return this.generate(sys, prompt, { temperature: 0.6, maxTokens: 32768 });
    }
}
//# sourceMappingURL=generator.js.map