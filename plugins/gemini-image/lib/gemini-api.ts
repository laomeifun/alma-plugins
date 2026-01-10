/**
 * Gemini Image Generator - API Client
 *
 * Handles communication with the Gemini image generation API.
 */

export interface ImageGenerationOptions {
    baseUrl: string;
    apiKey?: string;
    model: string;
    prompt: string;
    size: string;
    n: number;
    timeoutMs: number;
}

export interface GeneratedImage {
    base64: string;
    mimeType: string;
}

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
        const res = await fetch(url, { ...init, signal: controller.signal });
        return res;
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

/**
 * Generate images via chat/completions API
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
        throw new Error(`图片生成失败: HTTP ${res.status}${hint} ${text}`);
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
        throw new Error('接口未返回可用的图片数据');
    }

    return images;
}

/**
 * Generate images via images/generations API
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
        throw new Error(`图片生成失败: HTTP ${res.status}${hint} ${text}`);
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
 * Main function to generate images
 * Tries images/generations API first, falls back to chat/completions
 */
export async function generateImages(
    options: ImageGenerationOptions
): Promise<GeneratedImage[]> {
    const count = Math.max(1, Math.min(4, options.n));

    // Try images/generations API first
    try {
        return await generateImagesViaImagesApi({ ...options, n: count });
    } catch (err: unknown) {
        // If 404, fall back to chat/completions
        if (err instanceof Error && err.message.includes('404')) {
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
