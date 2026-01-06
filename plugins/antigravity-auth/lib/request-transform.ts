/**
 * Request/Response Transformation for Antigravity
 *
 * Transforms OpenAI Responses API format requests to Antigravity API format.
 * Alma uses createOpenAI() for all plugin providers, so requests come in
 * OpenAI format and need to be converted to Gemini format for Antigravity.
 */

import type {
    AntigravityRequestBody,
    GeminiRequest,
    GeminiContent,
    GeminiPart,
    GeminiTool,
    GeminiFunctionDeclaration,
    GeminiGenerationConfig,
    HeaderStyle,
    AntigravityHeaders,
} from './types';
import { getModelFamily, isClaudeThinkingModel, parseModelWithTier } from './models';

// ============================================================================
// Constants
// ============================================================================

// Antigravity API endpoints (in fallback order)
// Note: autopush endpoint is unavailable per API spec
export const ANTIGRAVITY_ENDPOINTS = [
    'https://daily-cloudcode-pa.sandbox.googleapis.com',
    'https://cloudcode-pa.googleapis.com',
] as const;

export const PRIMARY_ENDPOINT = ANTIGRAVITY_ENDPOINTS[0];

// Headers for different quota types
export const ANTIGRAVITY_HEADERS: AntigravityHeaders = {
    'User-Agent': 'antigravity/1.11.5 windows/amd64',
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};

export const GEMINI_CLI_HEADERS: AntigravityHeaders = {
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
};

// Claude thinking model max output tokens
const CLAUDE_THINKING_MAX_OUTPUT_TOKENS = 65536;

// ============================================================================
// Request URL Detection
// ============================================================================

/**
 * Check if this is a Generative Language API request or OpenAI Responses API request
 */
export function isGenerativeLanguageRequest(url: string): boolean {
    return url.includes('generativelanguage.googleapis.com') || url.includes('/responses');
}

/**
 * Extract model from URL
 */
export function extractModelFromUrl(url: string): string | null {
    const match = url.match(/\/models\/([^:/?]+)/);
    return match?.[1] ?? null;
}

/**
 * Detect if this is a streaming request
 */
export function isStreamingRequest(url: string): boolean {
    return url.includes(':streamGenerateContent') || url.includes('stream=true');
}

// ============================================================================
// OpenAI Responses API to Gemini Format Conversion
// ============================================================================

/**
 * OpenAI Responses API item types
 */
interface ResponsesAPIItem {
    type: string;
    id?: string;
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
    status?: string;
}

/**
 * OpenAI Responses API request body
 */
interface ResponsesAPIRequestBody {
    model: string;
    input?: ResponsesAPIItem[];
    instructions?: string;
    tools?: Array<{
        type: string;
        name?: string;
        description?: string;
        parameters?: Record<string, unknown>;
    }>;
    stream?: boolean;
    max_output_tokens?: number;
    temperature?: number;
    top_p?: number;
}

/**
 * Convert OpenAI Responses API input to Gemini contents format
 */
function convertInputToContents(input: ResponsesAPIItem[]): {
    contents: GeminiContent[];
    systemInstruction?: { parts: Array<{ text: string }> };
} {
    const contents: GeminiContent[] = [];
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const item of input) {
        // Handle system messages
        if (item.type === 'message' && item.role === 'system') {
            const text = extractTextFromContent(item.content);
            if (text) {
                if (systemInstruction) {
                    systemInstruction.parts.push({ text });
                } else {
                    systemInstruction = { parts: [{ text }] };
                }
            }
            continue;
        }

        // Handle user messages
        if (item.type === 'message' && item.role === 'user') {
            const text = extractTextFromContent(item.content);
            if (text) {
                contents.push({
                    role: 'user',
                    parts: [{ text }],
                });
            }
            continue;
        }

        // Handle assistant messages
        if (item.type === 'message' && item.role === 'assistant') {
            const text = extractTextFromContent(item.content);
            if (text) {
                contents.push({
                    role: 'model',
                    parts: [{ text }],
                });
            }
            continue;
        }

        // Handle function calls
        if (item.type === 'function_call') {
            let args: Record<string, unknown> = {};
            if (item.arguments) {
                try {
                    args = JSON.parse(item.arguments);
                } catch {
                    // Keep empty args
                }
            }
            contents.push({
                role: 'model',
                parts: [{
                    functionCall: {
                        name: item.name || 'unknown',
                        args,
                        id: item.call_id,
                    },
                }],
            });
            continue;
        }

        // Handle function call outputs
        if (item.type === 'function_call_output') {
            contents.push({
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: item.name || 'unknown',
                        response: { result: item.output || '' },
                        id: item.call_id,
                    },
                }],
            });
            continue;
        }
    }

    return { contents, systemInstruction };
}

