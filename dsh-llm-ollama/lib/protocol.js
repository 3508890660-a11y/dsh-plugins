/**
 * dsh-llm-ollama 鈥?鍗忚灞傦細harness Message 鈫?Ollama OpenAI-compatible wire format銆? * 闆朵緷璧?SSE 瑙ｆ瀽锛堜笉鐢?eventsource-parser锛夛紝浠?dsh-llm-deepseek 鐨? * serialize/parseSse/translate 缁撴瀯锛屼絾鍙繚鐣欐枃鏈?+ 宸ュ叿璋冪敤璺緞銆? */
import { ToolCallId, EMPTY_RESPONSE_CODE, LlmError, } from '@deepseek-ai/dsh-llm';
/** 鎷兼帴涓€鏉℃秷鎭噷鐨?text 鍧椼€?*/
function flattenText(blocks) {
    return blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}
/** 鎷掔粷鍥剧墖鍐呭锛圤llama 瑙嗚璺緞鐣欏緟鍚庣画锛屾枃鏈?宸ュ叿鍏堣锛夈€?*/
function assertTextOnly(blocks) {
    if (blocks.some((block) => block.type === 'image')) {
        throw new LlmError('The Ollama adapter does not support image content yet.', 'UNSUPPORTED_CONTENT');
    }
}
/** 搴忓垪鍖栦竴鏉?assistant 娑堟伅锛堟枃鏈?+ 宸ュ叿璋冪敤锛夈€?*/
function serializeAssistant(message) {
    const text = flattenText(message.content);
    const toolCalls = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
        id: String(block.id),
        type: 'function',
        function: {
            name: block.name,
            arguments: block.arguments,
        },
    }));
    return {
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
}
/**
 * Serialize the harness conversation into Ollama chat-completions wire messages.
 *
 * DSH 1.0.3+ models a tool result as a first-class `role: 'tool'` message
 * (`ToolResultMessage.toolCallId`), not as a `'tool-result'` content block inside a
 * user message. Each one maps to its own OpenAI-compatible tool message so the
 * assistant's `tool_calls` stay paired with their answers.
 *
 * Roles Ollama cannot express are folded: `developer` becomes a system turn
 * (text only — tool add/remove blocks have no wire representation here), and an
 * empty user turn is dropped rather than sent as blank content.
 */
export function serializeMessages(messages) {
    const wire = [];
    for (const message of messages) {
        assertTextOnly(message.content);
        if (message.role === 'developer') {
            const text = flattenText(message.content);
            if (text.length > 0)
                wire.push({ role: 'system', content: text });
            continue;
        }
        if (message.content.some((block) => block.type === 'tool-addition' || block.type === 'tool-removal')) {
            throw new LlmError('The Ollama adapter cannot express tool add/remove blocks outside developer messages.', 'UNSUPPORTED_CONTENT');
        }
        if (message.role === 'system') {
            wire.push({ role: 'system', content: flattenText(message.content) });
            continue;
        }
        if (message.role === 'assistant') {
            wire.push(serializeAssistant(message));
            continue;
        }
        if (message.role === 'tool') {
            wire.push({
                role: 'tool',
                tool_call_id: String(message.toolCallId),
                content: flattenText(message.content) || '(no output)',
            });
            continue;
        }
        // durable user message or a request-only RequestUserInput
        const text = flattenText(message.content);
        if (text.length > 0)
            wire.push({ role: 'user', content: text });
    }
    return wire;
}
/**
 * 缁勮瀹屾暣 wire 璇锋眰銆俼wen3 绯绘ā鍨嬮粯璁ゆ€濊€冿紝鏄惧紡 reasoningEffort 鏄犲皠涓? * thinking 寮€鍏筹紙'off' 鈫?disabled锛屽叾浣?鈫?enabled锛岀己鐪佷笉浼犺 provider 榛樿锛夈€? */
export function serializeRequest(options, _endpoint) {
    const tools = options.tools?.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
    const messages = [];
    if (options.system !== undefined) {
        messages.push({ role: 'system', content: options.system });
    }
    messages.push(...serializeMessages(options.messages));
    const thinking = options.reasoningEffort === undefined
        ? undefined
        : { type: options.reasoningEffort === 'off' ? 'disabled' : 'enabled' };
    return {
        model: options.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(thinking !== undefined ? { thinking } : {}),
        ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(options.stop !== undefined ? { stop: options.stop } : {}),
    };
}
/**
 * 闆朵緷璧?SSE 瑙ｆ瀽锛氳В鐮佸瓧鑺傛祦 鈫?鎸夌┖琛屽垏浜嬩欢 鈫?鎻愬彇 data: 琛屻€? * 娴佺粨鏉熸湭鏀跺埌 [DONE] 瑙嗕负鎴柇锛圠LM 璋冪敤缁撴灉涓嶅彲淇★級锛屾姏 STREAM_CLOSED銆? */
