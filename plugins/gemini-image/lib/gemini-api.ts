/**
 * Gemini Image Generator - API Client
 *
 * Handles communication with OpenAI-compatible image generation APIs.
 * Supports both /images/generations and /chat/completions endpoints.
 */

// ============================================================================
// Types
// ============================================================================

export interface ImageGenerationOptions {
    baseUrl: string;
    apiKey?: string;
    model: string;
    prompt: string;
    size: string;
    n: number;
    timeoutMs: number;
    mode?: 'auto' | 'images' | 'chat';
}

export interface GeneratedImage {
    base64: string;
    mimeType: string;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Normalize base URL by removing trailing slashes
 */
function normalizeBaseUrl(raw: string): string {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return 'http://127.0.0.1:8317';
    return trimmed.replace(/\/+$/, '');
}

/**
 * Ensure URL ends with /v1
 */
function toV1BaseUrl(baseUrl: string): string {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized.endsWith('/v1')) return normalized;
    return `${normalized}/v1`;
}

/**
 * Get file extension from MIME type
 */
export function extFromMime(mimeType: string): string {
    switch ((mimeType || '').toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'image/png':
        default:
            return 'png';
    }
}

/**
 * Parse data URL to extract base64 and MIME type
 */
function parseDataUrl(maybeDataUrl: string): { mimeType: string; base64: string } | null {
    const s = maybeDataUrl ?? '';
    const match = /^data:([^;]+);base64,(.+)$/s.exec(s);
    if (!match) return null;
    return {
        mimeType: match[1].trim() || 'application/octet-stream',
        base64: match[2],
    };
}

/**
 * Strip data URL prefix if present
 */
function stripDataUrlPrefix(maybeDataUrl: string): string {
    const parsed = parseDataUrl(maybeDataUrl);
    return parsed ? parsed.base64 : (maybeDataUrl ?? '');
}

/**
 * Clamp integer value between min and max
 */
function clampInt(value: number, min: number, max: number): number {
    const n = Number.isFinite(value) ? value : min;
    return Math.max(min, Math.min(max, n));
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`);
        }
        throw new Error(`网络请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Convert ArrayBuffer to base64 string (browser-compatible)
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Fetch URL content as base64
 */
async function fetchUrlAsBase64(
    url: string,
    timeoutMs: number
): Promise<{ base64: string; mimeType: string }> {
    const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`拉取图片失败: HTTP ${res.status} ${body}`);
    }
    const mimeTypeHeader = res.headers.get('content-type') ?? 'image/png';
    const mimeType = mimeTypeHeader.split(';')[0].trim() || 'image/png';
    const arrayBuffer = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    return { base64, mimeType };
}

// ============================================================================
// API Implementations
// ============================================================================

/**
 * Generate images via /images/generations API (OpenAI-compatible)
 */
async function generateImagesViaImagesApi(
    options: ImageGenerationOptions
): Promise<GeneratedImage[]> {
    const { baseUrl, apiKey, model, prompt, size, n, timeoutMs } = options;
    const v1BaseUrl = toV1BaseUrl(baseUrl);
    const url = `${v1BaseUrl}/images/generations`;

    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const body = {
        model,
        prompt,
        size,
        n,
        response_format: 'b64_json',
    };

    const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(body) },
        timeoutMs
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const hint = res.status === 401 ? '（需要 API Key）' : '';
        const error = new Error(`图片生成失败: HTTP ${res.status}${hint} ${text}`);
        (error as Error & { status?: number }).status = res.status;
        throw error;
    }

    interface ImagesResponse {
        data?: Array<{ b64_json?: string; url?: string }>;
    }

    const json: ImagesResponse = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];

    const images: GeneratedImage[] = [];
    for (const item of data) {
        if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
            const parsed = parseDataUrl(item.b64_json);
            images.push({
                base64: stripDataUrlPrefix(item.b64_json),
                mimeType: parsed?.mimeType ?? 'image/png',
            });
            continue;
        }
        if (typeof item?.url === 'string' && item.url.trim()) {
            images.push(await fetchUrlAsBase64(item.url, timeoutMs));
        }
    }

    if (images.length === 0) throw new Error('接口未返回可用的图片数据');
    return images;
}

/**
 * Generate images via /chat/completions API (Gemini-style)
 */
async function generateImagesViaChatCompletions(
    options: ImageGenerationOptions
): Promise<GeneratedImage[]> {
    const { baseUrl, apiKey, model, prompt, size, timeoutMs } = options;
    const v1BaseUrl = toV1BaseUrl(baseUrl);
    const url = `${v1BaseUrl}/chat/completions`;

    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        modalities: ['image'],
        image_config: {
            image_size: size,
        },
    };

    const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers, body: JSON.stringify(body) },
        timeoutMs
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const hint = res.status === 401 ? '（需要 API Key）' : '';
        const error = new Error(`图片生成失败: HTTP ${res.status}${hint} ${text}`);
        (error as Error & { status?: number }).status = res.status;
        throw error;
    }

    interface ChatCompletionResponse {
        choices?: Array<{
            message?: {
                images?: Array<{
                    image_url?: { url?: string };
                    url?: string;
                    imageUrl?: string;
                }>;
            };
        }>;
    }

    const json: ChatCompletionResponse = await res.json();
    const choices = Array.isArray(json?.choices) ? json.choices : [];

    const images: GeneratedImage[] = [];

    for (const choice of choices) {
        const messageImages = choice?.message?.images;
        if (!Array.isArray(messageImages)) continue;
        for (const img of messageImages) {
            const imageUrl =
                img?.image_url?.url ?? img?.url ?? img?.imageUrl ?? '';
            if (typeof imageUrl !== 'string' || !imageUrl.trim()) continue;

            const parsed = parseDataUrl(imageUrl);
            if (parsed) {
                images.push({ base64: parsed.base64, mimeType: parsed.mimeType });
                continue;
            }
            images.push(await fetchUrlAsBase64(imageUrl, timeoutMs));
        }
    }

    if (images.length === 0) {
        throw new Error('接口未返回可用的图片数据（chat/completions 未找到 choices[].message.images）');
    }

    return images;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Generate images using the specified mode
 *
 * @param options - Image generation options
 * @returns Array of generated images with base64 data and MIME type
 *
 * Modes:
 * - 'images': Use /images/generations API only
 * - 'chat': Use /chat/completions API only
 * - 'auto' (default): Try /images/generations first, fallback to /chat/completions on 404
 */
export async function generateImages(
    options: ImageGenerationOptions
): Promise<GeneratedImage[]> {
    const mode = options.mode ?? 'auto';
    const count = clampInt(options.n, 1, 4);

    // Mode: images - use /images/generations only
    if (mode === 'images') {
        return await generateImagesViaImagesApi({ ...options, n: count });
    }

    // Mode: chat - use /chat/completions only
    if (mode === 'chat') {
        const out: GeneratedImage[] = [];
        for (let i = 0; i < count; i++) {
            const batch = await generateImagesViaChatCompletions(options);
            out.push(...batch);
            if (out.length >= count) break;
        }
        return out.slice(0, count);
    }

    // Mode: auto - try images first, fallback to chat on 404
    try {
        return await generateImagesViaImagesApi({ ...options, n: count });
    } catch (err: unknown) {
        const status = (err as Error & { status?: number }).status;
        if (status === 404) {
            const out: GeneratedImage[] = [];
            for (let i = 0; i < count; i++) {
                const batch = await generateImagesViaChatCompletions(options);
                out.push(...batch);
                if (out.length >= count) break;
            }
            return out.slice(0, count);
        }
        throw err;
    }
}
