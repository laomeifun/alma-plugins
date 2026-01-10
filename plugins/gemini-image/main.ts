import type { PluginContext, PluginActivation, Message } from 'alma-plugin-api';
import { generateImages, extFromMime, type GeneratedImage } from './lib/gemini-api';

/**
 * Gemini Image Generator Plugin
 *
 * This plugin allows users to generate images from conversation context
 * using Gemini's image generation model via the /image command.
 *
 * Usage:
 *   /image                    - Generate image based on conversation context
 *   /image <prompt>           - Generate image with additional prompt
 *   /image -n 2 <prompt>      - Generate multiple images (1-4)
 */

interface PluginSettings {
    providerId?: string;
    baseUrl: string;
    model: string;
    imageSize: string;
    outputDir: string;
    timeoutMs: number;
    maxContextMessages: number;
    apiKey?: string;
}

/**
 * Parse /image command to extract options and prompt
 */
function parseImageCommand(content: string): {
    isImageCommand: boolean;
    count: number;
    userPrompt: string;
} {
    const trimmed = content.trim();

    // Check if it starts with /image
    if (!trimmed.startsWith('/image')) {
        return { isImageCommand: false, count: 1, userPrompt: '' };
    }

    // Remove /image prefix
    let remaining = trimmed.slice(6).trim();

    // Parse -n option for count
    let count = 1;
    const countMatch = remaining.match(/^-n\s+(\d+)\s*/);
    if (countMatch) {
        count = Math.max(1, Math.min(4, parseInt(countMatch[1], 10)));
        remaining = remaining.slice(countMatch[0].length);
    }

    return {
        isImageCommand: true,
        count,
        userPrompt: remaining.trim(),
    };
}

/**
 * Format date for filename
 */
function formatDateForFilename(date: Date = new Date()): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

/**
 * Generate a unique filename for the image
 */
function generateFilename(index: number, mimeType: string): string {
    const timestamp = formatDateForFilename();
    const ext = extFromMime(mimeType);
    const random = Math.random().toString(36).substring(2, 8);
    return `gemini-${timestamp}-${index + 1}-${random}.${ext}`;
}

/**
 * Build prompt from conversation context and user input
 */
function buildPromptFromContext(
    messages: Message[],
    userPrompt: string,
    maxMessages: number
): string {
    const parts: string[] = [];

    // Add conversation context
    if (messages.length > 0) {
        const recentMessages = messages.slice(-maxMessages);
        const contextParts: string[] = [];

        for (const msg of recentMessages) {
            const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '系统';
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            contextParts.push(`${role}: ${content}`);
        }

        if (contextParts.length > 0) {
            parts.push('以下是对话上下文，请根据这些内容生成相关的图片：\n');
            parts.push(contextParts.join('\n'));
            parts.push('\n');
        }
    }

    // Add user's additional prompt
    if (userPrompt) {
        parts.push(`\n额外要求：${userPrompt}`);
    }

    // If no context and no prompt, provide a default
    if (parts.length === 0) {
        return '请生成一张有创意的图片';
    }

    return parts.join('');
}

