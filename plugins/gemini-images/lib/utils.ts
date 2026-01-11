/**
 * 工具函数模块
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';

/**
 * 图片结果类型
 */
export interface ImageResult {
    base64: string;
    mimeType: string;
}

/**
 * HTTP 错误
 */
export class HttpError extends Error {
    status: number;
    url: string;
    body: string;

    constructor(message: string, details: { status: number; url: string; body: string }) {
        super(message);
        this.name = 'HttpError';
        this.status = details.status;
        this.url = details.url;
        this.body = details.body;
    }
}

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * 生成批次 ID（用于文件命名）
 */
export function generateBatchId(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
    const rand = crypto.randomBytes(2).toString('hex');
    return `${dateStr}-${timeStr}-${rand}`;
}

/**
 * 限制整数范围
 */
export function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * 解析整数，失败返回默认值
 */
export function parseIntOr(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) return n;
    }
    return defaultValue;
}

/**
 * 解析 Data URL
 */
export function parseDataUrl(url: string): { base64: string; mimeType: string } | null {
    if (!url || typeof url !== 'string') return null;
    const match = /^data:([^;]+);base64,(.+)$/i.exec(url);
    if (match) {
        return { mimeType: match[1], base64: match[2] };
    }
    return null;
}

/**
 * 去除 Data URL 前缀
 */
export function stripDataUrlPrefix(str: string): string {
    const parsed = parseDataUrl(str);
    return parsed ? parsed.base64 : str;
}

/**
 * 验证 Base64 字符串
 */
export function isValidBase64(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    try {
        const decoded = Buffer.from(str, 'base64');
        return decoded.length > 0;
    } catch {
        return false;
    }
}

/**
 * 根据 MIME 类型获取扩展名
 */
export function extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
    };
    return map[mimeType?.toLowerCase()] || 'png';
}

/**
 * 路径转换为显示格式（统一使用正斜杠）
 */
export function toDisplayPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * 解析输出目录路径
 */
export function resolveOutDir(dir: string | undefined | null): string {
    if (!dir || typeof dir !== 'string') return '';

    let resolved = dir.trim();

    // 处理 ~ 开头的路径
    if (resolved.startsWith('~')) {
        resolved = path.join(os.homedir(), resolved.slice(1));
    }

    // 解析为绝对路径
    if (!path.isAbsolute(resolved)) {
        resolved = path.resolve(resolved);
    }

    return resolved;
}

/**
 * 获取默认图片目录
 */
export function getDefaultPicturesDir(): string {
    const home = os.homedir();
    const platform = os.platform();

    if (platform === 'win32' || platform === 'darwin') {
        return path.join(home, 'Pictures');
    }

    // Linux: 尝试使用 XDG_PICTURES_DIR
    const xdgPictures = process.env.XDG_PICTURES_DIR;
    if (xdgPictures) {
        return xdgPictures;
    }

    return path.join(home, 'Pictures');
}

/**
 * 尺寸转换为宽高比
 */
export function sizeToAspectRatio(size: string): string {
    if (!size) return '1:1';

    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) return '1:1';

    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    const ratio = w / h;

    const ratioMap = [
        { ratio: 1, value: '1:1' },
        { ratio: 16 / 9, value: '16:9' },
        { ratio: 9 / 16, value: '9:16' },
        { ratio: 4 / 3, value: '4:3' },
        { ratio: 3 / 4, value: '3:4' },
        { ratio: 3 / 2, value: '3:2' },
        { ratio: 2 / 3, value: '2:3' },
    ];

    for (const { ratio: r, value } of ratioMap) {
        if (Math.abs(ratio - r) < 0.1) return value;
    }

    return '1:1';
}

/**
 * 带超时的 fetch
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * 从 URL 获取图片并转换为 base64
 */
export async function fetchUrlAsBase64(
    url: string,
    timeoutMs: number
): Promise<ImageResult> {
    const response = await fetchWithTimeout(url, {}, timeoutMs);

    if (!response.ok) {
        throw new HttpError(`Failed to fetch image: ${response.status}`, {
            status: response.status,
            url,
            body: await response.text().catch(() => ''),
        });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
        base64,
        mimeType: contentType.split(';')[0].trim(),
    };
}
