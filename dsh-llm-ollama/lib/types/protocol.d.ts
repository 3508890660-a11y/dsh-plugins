import type { ContentBlockType, GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
export interface OllamaEndpointConfig {
    baseUrl: string;
    apiKey: string;
}
/** OpenAI 鍏煎 wire message锛圤llama /v1/chat/completions 鐨?messages 椤癸級銆?*/
interface WireMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: {
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }[];
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
export declare function serializeMessages(messages: readonly RequestMessage[]): WireMessage[];
/**
 * 缁勮瀹屾暣 wire 璇锋眰銆俼wen3 绯绘ā鍨嬮粯璁ゆ€濊€冿紝鏄惧紡 reasoningEffort 鏄犲皠涓? * thinking 寮€鍏筹紙'off' 鈫?disabled锛屽叾浣?鈫?enabled锛岀己鐪佷笉浼犺 provider 榛樿锛夈€? */
export declare function serializeRequest(options: GenerateOptions, _endpoint: OllamaEndpointConfig): Record<string, unknown>;
/**
 * 闆朵緷璧?SSE 瑙ｆ瀽锛氳В鐮佸瓧鑺傛祦 鈫?鎸夌┖琛屽垏浜嬩欢 鈫?鎻愬彇 data: 琛屻€? * 娴佺粨鏉熸湭鏀跺埌 [DONE] 瑙嗕负鎴柇锛圠LM 璋冪敤缁撴灉涓嶅彲淇★級锛屾姏 STREAM_CLOSED銆? */
export declare function parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string>;
/**
 * SSE data 杞借嵎 鈫?StreamChunk 娴併€倀ext/reasoning/tool-call 鎸夐渶寮€鍧楋紱
 * block-end / usage / finish 鍏ㄩ儴寤惰繜鍒?[DONE]锛屼繚璇?finish 涔嬪悗鏃?chunk銆? */
export declare function translate(payloads: AsyncGenerator<string>): AsyncGenerator<StreamChunk>;
/** HTTP 鐘舵€?鈫?绋冲畾 LlmError code銆?*/
export declare function httpErrorCode(status: number): string;
export type { ContentBlockType };