/**
 * Convert base64 to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, settings, chat, workspace, ui, storage, providers } = context;

    logger.info('Gemini Image Generator plugin activated!');

    // Storage key for persistent config backup
    const CONFIG_STORAGE_KEY = 'gemini-image-config';

    // Save config to local storage when settings change
    const saveCurrentConfig = async (): Promise<void> => {
        try {
            const config = {
                baseUrl: settings.get<string>('geminiImage.baseUrl', ''),
                model: settings.get<string>('geminiImage.model', ''),
                imageSize: settings.get<string>('geminiImage.imageSize', ''),
                outputDir: settings.get<string>('geminiImage.outputDir', ''),
                timeoutMs: settings.get<number>('geminiImage.timeoutMs', 0),
                maxContextMessages: settings.get<number>('geminiImage.maxContextMessages', 0),
            };
            await storage.local.set(CONFIG_STORAGE_KEY, config);
            logger.debug('配置已备份到本地存储');
        } catch (err) {
            logger.warn(`保存配置失败: ${err}`);
        }
    };

    // Load saved config and apply as defaults if settings are empty
    const initializeConfig = async (): Promise<void> => {
        try {
            const saved = await storage.local.get<Partial<PluginSettings>>(CONFIG_STORAGE_KEY);
            if (saved) {
                // If current settings are default/empty, restore from backup
                if (!settings.get<string>('geminiImage.baseUrl') && saved.baseUrl) {
                    await settings.update('geminiImage.baseUrl', saved.baseUrl);
                }
                if (!settings.get<string>('geminiImage.model') && saved.model) {
                    await settings.update('geminiImage.model', saved.model);
                }
                if (!settings.get<string>('geminiImage.apiKey') && saved.apiKey) {
                    await settings.update('geminiImage.apiKey', saved.apiKey);
                }
                logger.info('已从备份恢复配置');
            }
        } catch (err) {
            logger.warn(`恢复配置失败: ${err}`);
        }
    };

    // Initialize config on startup
    await initializeConfig();

    // Get settings helper
    const getSettings = (): PluginSettings => ({
        providerId: settings.get<string>('geminiImage.providerId', ''),
        baseUrl: settings.get<string>('geminiImage.baseUrl', 'http://127.0.0.1:8317'),
        model: settings.get<string>('geminiImage.model', 'gemini-3-pro-image-preview'),
        imageSize: settings.get<string>('geminiImage.imageSize', '1024x1024'),
        outputDir: settings.get<string>('geminiImage.outputDir', 'generated-images'),
        timeoutMs: settings.get<number>('geminiImage.timeoutMs', 120000),
        maxContextMessages: settings.get<number>('geminiImage.maxContextMessages', 10),
    });

    // Watch for settings changes and save to local storage
    const settingsChangeDisposable = settings.onDidChange(async (event) => {
        if (event.key.startsWith('geminiImage.')) {
            await saveCurrentConfig();
        }
    });

    // Get API key from settings or secrets (secrets survive plugin updates)
    const getApiKey = async (): Promise<string | undefined> => {
        // First try settings
        const settingsKey = settings.get<string>('geminiImage.apiKey', '');
        if (settingsKey && settingsKey.trim()) {
            return settingsKey.trim();
        }
        // Fall back to secrets (persistent)
        return await storage.secrets.get('geminiImage.apiKey');
    };

    // Save images and return markdown paths
    const saveImages = async (
        images: GeneratedImage[],
        outputDir: string
    ): Promise<string[]> => {
        const rootPath = workspace.rootPath;
        if (!rootPath) {
            throw new Error('没有打开的工作区，无法保存图片');
        }

        const fullOutputDir = `${rootPath}/${outputDir}`;
        const savedPaths: string[] = [];

        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const filename = generateFilename(i, image.mimeType);
            const filePath = `${fullOutputDir}/${filename}`;

            try {
                // Convert base64 to Uint8Array and write file
                const bytes = base64ToUint8Array(image.base64);
                await workspace.writeFile(filePath, bytes);
                savedPaths.push(filePath);
                logger.info(`图片已保存: ${filePath}`);
            } catch (err) {
                logger.error(`保存图片失败: ${err}`);
                throw new Error(`保存图片失败: ${err}`);
            }
        }

        return savedPaths;
    };

    // Format paths as markdown
    const formatAsMarkdown = (paths: string[]): string => {
        const lines: string[] = ['## 🎨 生成的图片\n'];

        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            // Use relative path for markdown
            const relativePath = workspace.rootPath
                ? path.replace(workspace.rootPath + '/', '')
                : path;
            lines.push(`### 图片 ${i + 1}`);
            lines.push(`![生成的图片 ${i + 1}](${relativePath})\n`);
            lines.push(`📁 路径: \`${relativePath}\`\n`);
        }

        return lines.join('\n');
    };

    // Register /image command
    const imageCommand = context.commands.register(
        'image',
        async (args?: string) => {
            const config = getSettings();
            const userPrompt = args?.trim() || '';
            
            // Parse -n option for count
            let count = 1;
            let prompt = userPrompt;
            const countMatch = userPrompt.match(/^-n\s+(\d+)\s*/);
            if (countMatch) {
                count = Math.max(1, Math.min(4, parseInt(countMatch[1], 10)));
                prompt = userPrompt.slice(countMatch[0].length).trim();
            }

            try {
                await ui.withProgress(
                    { title: '🎨 正在生成图片...', cancellable: false },
                    async (progress) => {
                        progress.report({ message: '获取对话上下文...' });

                        let finalPrompt = prompt;

                        // If no prompt provided, try to get context from active thread
                        if (!finalPrompt.trim()) {
                            try {
                                const activeThread = await chat.getActiveThread();
                                if (activeThread?.id) {
                                    const messages = await chat.getMessages(activeThread.id);
                                    if (messages.length > 0) {
                                        finalPrompt = buildPromptFromContext(
                                            messages,
                                            '',
                                            config.maxContextMessages
                                        );
                                    }
                                }
                            } catch (err) {
                                logger.warn(`获取对话上下文失败: ${err}`);
                            }
                        }

                        if (!finalPrompt.trim()) {
                            finalPrompt = '请生成一张有创意的图片';
                        }

                        progress.report({ message: '调用 Gemini API...' });

                        const apiKey = await getApiKey();
                        const images = await generateImages({
                            baseUrl: config.baseUrl,
                            apiKey,
                            model: config.model,
                            prompt: finalPrompt,
                            size: config.imageSize,
                            n: count,
                            timeoutMs: config.timeoutMs,
                        });

                        progress.report({ message: '保存图片...' });

                        const savedPaths = await saveImages(images, config.outputDir);
                        const markdown = formatAsMarkdown(savedPaths);
                        
                        ui.showNotification(
                            `✅ 成功生成 ${savedPaths.length} 张图片！`,
                            { type: 'success' }
                        );

                        // Return markdown for display
                        return markdown;
                    }
                );
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                ui.showError(`图片生成失败: ${errorMessage}`);
            }
        }
    );

    // Register /provider command
    const providerCommand = context.commands.register(
        'provider',
        async (args?: string) => {
            // Check if user is selecting a provider by number
            if (args && /^\d+$/.test(args.trim())) {
                const index = parseInt(args.trim(), 10) - 1;
                try {
                    const savedList = await storage.local.get<Array<{ id: string; name: string }>>('gemini-image-provider-list');
                    if (savedList && index >= 0 && index < savedList.length) {
                        const selected = savedList[index];
                        await settings.update('geminiImage.providerId', selected.id);
                        ui.showNotification(`已选择供应商: ${selected.name}`, { type: 'success' });
                        return `✅ 已选择供应商: **${selected.name}** (${selected.id})`;
                    } else {
                        ui.showWarning('无效的编号，请先使用 /provider 查看可用供应商列表');
                        return '❌ 无效的编号';
                    }
                } catch (err) {
                    ui.showError(`选择供应商失败: ${err}`);
                    return `❌ 选择供应商失败: ${err}`;
                }
            }

            // Show provider list
            try {
                const providerList = await providers.list();
                
                if (providerList.length === 0) {
                    return '❌ 没有可用的供应商';
                }

                const enabledProviders = providerList.filter((p: { enabled: boolean }) => p.enabled);
                
                if (enabledProviders.length === 0) {
                    return '❌ 没有已启用的供应商';
                }

                const currentProviderId = settings.get<string>('geminiImage.providerId', '');
                let message = '## 📋 可用的供应商\n\n';
                message += '使用 `/provider <编号>` 来选择：\n\n';
                
                enabledProviders.forEach((p: { id: string; name: string; type: string }, index: number) => {
                    const isCurrent = p.id === currentProviderId;
                    const marker = isCurrent ? ' ✅ (当前)' : '';
                    message += `**${index + 1}.** ${p.name} (${p.id})${marker}\n`;
                });

                message += '\n---\n';
                message += `当前配置：\n`;
                message += `- 供应商: ${currentProviderId || '未选择'}\n`;
                message += `- Base URL: ${settings.get<string>('geminiImage.baseUrl', 'http://127.0.0.1:8317')}\n`;
                message += `- 模型: ${settings.get<string>('geminiImage.model', 'gemini-3-pro-image-preview')}\n`;

                await storage.local.set('gemini-image-provider-list', enabledProviders.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));

                return message;
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                return `❌ 获取供应商列表失败: ${errorMessage}`;
            }
        }
    );

    // Register command to generate image (alias for /image)
    const generateImageCommand = context.commands.register(
        'generate',
        async (args?: string) => {
            // Execute the image command
            return await context.commands.execute('gemini-image.image', args);
        }
    );

    // Register command to set API key
    const setApiKeyCommand = context.commands.register(
        'setApiKey',
        async () => {
            const apiKey = await ui.showInputBox({
                title: '设置 Gemini API Key',
                prompt: '请输入您的 Gemini API Key',
                placeholder: 'sk-...',
                password: true,
            });

            if (apiKey) {
                await storage.secrets.set('geminiImage.apiKey', apiKey);
                ui.showNotification('API Key 已保存', { type: 'success' });
            }
        }
    );

    // Register command to clear API key
    const clearApiKeyCommand = context.commands.register(
        'clearApiKey',
        async () => {
            const confirmed = await ui.showConfirmDialog(
                '确定要清除已保存的 API Key 吗？',
                { type: 'warning' }
            );

            if (confirmed) {
                await storage.secrets.delete('geminiImage.apiKey');
                ui.showNotification('API Key 已清除', { type: 'info' });
            }
        }
    );

    // Register command to select provider (alias for /provider)
    const selectProviderCommand = context.commands.register(
        'selectProvider',
        async (args?: string) => {
            // Execute the provider command
            return await context.commands.execute('gemini-image.provider', args);
        }
    );

    // Register a tool for AI to generate images
    // The AI is responsible for providing a detailed prompt based on conversation context
    const toolDisposable = context.tools.register('generateImage', {
        description: '根据详细描述生成图片。调用此工具时，你必须在 prompt 参数中提供完整、详细的图片描述，包括主题、风格、场景、颜色、细节等。如果用户要求根据对话生成图片，你需要先总结对话内容，然后生成一个详细的图片描述传递给此工具。',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '详细的图片描述。必须包含：1) 主题/主体 2) 风格（如写实、卡通、油画等）3) 场景/背景 4) 颜色和光线 5) 其他细节。描述越详细，生成的图片越准确。',
                },
                count: {
                    type: 'number',
                    description: '要生成的图片数量（1-4），默认为 1',
                    default: 1,
                },
            },
            required: ['prompt'],
        } as const,
        execute: async (params, toolContext) => {
            const { prompt, count = 1 } = params as { prompt: string; count?: number };
            const config = getSettings();

            if (!prompt || !prompt.trim()) {
                return {
                    success: false,
                    error: '请提供图片描述（prompt 参数不能为空）',
                };
            }

            try {
                const apiKey = await getApiKey();

                const images = await generateImages({
                    baseUrl: config.baseUrl,
                    apiKey,
                    model: config.model,
                    prompt: prompt,
                    size: config.imageSize,
                    n: Math.max(1, Math.min(4, count)),
                    timeoutMs: config.timeoutMs,
                });

                const savedPaths = await saveImages(images, config.outputDir);
                const markdown = formatAsMarkdown(savedPaths);

                return {
                    success: true,
                    message: `成功生成 ${savedPaths.length} 张图片`,
                    paths: savedPaths,
                    markdown,
                };
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                return {
                    success: false,
                    error: errorMessage,
                };
            }
        },
    });

    return {
        dispose: () => {
            logger.info('Gemini Image Generator plugin deactivated');
            settingsChangeDisposable.dispose();
            imageCommand.dispose();
            providerCommand.dispose();
            generateImageCommand.dispose();
            selectProviderCommand.dispose();
            setApiKeyCommand.dispose();
            clearApiKeyCommand.dispose();
            toolDisposable.dispose();
        },
    };
}