/**
 * Extract text from content (string or array)
 */
function extractTextFromContent(content: string | Array<{ type: string; text?: string }> | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(c => c.type === 'text' || c.type === 'input_text' || c.type === 'output_text')
            .map(c => c.text || '')
            .join('\n');
    }
    return '';
}

/**
 * Convert OpenAI tools to Gemini function declarations
 */
function convertToolsToFunctionDeclarations(tools: ResponsesAPIRequestBody['tools']): GeminiTool[] {
    if (!tools || tools.length === 0) return [];

    const functionDeclarations: GeminiFunctionDeclaration[] = [];

    for (const tool of tools) {
        if (tool.type !== 'function') continue;

        functionDeclarations.push({
            name: tool.name || 'unknown',
            description: tool.description || '',
            parameters: tool.parameters,
        });
    }

    if (functionDeclarations.length === 0) return [];

    return [{ functionDeclarations }];
}

// ============================================================================
// Request Transformation
// ============================================================================

export interface TransformResult {
    url: string;
    body: string;
    headers: Headers;
    streaming: boolean;
    effectiveModel: string;
    projectId: string;
}

/**
 * Transform OpenAI Responses API request to Antigravity format.
 */
export function transformRequest(
    originalUrl: string,
    body: string,
    accessToken: string,
    projectId: string,
    headerStyle: HeaderStyle = 'antigravity',
    endpoint: string = PRIMARY_ENDPOINT,
    logger?: { debug: (msg: string, ...args: unknown[]) => void }
): TransformResult {
    let parsed: ResponsesAPIRequestBody;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new Error('Invalid request body');
    }

    const requestedModel = parsed.model || 'unknown';
    const { baseModel, thinkingLevel, thinkingBudget } = parseModelWithTier(requestedModel);
    const effectiveModel = baseModel;

    logger?.debug(`Model resolution: ${requestedModel} -> ${effectiveModel}, thinking=${thinkingLevel}, budget=${thinkingBudget}`);
    const family = getModelFamily(requestedModel);
    const isClaude = family === 'claude';
    const isThinking = isClaudeThinkingModel(requestedModel);
    const streaming = parsed.stream === true;

    // Convert OpenAI Responses API input to Gemini format
    const input = parsed.input || [];
    const { contents, systemInstruction } = convertInputToContents(input);

    logger?.debug(`Converted ${input.length} input items to ${contents.length} contents`);

    // Validate contents - must have at least one message
    if (contents.length === 0 && !systemInstruction) {
        throw new Error('No valid messages found in request. Input items may have unexpected format.');
    }

    // Build Gemini request
    const geminiRequest: GeminiRequest = {
        contents,
    };

    // Add system instruction
    if (systemInstruction) {
        geminiRequest.systemInstruction = systemInstruction;
    } else if (parsed.instructions) {
        // Use instructions field as system instruction
        geminiRequest.systemInstruction = {
            parts: [{ text: parsed.instructions }],
        };
    }

    // Add thinking hint for Claude thinking models with tools
    if (isThinking && parsed.tools && parsed.tools.length > 0 && geminiRequest.systemInstruction) {
        const hint = 'Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer.';
        geminiRequest.systemInstruction.parts.push({ text: hint });
    }

    // Convert tools
    if (parsed.tools && parsed.tools.length > 0) {
        geminiRequest.tools = convertToolsToFunctionDeclarations(parsed.tools);

        // Set tool config for Claude VALIDATED mode
        if (isClaude) {
            geminiRequest.toolConfig = {
                functionCallingConfig: {
                    mode: 'VALIDATED',
                },
            };
        }
    }

    // Build generation config
    const generationConfig: GeminiGenerationConfig = {};

    if (parsed.max_output_tokens) {
        generationConfig.maxOutputTokens = parsed.max_output_tokens;
    }
    if (parsed.temperature !== undefined) {
        generationConfig.temperature = parsed.temperature;
    }
    if (parsed.top_p !== undefined) {
        generationConfig.topP = parsed.top_p;
    }

    // Add thinking config for Claude thinking models
    if (isThinking && thinkingBudget) {
        generationConfig.thinkingConfig = {
            include_thoughts: true,
            thinking_budget: thinkingBudget,
        };
        // Ensure maxOutputTokens is large enough
        if (!generationConfig.maxOutputTokens || generationConfig.maxOutputTokens <= thinkingBudget) {
            generationConfig.maxOutputTokens = CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
        }
    }

    if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
    }

    // Add session ID for multi-turn conversations
    geminiRequest.sessionId = `alma-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Wrap in Antigravity format
    const antigravityBody: AntigravityRequestBody = {
        project: projectId,
        model: effectiveModel,
        request: geminiRequest,
        userAgent: 'antigravity',
        requestId: `alma-${crypto.randomUUID()}`,
    };

    // Build URL
    const action = streaming ? 'streamGenerateContent' : 'generateContent';
    const url = `${endpoint}/v1internal:${action}${streaming ? '?alt=sse' : ''}`;

    // Build headers
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Content-Type', 'application/json');

    const selectedHeaders = headerStyle === 'gemini-cli' ? GEMINI_CLI_HEADERS : ANTIGRAVITY_HEADERS;
    headers.set('User-Agent', selectedHeaders['User-Agent']);
    headers.set('X-Goog-Api-Client', selectedHeaders['X-Goog-Api-Client']);
    headers.set('Client-Metadata', selectedHeaders['Client-Metadata']);

    if (streaming) {
        headers.set('Accept', 'text/event-stream');
    }

    // Add interleaved thinking header for Claude thinking models
    if (isThinking) {
        headers.set('anthropic-beta', 'interleaved-thinking-2025-05-14');
    }

    return {
        url,
        body: JSON.stringify(antigravityBody),
        headers,
        streaming,
        effectiveModel,
        projectId,
    };
}

// ============================================================================
// Response Transformation
// ============================================================================

/**
 * Transform Antigravity SSE response to OpenAI Responses API format.
 */
export function transformStreamingResponse(response: Response): Response {
    if (!response.body) {
        return response;
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const transformStream = new TransformStream({
        async transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) {
                    controller.enqueue(encoder.encode('\n'));
                    continue;
                }

                if (!line.startsWith('data: ')) {
                    controller.enqueue(encoder.encode(line + '\n'));
                    continue;
                }

                const dataStr = line.slice(6).trim();
                if (!dataStr || dataStr === '[DONE]') {
                    controller.enqueue(encoder.encode(line + '\n'));
                    continue;
                }

                try {
                    const data = JSON.parse(dataStr);
                    // Unwrap Antigravity envelope and transform to OpenAI format
                    const unwrapped = data.response || data;
                    const transformed = transformGeminiToOpenAI(unwrapped);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n`));
                } catch {
                    // Pass through as-is if parsing fails
                    controller.enqueue(encoder.encode(line + '\n'));
                }
            }
        },
        flush(controller) {
            if (buffer.trim()) {
                controller.enqueue(encoder.encode(buffer + '\n'));
            }
        }
    });

    return new Response(response.body.pipeThrough(transformStream), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

/**
 * Transform Gemini response to OpenAI Responses API format
 */
function transformGeminiToOpenAI(data: any): any {
    // Already in OpenAI format
    if (data.type || data.object) {
        return data;
    }

    const candidates = data.candidates || [];
    if (candidates.length === 0) {
        return data;
    }

    const candidate = candidates[0];
    const content = candidate.content || {};
    const parts = content.parts || [];

    // Build output items
    const output: any[] = [];

    for (const part of parts) {
        if (part.text && !part.thought) {
            output.push({
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
            });
        } else if (part.functionCall) {
            output.push({
                type: 'function_call',
                call_id: part.functionCall.id || `call_${Date.now()}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
            });
        }
    }

    return {
        type: 'response',
        output,
        usage: data.usageMetadata ? {
            input_tokens: data.usageMetadata.promptTokenCount || 0,
            output_tokens: data.usageMetadata.candidatesTokenCount || 0,
        } : undefined,
    };
}

/**
 * Transform non-streaming response from Antigravity to OpenAI format.
 */
export async function transformNonStreamingResponse(response: Response): Promise<Response> {
    const text = await response.text();

    try {
        const data = JSON.parse(text);

        // Unwrap Antigravity envelope and transform
        const unwrapped = data.response || data;
        const transformed = transformGeminiToOpenAI(unwrapped);

        return new Response(JSON.stringify(transformed), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    } catch {
        // Return original response if parsing fails
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    }
}
