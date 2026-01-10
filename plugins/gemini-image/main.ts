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
    baseUrl: string;
    model: string;
    imageSize: string;
    outputDir: string;
    timeoutMs: number;
    maxContextMessages: number;
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
    const { logger, events, settings, chat, workspace, ui, storage } = context;

    logger.info('Gemini Image Generator plugin activated!');

    // Get settings helper
    const getSettings = (): PluginSettings => ({
        baseUrl: settings.get<string>('geminiImage.baseUrl', 'http://127.0.0.1:8317'),
        model: settings.get<string>('geminiImage.model', 'gemini-3-pro-image-preview'),
        imageSize: settings.get<string>('geminiImage.imageSize', '1024x1024'),
        outputDir: settings.get<string>('geminiImage.outputDir', 'generated-images'),
        timeoutMs: settings.get<number>('geminiImage.timeoutMs', 120000),
        maxContextMessages: settings.get<number>('geminiImage.maxContextMessages', 10),
    });

    // Get API key from settings or secrets
    const getApiKey = async (): Promise<string | undefined> => {
        // First try settings
        const settingsKey = settings.get<string>('geminiImage.apiKey', '');
        if (settingsKey && settingsKey.trim()) {
            return settingsKey.trim();
        }
        // Fall back to secrets
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

    // Main hook to intercept /image commands
    // Transform the command into a detailed request for AI to generate image description
    const eventDisposable = events.on(
        'chat.message.willSend',
        (input, output) => {
            const { content } = input;
            const parsed = parseImageCommand(content);

            if (!parsed.isImageCommand) {
                return; // Not an image command, let it pass through
            }

            // Transform /image command - ask AI to summarize context and generate image
            let transformedContent = `请使用 generateImage 工具生成图片。

**重要**：在调用工具时，你需要在 prompt 参数中提供详细的图片描述。`;
            
            if (parsed.userPrompt) {
                transformedContent += `

用户指定的图片内容：${parsed.userPrompt}

请结合我们之前的对话上下文，生成一个详细的图片描述（包括风格、场景、细节等），然后调用 generateImage 工具。`;
            } else {
                transformedContent += `

请仔细回顾我们之前的对话内容，总结出一个适合生成图片的详细描述（包括主题、风格、场景、颜色、细节等），然后调用 generateImage 工具生成相关图片。`;
            }
            
            if (parsed.count > 1) {
                transformedContent += `

请生成 ${parsed.count} 张图片（设置 count 参数为 ${parsed.count}）。`;
            }

            output.content = transformedContent;
            logger.info(`Transformed /image command`);
        },
        { priority: 100 }
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
            eventDisposable.dispose();
            setApiKeyCommand.dispose();
            clearApiKeyCommand.dispose();
            toolDisposable.dispose();
        },
    };
}
