/**
 * API 客户端模块 - Gemini 图片生成 API 调用
 */
import type { GeminiConfig } from './config';
import type { Logger } from 'alma-plugin-api';
import {
    ImageResult,
    HttpError,
    fetchWithTimeout,
    fetchUrlAsBase64,
    parseDataUrl,
    stripDataUrlPrefix,
    sizeToAspectRatio,
    clampInt,
    parseIntOr,
} from './utils';

/**
 * 消息类型
 */
export interface Message {
    role: 'user' | 'assistant' | 'model';
    content: string | MessageContent[];
}

export interface MessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

/**
 * 生成参数
 */
export interface GenerateParams {
    config: GeminiConfig;
    prompt: string;
    size: string;
    n: number;
    historyMessages?: Message[];
    inputImage?: ImageResult | null;
    logger?: Logger;
}

/**
 * 通过 Gemini 原生 API (generateContent) 生成图片
 */
export async function generateImagesViaGeminiNative(params: GenerateParams): Promise<ImageResult[]> {
    const { config, prompt, size, historyMessages = [], inputImage, logger } = params;

    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };

    // 构建 Gemini 原生格式的 contents
    const contents: Array<{ role: string; parts: unknown[] }> = [];

    // 添加历史消息
    for (const msg of historyMessages) {
        const parts: unknown[] = [];

        if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
                if (item.type === 'text' && item.text) {
                    parts.push({ text: item.text });
                } else if (item.type === 'image_url' && item.image_url?.url) {
                    const parsed = parseDataUrl(item.image_url.url);
                    if (parsed) {
                        parts.push({
                            inline_data: {
                                data: parsed.base64,
                                mime_type: parsed.mimeType,
                            },
                        });
                    }
                }
            }
        }

        contents.push({
            role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
            parts,
        });
    }

    // 构建当前用户消息
    const currentParts: unknown[] = [{ text: prompt }];
    if (inputImage?.base64) {
        currentParts.push({
            inline_data: {
                data: inputImage.base64,
                mime_type: inputImage.mimeType || 'image/png',
            },
        });
    }
    contents.push({ role: 'user', parts: currentParts });

    const aspectRatio = sizeToAspectRatio(size);

    const body = {
        contents,
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio },
        },
    };

    logger?.debug(`[gemini-images] POST ${url.replace(/key=[^&]+/, 'key=***')} model=${config.model} aspectRatio=${aspectRatio}`);

    const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(body) },
        config.timeoutMs
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const hint = res.status === 401 || res.status === 403
            ? '（API Key 无效或无权限，请检查配置）'
            : '';
        throw new HttpError(`图片生成失败: HTTP ${res.status}${hint} ${text}`, {
            status: res.status,
            url: url.replace(/key=[^&]+/, 'key=***'),
            body: text,
        });
    }

    const json = await res.json();
    const images = parseGeminiResponse(json);

    if (images.length === 0) {
        throw new Error(
            '模型未返回图片数据。请确保使用支持图片生成的模型（如 gemini-2.0-flash-exp-image-generation）'
        );
    }

    return images;
}

/**
 * 通过 Chat Completions API 生成图片（OpenAI 兼容）
 */
