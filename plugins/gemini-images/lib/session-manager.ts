/**
 * 会话管理模块 - 多轮对话状态管理（支持持久化）
 */
import type { Storage, Logger } from 'alma-plugin-api';
import type { Message } from './api-client';
import { ImageResult, generateSessionId } from './utils';
import { DEFAULTS } from './config';

/**
 * 会话对象
 */
export interface Session {
    id: string;
    messages: Message[];
    lastImage: ImageResult | null;
    createdAt: number;
    lastUsedAt: number;
}

/**
 * 存储数据格式
 */
interface StorageData {
    version: number;
    sessions: Record<string, Session>;
}

const STORAGE_KEY = 'gemini_sessions';
const STORAGE_VERSION = 1;

/**
 * 会话管理器
 */
export class SessionManager {
    private sessions: Map<string, Session> = new Map();
    private storage: Storage;
    private logger?: Logger;
    private sessionTtlMs: number;
    private maxHistoryMessages: number;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(storage: Storage, logger?: Logger, sessionTtlMs?: number, maxHistoryMessages?: number) {
        this.storage = storage;
        this.logger = logger;
        this.sessionTtlMs = sessionTtlMs ?? DEFAULTS.SESSION_TTL_MS;
        this.maxHistoryMessages = maxHistoryMessages ?? DEFAULTS.MAX_HISTORY_MESSAGES;
    }

    /**
     * 从存储加载会话数据
     */
    async load(): Promise<void> {
        try {
            const data = await this.storage.get<StorageData>(STORAGE_KEY);
            if (data && data.version === STORAGE_VERSION) {
                const now = Date.now();
                // 只加载未过期的会话
                for (const [id, session] of Object.entries(data.sessions)) {
                    if (now - session.lastUsedAt <= this.sessionTtlMs) {
                        this.sessions.set(id, session);
                    }
                }
                this.logger?.debug(`[gemini-images] Loaded ${this.sessions.size} sessions from storage`);
            }
        } catch (error) {
            this.logger?.error('[gemini-images] Failed to load sessions from storage:', error);
        }
    }

    /**
     * 保存会话数据到存储
     */
    async save(): Promise<void> {
        try {
            const sessionsObj: Record<string, Session> = {};
            for (const [id, session] of this.sessions) {
                sessionsObj[id] = session;
            }
            const data: StorageData = {
                version: STORAGE_VERSION,
                sessions: sessionsObj,
            };
            await this.storage.set(STORAGE_KEY, data);
            this.logger?.debug(`[gemini-images] Saved ${this.sessions.size} sessions to storage`);
        } catch (error) {
            this.logger?.error('[gemini-images] Failed to save sessions to storage:', error);
        }
    }

    /**
     * 延迟保存（防抖）
     */
    private debouncedSave(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.save();
            this.saveTimeout = null;
        }, 1000);
    }

    /**
     * 获取或创建会话
     */
    getOrCreate(sessionId?: string | null): Session {
        if (sessionId && this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId)!;
            session.lastUsedAt = Date.now();
            return session;
        }

        const newSession: Session = {
            id: generateSessionId(),
            messages: [],
            lastImage: null,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
        };
        this.sessions.set(newSession.id, newSession);
        this.logger?.debug(`[gemini-images] Created new session: ${newSession.id}`);
        return newSession;
    }

    /**
     * 检查是否为新会话
     */
    isNewSession(sessionId: string | null | undefined, session: Session): boolean {
        return !sessionId || sessionId !== session.id;
    }

    /**
     * 更新会话状态
     */
    update(session: Session, userContent: string | unknown[], images: ImageResult[]): void {
        // 保存用户消息到历史
        session.messages.push({ role: 'user', content: userContent as Message['content'] });

        // 保存助手响应到历史（包含生成的图片）
        if (images.length > 0) {
            const firstImage = images[0];
            session.lastImage = firstImage;

            // 构建助手消息
            session.messages.push({
                role: 'assistant',
                content: [
                    { type: 'text', text: `[已生成 ${images.length} 张图片]` },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${firstImage.mimeType};base64,${firstImage.base64}`,
                        },
                    },
                ],
            });
        }

        // 截断历史消息，防止请求体过大
        this.truncateHistory(session);

        session.lastUsedAt = Date.now();
        this.logger?.debug(`[gemini-images] Session ${session.id} updated, messages: ${session.messages.length}`);

        // 延迟保存
        this.debouncedSave();
    }

    /**
     * 构建用户消息内容（用于保存到历史）
     */
    buildUserContent(prompt: string, inputImage?: ImageResult | null): string | unknown[] {
        if (inputImage) {
            return [
                { type: 'text', text: prompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${inputImage.mimeType};base64,${inputImage.base64}`,
                    },
                },
            ];
        }
        return prompt;
    }

    /**
     * 截断历史消息，防止请求体过大
     * 保留最近的 N 条消息，确保成对保留（user + assistant）
     */
    private truncateHistory(session: Session): void {
        const maxMessages = this.maxHistoryMessages;
        if (session.messages.length <= maxMessages) {
            return;
        }

        const excess = session.messages.length - maxMessages;
        // 确保删除偶数条消息，保持 user/assistant 配对
        const toRemove = excess % 2 === 0 ? excess : excess + 1;
        
        session.messages.splice(0, toRemove);
        this.logger?.debug(
            `[gemini-images] Session ${session.id} truncated: removed ${toRemove} old messages, kept ${session.messages.length}`
        );
    }

    /**
     * 清理过期会话
     */
    cleanup(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, session] of this.sessions) {
            if (now - session.lastUsedAt > this.sessionTtlMs) {
                this.sessions.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger?.debug(`[gemini-images] Cleaned up ${cleaned} expired sessions`);
            this.debouncedSave();
        }

        return cleaned;
    }

    /**
     * 清除所有会话
     */
    async clearAll(): Promise<void> {
        this.sessions.clear();
        await this.save();
        this.logger?.info('[gemini-images] All sessions cleared');
    }

    /**
     * 获取会话统计
     */
    getStats(): { count: number; ids: string[] } {
        return {
            count: this.sessions.size,
            ids: Array.from(this.sessions.keys()),
        };
    }

    /**
     * 立即保存（用于插件停用时）
     */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.save();
    }
}