export async function* parseSse(stream) {
    // 鎵嬭 + TextDecoder锛堥伩鍏?DOM/Node 鐨?TransformStream 绫诲瀷鍐茬獊锛?
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawDone = false;
    const flushEvent = (raw) => {
        const dataLines = raw
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''));
        return dataLines.length > 0 ? dataLines.join('\n') : null;
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        // 鎻愬彇鎵€鏈夊畬鏁翠簨浠讹紙浠ョ┖琛岀粨鏉燂細\n\n 鎴?\r\n\r\n锛?
        const eventRe = /\r?\n\r?\n/g;
        let match;
        while ((match = eventRe.exec(buffer)) !== null) {
            const raw = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            eventRe.lastIndex = 0; // buffer 宸插彉鐭紝閲嶇疆閬垮厤閿欎綅
            const data = flushEvent(raw);
            if (data === null)
                continue;
            yield data;
            if (data === '[DONE]') {
                sawDone = true;
                return;
            }
        }
    }
    // 灏惧潡锛堝彲鑳芥棤绌鸿缁撳熬锛?
    if (buffer.trim().length > 0) {
        const data = flushEvent(buffer);
        if (data !== null) {
            yield data;
            if (data === '[DONE]') {
                sawDone = true;
                return;
            }
        }
    }
    if (!sawDone) {
        throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED');
    }
}
/** wire finish_reason 鈫?harness FinishReason銆?*/
function mapFinishReason(reason) {
    switch (reason) {
        case 'stop':
            return { kind: 'stop' };
        case 'tool_calls':
            return { kind: 'tool-calls' };
        case 'length':
            return { kind: 'max-tokens' };
        default:
            return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } };
    }
}
/** wire usage 鈫?harness 涓嶇浉浜よ鏁帮紙Ollama 鏃犵紦瀛樻媶鍒嗭紝鐩存帴閫忎紶锛夈€?*/
function mapUsage(usage) {
    return {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
    };
}
function closeBlock(block) {
    switch (block.kind) {
        case 'text':
            return { type: 'text', text: block.text };
        case 'reasoning':
            return { type: 'reasoning', text: block.text };
        case 'tool-call':
            return {
                type: 'tool-call',
                id: ToolCallId(block.callId ?? ''),
                name: block.name ?? '',
                arguments: block.text,
            };
    }
}
/**
 * SSE data 杞借嵎 鈫?StreamChunk 娴併€倀ext/reasoning/tool-call 鎸夐渶寮€鍧楋紱
 * block-end / usage / finish 鍏ㄩ儴寤惰繜鍒?[DONE]锛屼繚璇?finish 涔嬪悗鏃?chunk銆? */
export async function* translate(payloads) {
    let nextIndex = 0;
    let textBlock;
    let reasoningBlock;
    const toolBlocks = new Map();
    const order = [];
    let pendingFinish;
    let pendingUsage;
    const open = (kind) => {
        const block = { index: nextIndex++, kind, text: '' };
        order.push(block);
        return block;
    };
    for await (const payload of payloads) {
        if (payload === '[DONE]') {
            for (const block of order) {
                yield { type: 'block-end', index: block.index, block: closeBlock(block) };
            }
            if (pendingUsage)
                yield { type: 'usage', usage: pendingUsage };
            const reason = pendingFinish ?? { kind: 'stop' };
            yield {
                type: 'finish',
                reason: reason.kind === 'stop' && order.length === 0
                    ? {
                        kind: 'error',
                        failure: {
                            message: 'model returned a completed response with no content',
                            code: EMPTY_RESPONSE_CODE,
                        },
                    }
                    : reason,
            };
            return;
        }
        let chunk;
        try {
            chunk = JSON.parse(payload);
        }
        catch {
            throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE');
        }
        for (const choice of chunk.choices ?? []) {
            const delta = choice.delta;
            // Ollama 0.32 鍏煎灞傛€濊€冨瓧娈典负 delta.reasoning锛汥eepSeek 椋庢牸涓?reasoning_content
            const reasoning = delta?.reasoning_content ?? delta?.reasoning;
            if (typeof reasoning === 'string' && reasoning.length > 0) {
                if (!reasoningBlock) {
                    reasoningBlock = open('reasoning');
                    yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' };
                }
                reasoningBlock.text += reasoning;
                yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning };
            }
            const content = delta?.content;
            if (typeof content === 'string' && content.length > 0) {
                if (!textBlock) {
                    textBlock = open('text');
                    yield { type: 'block-start', index: textBlock.index, blockType: 'text' };
                }
                textBlock.text += content;
                yield { type: 'text-delta', index: textBlock.index, text: content };
            }
            for (const call of delta?.tool_calls ?? []) {
                const key = call.index ?? 0;
                let block = toolBlocks.get(key);
                if (!block) {
                    block = open('tool-call');
                    toolBlocks.set(key, block);
                    yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
                }
                if (call.id !== undefined)
                    block.callId = call.id;
                if (call.function?.name !== undefined)
                    block.name = call.function.name;
                const fragment = call.function?.arguments ?? '';
                block.text += fragment;
                yield {
                    type: 'tool-call-delta',
                    index: block.index,
                    id: ToolCallId(block.callId ?? ''),
                    ...(block.name !== undefined ? { name: block.name } : {}),
                    argumentsDelta: fragment,
                };
            }
            if (typeof choice.finish_reason === 'string') {
                pendingFinish = mapFinishReason(choice.finish_reason);
            }
        }
        if (chunk.usage)
            pendingUsage = mapUsage(chunk.usage);
    }
    throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED');
}
/** HTTP 鐘舵€?鈫?绋冲畾 LlmError code銆?*/
export function httpErrorCode(status) {
    if (status === 401 || status === 403)
        return 'AUTH';
    if (status === 429)
        return 'RATE_LIMIT';
    if (status === 400)
        return 'INVALID_REQUEST';
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
//# sourceMappingURL=protocol.js.map