export async function generateImagesViaChatCompletions(params: GenerateParams): Promise<ImageResult[]> {
    const { config, prompt, size, historyMessages = [], inputImage, logger } = params;

    let baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/v1')) {
        baseUrl = `${baseUrl}/v1`;
    }
    const url = `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) {
        headers.authorization = `Bearer ${config.apiKey}`;
    }

    // 构建当前用户消息内容
    let currentUserContent: string | MessageContent[];
    if (inputImage?.base64) {
        currentUserContent = [
            { type: 'text', text: prompt },
            {
                type: 'image_url',
                image_url: {
                    url: `data:${inputImage.mimeType || 'image/png'};base64,${inputImage.base64}`,
                },
            },
        ];
    } else {
        currentUserContent = prompt;
    }

    const messages = [...historyMessages, { role: 'user', content: currentUserContent }];

    const body = {
        model: config.model,
        messages,
        stream: false,
        modalities: ['text', 'image'],
        extra_body: {
            google: {
                response_modalities: ['TEXT', 'IMAGE'],
                image_config: { image_size: size },
            },
        },
        image_config: { image_size: size },
    };

    logger?.debug(`[gemini-images] POST ${url} (chat/completions) model=${config.model}`);

    const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(body) },
        config.timeoutMs
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const hint = res.status === 401 ? '（需要 API Key，请检查配置）' : '';
        throw new HttpError(`图片生成失败: HTTP ${res.status}${hint} ${text}`, {
            status: res.status,
            url,
            body: text,
        });
    }

    const json = await res.json();
    const images = await parseOpenAICompatibleResponse(json, config.timeoutMs);

    if (images.length === 0) {
        throw new Error('接口未返回可用的图片数据');
    }

    return images;
}

/**
 * 解析 Gemini 原生 API 响应
 */
function parseGeminiResponse(json: unknown): ImageResult[] {
    const images: ImageResult[] = [];
    const data = json as { candidates?: Array<{ content?: { parts?: unknown[] } }> };
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        for (const part of parts) {
            const p = part as { inlineData?: { data: string; mimeType: string }; inline_data?: { data: string; mime_type: string } };
            // Gemini API 使用 camelCase
            if (p?.inlineData?.data) {
                images.push({
                    base64: p.inlineData.data,
                    mimeType: p.inlineData.mimeType || 'image/png',
                });
            } else if (p?.inline_data?.data) {
                // 也支持 snake_case
                images.push({
                    base64: p.inline_data.data,
                    mimeType: p.inline_data.mime_type || 'image/png',
                });
            }
        }
    }

    return images;
}

/**
 * 解析 OpenAI 兼容格式响应
 */
async function parseOpenAICompatibleResponse(json: unknown, timeoutMs: number): Promise<ImageResult[]> {
    const images: ImageResult[] = [];

    // 格式 1: Gemini 原生 API
    images.push(...parseGeminiResponse(json));

    // 格式 2-4: OpenAI 兼容格式
    const data = json as { choices?: Array<{ message?: { content?: unknown[]; images?: unknown[] } }> };
    const choices = Array.isArray(data?.choices) ? data.choices : [];

    for (const choice of choices) {
        const message = choice?.message;
        if (!message) continue;

        const content = message.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                const i = item as { inline_data?: { data: string; mime_type: string }; type?: string; image_url?: { url: string } };
                // Gemini 格式
                if (i?.inline_data?.data) {
                    images.push({
                        base64: i.inline_data.data,
                        mimeType: i.inline_data.mime_type || 'image/png',
                    });
                    continue;
                }
                // OpenAI 多模态格式
                if (i?.type === 'image_url' && i?.image_url?.url) {
                    const parsed = parseDataUrl(i.image_url.url);
                    if (parsed) {
                        images.push({ base64: parsed.base64, mimeType: parsed.mimeType });
                    } else if (i.image_url.url.startsWith('http')) {
                        images.push(await fetchUrlAsBase64(i.image_url.url, timeoutMs));
                    }
                }
            }
        }

        // 第三方代理格式
        const messageImages = message.images;
        if (Array.isArray(messageImages)) {
            for (const img of messageImages) {
                const imgData = img as { image_url?: { url: string } | string; url?: string; imageUrl?: string };
                const imageUrl = typeof imgData?.image_url === 'string'
                    ? imgData.image_url
                    : (imgData?.image_url as { url: string })?.url ?? imgData?.url ?? imgData?.imageUrl ?? '';

                if (typeof imageUrl !== 'string' || !imageUrl.trim()) continue;

                const parsed = parseDataUrl(imageUrl);
                if (parsed) {
                    images.push({ base64: parsed.base64, mimeType: parsed.mimeType });
                    continue;
                }
                if (imageUrl.startsWith('http')) {
                    images.push(await fetchUrlAsBase64(imageUrl, timeoutMs));
                }
            }
        }
    }

    return images;
}

/**
 * 多次调用生成器以获取指定数量的图片
 */
async function generateMultiple(
    generator: () => Promise<ImageResult[]>,
    count: number
): Promise<ImageResult[]> {
    const out: ImageResult[] = [];
    for (let i = 0; i < count; i += 1) {
        const batch = await generator();
        out.push(...batch);
        if (out.length >= count) break;
    }
    return out.slice(0, count);
}

/**
 * 生成图片（统一入口）
 */
export async function generateImages(params: GenerateParams): Promise<ImageResult[]> {
    const count = clampInt(parseIntOr(params?.n, 1), 1, 4);

    // 默认使用 Gemini 原生 API
    try {
        return await generateMultiple(() => generateImagesViaGeminiNative(params), count);
    } catch (err) {
        // 如果是 404，尝试 chat/completions
        if (err instanceof HttpError && (err.status === 404 || err.status === 400)) {
            params.logger?.debug('[gemini-images] Gemini native API failed, trying chat/completions');
            return await generateMultiple(() => generateImagesViaChatCompletions(params), count);
        }
        throw err;
    }
}
