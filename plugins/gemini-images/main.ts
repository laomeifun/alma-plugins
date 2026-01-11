/**
 * Gemini Images Plugin
 *
 * AI 图片生成和编辑工具，支持 Gemini 多轮对话 (Nano Banana)
 */
import type { PluginContext, PluginActivation, ToolContext } from 'alma-plugin-api';
import { z } from 'zod';
import { loadConfig, saveApiKey, deleteApiKey, hasApiKey, DEFAULTS } from './lib/config';
import { generateImages, type Message } from './lib/api-client';
import { SessionManager } from './lib/session-manager';
import {
    saveImages,
    formatSaveResultText,
    formatImageOnlyText,
    formatErrorMessage,
} from './lib/image-handler';
import {
    ImageResult,
    resolveOutDir,
    getDefaultPicturesDir,
    parseDataUrl,
    isValidBase64,
    clampInt,
    parseIntOr,
} from './lib/utils';

/**
 * 工具参数 Schema (Zod 格式)
 */
const generateImageSchema = z.object({
    prompt: z.union([z.string(), z.array(z.string())]).describe(
        '图片描述（必填）。详细描述想要生成的图片内容，或描述要对现有图片进行的修改'
    ),
    session_id: z.string().optional().describe(
        '会话 ID（可选）。传入之前返回的 session_id 可继续多轮对话编辑同一张图片'
    ),
    image: z.string().optional().describe(
        '输入图片（可选）。支持 base64 编码或 data:image/... URL。传入后将基于此图片进行编辑'
    ),
    size: z.union([z.string(), z.number()]).optional().describe(
        '图片尺寸。默认 1024x1024。可选：512x512、1024x1792（竖版）、1792x1024（横版）'
    ),
    n: z.union([z.number(), z.string()]).optional().describe(
        '生成数量。默认 1，最多 4'
    ),
    output: z.string().optional().describe(
        "返回格式。默认 'path'（保存文件+返回路径）。设为 'image' 只返回图片数据不保存文件"
    ),
    outDir: z.string().optional().describe(
        '保存目录。支持绝对路径、相对路径或 ~ 开头的用户目录路径'
    ),
});

/**
 * 工具参数类型
 */
interface GenerateImageParams {
    prompt: string | string[];
    session_id?: string;
    sessionId?: string;
    session?: string;
    image?: string;
    input_image?: string;
    inputImage?: string;
    size?: string | number;
    n?: number | string;
    output?: string;
    outDir?: string;
    out_dir?: string;
    outdir?: string;
    output_dir?: string;
}

/**
 * 解析 prompt 参数
 */
function parsePrompt(raw: unknown): string {
    if (Array.isArray(raw)) {
        return raw.map((x) => String(x ?? '')).join(' ').trim();
    }
    return String(raw ?? '').trim();
}

/**
 * 解析 size 参数
 */
function parseSize(raw: unknown, defaultSize: string): string {
    let size = String(raw ?? defaultSize).trim();
    if (/^\d+$/.test(size)) {
        size = `${size}x${size}`;
    }
    return size;
}

/**
 * 解析 output 参数
 */
function parseOutput(raw: unknown): 'path' | 'image' {
    const outputRaw = String(raw ?? 'path').trim().toLowerCase();
    return ['image', 'base64', 'b64', 'data', 'inline'].includes(outputRaw) ? 'image' : 'path';
}

/**
 * 解析输入图片参数
 */
function parseInputImage(
    args: GenerateImageParams,
    isNew: boolean,
    session: { lastImage: ImageResult | null }
): ImageResult | null {
    const imageArg = args.image ?? args.input_image ?? args.inputImage ?? null;

    if (imageArg) {
        const parsed = parseDataUrl(imageArg);
        if (parsed) {
            return { base64: parsed.base64, mimeType: parsed.mimeType };
        }
        if (isValidBase64(imageArg)) {
            return { base64: imageArg, mimeType: 'image/png' };
        }
        return null;
    }

    // 继续会话时，自动使用上一轮生成的图片
    if (!isNew && session.lastImage) {
        return session.lastImage;
    }

    return null;
}

/**
 * 插件激活函数
 */
