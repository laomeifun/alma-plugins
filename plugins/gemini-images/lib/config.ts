/**
 * 配置管理模块
 */
import type { PluginContext } from 'alma-plugin-api';

/**
 * 插件配置
 */
export interface GeminiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    defaultSize: string;
    defaultOutDir: string;
    sessionTtlMs: number;
    timeoutMs: number;
}

/**
 * 默认配置值
 */
export const DEFAULTS = {
    BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    MODEL: 'gemini-2.0-flash-exp-image-generation',
    SIZE: '1024x1024',
    TIMEOUT_MS: 120_000,
    SESSION_TTL_MS: 30 * 60 * 1000, // 30 分钟
    SESSION_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 分钟
    MAX_HISTORY_MESSAGES: 20, // 最大历史消息数（每轮对话包含 user + assistant 两条）
};

const SECRET_KEY_API = 'gemini_api_key';

/**
 * 从插件上下文加载配置
 */
export async function loadConfig(context: PluginContext): Promise<GeminiConfig> {
    const { settings, storage } = context;

    // 从 SecretStorage 读取 API Key
    const apiKey = await storage.secrets.get(SECRET_KEY_API) || '';

    // 从设置读取其他配置
    const baseUrl = settings.get<string>('geminiImages.baseUrl', DEFAULTS.BASE_URL);
    const model = settings.get<string>('geminiImages.model', DEFAULTS.MODEL);
    const defaultSize = settings.get<string>('geminiImages.defaultSize', DEFAULTS.SIZE);
    const defaultOutDir = settings.get<string>('geminiImages.defaultOutDir', '');
    const sessionTtlMinutes = settings.get<number>('geminiImages.sessionTtlMinutes', 30);
    const timeoutSeconds = settings.get<number>('geminiImages.timeoutSeconds', 120);

    return {
        baseUrl,
        apiKey,
        model,
        defaultSize,
        defaultOutDir,
        sessionTtlMs: sessionTtlMinutes * 60 * 1000,
        timeoutMs: timeoutSeconds * 1000,
    };
}

/**
 * 保存 API Key 到安全存储
 */
export async function saveApiKey(context: PluginContext, apiKey: string): Promise<void> {
    await context.storage.secrets.set(SECRET_KEY_API, apiKey);
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(context: PluginContext): Promise<void> {
    await context.storage.secrets.delete(SECRET_KEY_API);
}

/**
 * 检查 API Key 是否已配置
 */
export async function hasApiKey(context: PluginContext): Promise<boolean> {
    const key = await context.storage.secrets.get(SECRET_KEY_API);
    return !!key && key.trim().length > 0;
}
