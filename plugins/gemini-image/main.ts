import type { PluginContext, PluginActivation } from 'alma-plugin-api';
import { generateImages, extFromMime, type GeneratedImage } from './lib/gemini-api';

/**
 * Gemini Image Generator Plugin
 *
 * Registers a `generate_image` tool for AI to generate images using
 * OpenAI-compatible image generation APIs (like Gemini).
 *
 * Configuration:
 *   - baseUrl: API endpoint (default: http://127.0.0.1:8317)
 *   - apiKey: API key (stored in secrets)
 *   - model: Model name (default: gemini-2.0-flash-preview-image-generation)
 *   - imageSize: Default image size (default: 1024x1024)
 *   - outputDir: Directory to save images (default: generated-images)
 *   - timeoutMs: Request timeout in ms (default: 120000)
 *   - mode: API mode - auto/images/chat (default: auto)
 */

// ============================================================================
// Types
// ============================================================================

interface PluginSettings {
    baseUrl: string;
    model: string;
    imageSize: string;
    outputDir: string;
    timeoutMs: number;
    mode: 'auto' | 'images' | 'chat';
}

// ============================================================================
// Utilities
// ============================================================================

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
    return `image-${timestamp}-${index + 1}-${random}.${ext}`;
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

/**
 * Normalize size input (e.g., 1024 -> "1024x1024")
 */
function normalizeSize(size: string | number | undefined, defaultSize: string): string {
    if (size === undefined || size === null) return defaultSize;
    const s = String(size).trim();
    if (/^\d+$/.test(s)) return `${s}x${s}`;
    return s || defaultSize;
}

// ============================================================================
// Plugin Activation
// ============================================================================

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, settings, workspace, ui, storage, tools, commands } = context;

    logger.info('Gemini Image Generator plugin activated');

    // ========================================================================
    // Settings
    // ========================================================================

    const getSettings = (): PluginSettings => ({
        baseUrl: settings.get<string>('geminiImage.baseUrl', 'http://127.0.0.1:8317'),
        model: settings.get<string>('geminiImage.model', 'gemini-3-pro-image-preview'),
        imageSize: settings.get<string>('geminiImage.imageSize', '1024x1024'),
        outputDir: settings.get<string>('geminiImage.outputDir', 'generated-images'),
        timeoutMs: settings.get<number>('geminiImage.timeoutMs', 120000),
        mode: settings.get<'auto' | 'images' | 'chat'>('geminiImage.mode', 'auto'),
    });

    const getApiKey = async (): Promise<string | undefined> => {
        // Try settings first
        const settingsKey = settings.get<string>('geminiImage.apiKey', '');
        if (settingsKey?.trim()) return settingsKey.trim();
        // Fall back to secrets
        return await storage.secrets.get('geminiImage.apiKey');
    };

    // ========================================================================
    // Image Saving
    // ========================================================================

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

    const formatAsMarkdown = (paths: string[]): string => {
        const lines: string[] = [];

        for (let i = 0; i < paths.length; i++) {
            const filePath = paths[i];
            const relativePath = workspace.rootPath
                ? filePath.replace(workspace.rootPath + '/', '')
                : filePath;
            
            // Use file:// URI for markdown rendering
            const displayPath = filePath.replace(/\\/g, '/');
            const fileUri = `file:///${displayPath.replace(/^\//, '')}`;
            
            lines.push(`![image-${i + 1}](${fileUri})`);
            lines.push(`📁 ${relativePath}`);
            lines.push('');
        }

        return lines.join('\n');
    };

    // ========================================================================
    // Commands
    // ========================================================================

    // Set API Key command
    const setApiKeyCommand = commands.register(
        'setApiKey',
        async () => {
            const apiKey = await ui.showInputBox({
                title: '设置 API Key',
                prompt: '请输入您的 API Key',
                placeholder: 'sk-... 或 AIza...',
                password: true,
            });

            if (apiKey) {
                await storage.secrets.set('geminiImage.apiKey', apiKey);
                ui.showNotification('API Key 已保存', { type: 'success' });
            }
        }
    );

    // Clear API Key command
    const clearApiKeyCommand = commands.register(
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

    // ========================================================================
    // Tool Registration
    // ========================================================================

    const toolDisposable = tools.register('generate_image', {
        description: `生成 AI 图片。当用户需要创建、绘制、生成图片/图像/插图/照片时使用此工具。

使用场景：
- 用户说"画一个..."、"生成一张..."、"创建图片..."
- 需要可视化某个概念或想法
- 制作插图、图标、艺术作品

返回说明：
- 图片会保存到工作区目录，并返回文件路径
- 你可以使用 Markdown 语法渲染图片：![image](file:///path/to/image.png)

提示词技巧：prompt 越详细效果越好，建议包含：主体、风格、颜色、构图、光线等`,

        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '图片描述（必填）。详细描述想要生成的图片内容，如："一只橙色的猫咪坐在窗台上，阳光透过窗户照进来，水彩画风格"',
                },
                size: {
                    type: 'string',
                    description: '图片尺寸。默认 1024x1024。可选：512x512、1024x1024、1024x1792（竖版）、1792x1024（横版）',
                },
                n: {
                    type: 'number',
                    description: '生成数量。默认 1，最多 4',
                },
                outDir: {
                    type: 'string',
                    description: '保存目录（相对于工作区）。默认使用插件设置的目录',
                },
            },
            required: ['prompt'],
        },

        execute: async (params: { prompt: string; size?: string; n?: number; outDir?: string }, _toolContext) => {
            const config = getSettings();

            // Parse prompt
            const prompt = String(params.prompt ?? '').trim();

            if (!prompt) {
                return {
                    success: false,
                    error: '参数 prompt 不能为空',
                };
            }

            // Parse size
            const size = normalizeSize(params.size, config.imageSize);

            // Parse count
            const n = Math.max(1, Math.min(4, params.n ?? 1));

            // Parse output directory
            const outDir = params.outDir?.trim() || config.outputDir;

            try {
                const apiKey = await getApiKey();

                const images = await generateImages({
                    baseUrl: config.baseUrl,
                    apiKey,
                    model: config.model,
                    prompt,
                    size,
                    n,
                    timeoutMs: config.timeoutMs,
                    mode: config.mode,
                });

                const savedPaths = await saveImages(images, outDir);
                const markdown = formatAsMarkdown(savedPaths);

                return {
                    success: true,
                    message: `✅ 成功生成 ${savedPaths.length} 张图片`,
                    paths: savedPaths,
                    markdown,
                };
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                
                // Provide helpful suggestions
                let suggestion = '';
                if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
                    suggestion = '\n💡 建议：检查 baseUrl 是否正确，服务是否已启动';
                } else if (errorMessage.includes('401') || errorMessage.includes('API Key')) {
                    suggestion = '\n💡 建议：使用 gemini-image.setApiKey 命令设置 API Key';
                } else if (errorMessage.includes('超时')) {
                    suggestion = '\n💡 建议：增加 geminiImage.timeoutMs 设置';
                }

                return {
                    success: false,
                    error: `${errorMessage}${suggestion}`,
                };
            }
        },
    });

    // ========================================================================
    // Cleanup
    // ========================================================================

    return {
        dispose: () => {
            logger.info('Gemini Image Generator plugin deactivated');
            setApiKeyCommand.dispose();
            clearApiKeyCommand.dispose();
            toolDisposable.dispose();
        },
    };
}