export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, tools, commands, ui, storage, settings } = context;

    logger.info('Gemini Images plugin activated!');

    // 初始化会话管理器
    const sessionTtlMinutes = settings.get<number>('geminiImages.sessionTtlMinutes', 30);
    const sessionManager = new SessionManager(
        storage.local,
        logger,
        sessionTtlMinutes * 60 * 1000
    );
    await sessionManager.load();

    // 启动会话清理定时器
    const cleanupInterval = setInterval(
        () => sessionManager.cleanup(),
        DEFAULTS.SESSION_CLEANUP_INTERVAL_MS
    );

    // 注册工具
    const toolDisposable = tools.register('generate_image', {
        description: `生成或编辑 AI 图片（支持 Nano Banana 多轮对话）。

使用场景：
- 用户说"画一个..."、"生成一张..."、"创建图片..."
- 需要可视化某个概念或想法
- 制作插图、图标、艺术作品
- 编辑现有图片（修改背景、添加元素、调整风格等）

多轮对话编辑：
- 首次生成图片后会返回 session_id
- 后续调用时传入相同的 session_id 可继续编辑同一张图片
- 例如：先生成一张猫的图片，然后说"把背景改成蓝色"

提示词技巧：prompt 越详细效果越好，建议包含：主体、风格、颜色、构图、光线等`,
        parameters: generateImageSchema,
        execute: async (params: GenerateImageParams, toolContext: ToolContext) => {
            try {
                // 检查 API Key
                if (!(await hasApiKey(context))) {
                    return {
                        success: false,
                        error: '未配置 Gemini API Key。请通过命令 "Configure API Key" 进行配置。',
                    };
                }

                // 加载配置
                const config = await loadConfig(context);

                // 解析 prompt
                const prompt = parsePrompt(params.prompt);
                if (!prompt) {
                    return { success: false, error: '参数 prompt 不能为空' };
                }

                // 解析会话
                const sessionId = params.session_id ?? params.sessionId ?? params.session ?? null;
                const session = sessionManager.getOrCreate(sessionId);
                const isNew = sessionManager.isNewSession(sessionId, session);

                logger.debug(
                    `[gemini-images] ${isNew ? 'New session' : 'Continue session'}: ${session.id}, history: ${session.messages.length}`
                );

                // 解析输入图片
                const inputImage = parseInputImage(params, isNew, session);

                // 解析其他参数
                const size = parseSize(params.size, config.defaultSize);
                const n = clampInt(parseIntOr(params.n, 1), 1, 4);
                const output = parseOutput(params.output);
                let outDir = resolveOutDir(
                    params.outDir ?? params.out_dir ?? params.outdir ?? params.output_dir ?? config.defaultOutDir
                );

                // 如果未指定 outDir，使用默认图片目录
                if (output === 'path' && !outDir) {
                    outDir = getDefaultPicturesDir();
                }

                // 调用 API 生成图片
                const images = await generateImages({
                    config,
                    prompt,
                    size,
                    n,
                    historyMessages: session.messages as Message[],
                    inputImage,
                    logger,
                });

                // 更新会话状态
                const userContent = sessionManager.buildUserContent(prompt, inputImage);
                sessionManager.update(session, userContent, images);

                // 构建返回结果
                if (output === 'image') {
                    return {
                        success: true,
                        session_id: session.id,
                        message: formatImageOnlyText(session.id),
                        images: images.map((img) => ({
                            mimeType: img.mimeType,
                            data: img.base64,
                        })),
                    };
                }

                // 保存图片并返回
                const saveResult = await saveImages(images, outDir, logger);
                const text = formatSaveResultText(saveResult, session.id);

                return {
                    success: true,
                    session_id: session.id,
                    message: text,
                    saved_files: saveResult.saved,
                    images: images.map((img) => ({
                        mimeType: img.mimeType,
                        data: img.base64,
                    })),
                };
            } catch (err) {
                logger.error('[gemini-images] Generation failed:', err);
                return {
                    success: false,
                    error: formatErrorMessage(err),
                };
            }
        },
    });

    // 注册配置命令
    const configureCommand = commands.register('configure', async () => {
        const currentHasKey = await hasApiKey(context);
        const currentStatus = currentHasKey ? '（已配置）' : '（未配置）';

        const apiKey = await ui.showInputBox({
            title: 'Gemini API Key',
            prompt: `请输入您的 Gemini API Key ${currentStatus}`,
            placeholder: 'AIza...',
            password: true,
        });

        if (apiKey !== undefined) {
            if (apiKey.trim()) {
                await saveApiKey(context, apiKey.trim());
                ui.showNotification('API Key 已保存', { type: 'success' });
                logger.info('[gemini-images] API Key configured');
            } else if (currentHasKey) {
                const confirmed = await ui.showConfirmDialog('确定要删除已保存的 API Key 吗？', {
                    type: 'warning',
                    confirmLabel: '删除',
                });
                if (confirmed) {
                    await deleteApiKey(context);
                    ui.showNotification('API Key 已删除', { type: 'info' });
                    logger.info('[gemini-images] API Key deleted');
                }
            }
        }
    });

    // 注册清除会话命令
    const clearSessionsCommand = commands.register('clearSessions', async () => {
        const stats = sessionManager.getStats();
        if (stats.count === 0) {
            ui.showNotification('没有活动的会话', { type: 'info' });
            return;
        }

        const confirmed = await ui.showConfirmDialog(
            `确定要清除所有 ${stats.count} 个会话吗？`,
            {
                type: 'warning',
                confirmLabel: '清除',
            }
        );

        if (confirmed) {
            await sessionManager.clearAll();
            ui.showNotification('所有会话已清除', { type: 'success' });
        }
    });

    // 监听设置变化
    const settingsDisposable = settings.onDidChange((event) => {
        if (event.key === 'geminiImages.sessionTtlMinutes') {
            logger.debug('[gemini-images] Session TTL setting changed');
        }
    });

    return {
        dispose: () => {
            logger.info('Gemini Images plugin deactivated');

            // 清理定时器
            clearInterval(cleanupInterval);

            // 保存会话
            sessionManager.flush();

            // 释放资源
            toolDisposable.dispose();
            configureCommand.dispose();
            clearSessionsCommand.dispose();
            settingsDisposable.dispose();
        },
    };
}
