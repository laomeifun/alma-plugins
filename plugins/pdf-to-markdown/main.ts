/**
 * PDF to Markdown Plugin
 * 
 * Automatically converts PDF files to Markdown using MinerU API
 * and injects the content into chat context.
 * 
 * Features:
 * - Detects PDF references in chat messages (URLs and local files)
 * - Converts PDFs to Markdown using MinerU API
 * - Caches conversions to avoid redundant API calls
 * - Injects converted content into chat context
 */

import type { PluginContext, PluginActivation, Disposable, HookInput, HookOutput, ProgressReport } from 'alma-plugin-api';
import { MineruClient } from './lib/mineru-client';
import { ConversionCache } from './lib/cache';
import { detectPdfReferences, getFilename, generateHash } from './lib/pdf-detector';
import type { PdfToMarkdownSettings, ConversionResult, PdfReference } from './lib/types';

// ============================================================================
// Constants
// ============================================================================

const API_KEY_SECRET = 'mineru-api-key';

// ============================================================================
// Plugin Activation
// ============================================================================

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, settings, commands, ui, storage, workspace, tools } = context;
    const disposables: Disposable[] = [];

    logger.info('PDF to Markdown plugin activated!');

    // Initialize cache
    const cache = new ConversionCache(storage.local);

    // Initialize MinerU client (API key will be set later)
    let mineruClient: MineruClient | null = null;

    // ========================================================================
    // Helper Functions
    // ========================================================================

    /**
     * Get current plugin settings
     */
    const getSettings = (): PdfToMarkdownSettings => ({
        enabled: settings.get<boolean>('pdf-to-markdown.enabled', true),
        modelVersion: settings.get<'vlm' | 'pipeline'>('pdf-to-markdown.modelVersion', 'vlm'),
        enableFormula: settings.get<boolean>('pdf-to-markdown.enableFormula', true),
        enableTable: settings.get<boolean>('pdf-to-markdown.enableTable', true),
        language: settings.get<string>('pdf-to-markdown.language', 'ch'),
        cacheEnabled: settings.get<boolean>('pdf-to-markdown.cacheEnabled', true),
        maxFileSizeMB: settings.get<number>('pdf-to-markdown.maxFileSizeMB', 50),
    });

    /**
     * Get or prompt for API key
     */
    const getApiKey = async (): Promise<string | undefined> => {
        let apiKey = await storage.secrets.get(API_KEY_SECRET);

        if (!apiKey) {
            apiKey = await ui.showInputBox({
                title: 'MinerU API Key',
                prompt: 'Enter your MinerU API key (from https://mineru.net)',
                password: true,
            });

            if (apiKey) {
                await storage.secrets.set(API_KEY_SECRET, apiKey);
                logger.info('API key saved');
            }
        }

        return apiKey;
    };

    /**
     * Ensure MinerU client is initialized
     */
    const ensureClient = async (): Promise<MineruClient | null> => {
        if (mineruClient) {
            return mineruClient;
        }

        const apiKey = await getApiKey();
        if (!apiKey) {
            logger.warn('No API key configured');
            return null;
        }

        mineruClient = new MineruClient(apiKey, logger);
        return mineruClient;
    };

    /**
     * Convert a single PDF reference to Markdown
     */
    const convertPdf = async (
        ref: PdfReference,
        config: PdfToMarkdownSettings
    ): Promise<ConversionResult> => {
        const client = await ensureClient();
        if (!client) {
            return { success: false, error: 'No API key configured' };
        }

        // Generate cache key
        let cacheKey: string;
        let fileContent: Uint8Array | undefined;

        // Check if file content is already available (from attachment)
        if (ref.fileContent) {
            fileContent = ref.fileContent;
            cacheKey = await generateHash(fileContent);
            
            // Check file size
            const sizeMB = fileContent.length / (1024 * 1024);
            if (sizeMB > config.maxFileSizeMB) {
                return {
                    success: false,
                    error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${config.maxFileSizeMB}MB)`,
                };
            }
        } else if (ref.isUrl) {
            cacheKey = await generateHash(ref.path);
        } else {
            // Local file - check if workspace is available
            if (!workspace || !workspace.readFile) {
                return {
                    success: false,
                    error: 'Local file access requires workspace. Please use URL instead.',
                };
            }
            
            // Read local file
            try {
                fileContent = await workspace.readFile(ref.path);
                cacheKey = await generateHash(fileContent!);

                // Check file size
                const sizeMB = fileContent!.length / (1024 * 1024);
                if (sizeMB > config.maxFileSizeMB) {
                    return {
                        success: false,
                        error: `File too large: ${sizeMB.toFixed(1)}MB (max: ${config.maxFileSizeMB}MB)`,
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }

        // Check cache
        if (config.cacheEnabled) {
            const cached = await cache.get(cacheKey);
            if (cached) {
                logger.debug(`Cache hit for: ${ref.path}`);
                return {
                    success: true,
                    markdown: cached.markdown,
                    fromCache: true,
                };
            }
        }

        // Convert PDF
        logger.info(`Converting PDF: ${ref.path}`);

        const conversionOptions = {
            modelVersion: config.modelVersion,
            enableFormula: config.enableFormula,
            enableTable: config.enableTable,
            language: config.language,
        };

        let result: ConversionResult;

        if (ref.isUrl) {
            result = await client.convertUrlToMarkdown(ref.path, conversionOptions);
        } else if (fileContent) {
            const filename = getFilename(ref.path);
            result = await client.convertFileToMarkdown(fileContent, filename, conversionOptions);
        } else {
            return { success: false, error: 'No file content available' };
        }

        // Cache successful conversion
        if (result.success && result.markdown && config.cacheEnabled) {
            await cache.set(cacheKey, ref.path, result.markdown);
            logger.debug(`Cached conversion for: ${ref.path}`);
        }

        return result;
    };

    /**
     * Process all PDF references in a message
     */
    const processPdfReferences = async (
        content: string,
        config: PdfToMarkdownSettings
    ): Promise<{ enhancedContent: string; convertedCount: number; errors: string[] }> => {
        // Detect PDF references from message text
        const refs = detectPdfReferences(content);

        if (refs.length === 0) {
            return { enhancedContent: content, convertedCount: 0, errors: [] };
        }

        const attachmentCount = refs.filter((r: PdfReference) => r.isAttachment).length;
        const textRefCount = refs.length - attachmentCount;
        logger.info(`Found ${refs.length} PDF reference(s): ${attachmentCount} attachment-style, ${textRefCount} path-style`);

        const results: { ref: PdfReference; result: ConversionResult }[] = [];
        const errors: string[] = [];

        // Convert all PDFs (sequentially to avoid rate limiting)
        for (const ref of refs) {
            const result = await convertPdf(ref, config);
            results.push({ ref, result });

            if (!result.success) {
                errors.push(`${getFilename(ref.path)}: ${result.error}`);
            }
        }

        // Build enhanced content
        const successfulConversions = results.filter(r => r.result.success && r.result.markdown);

        if (successfulConversions.length === 0) {
            return { enhancedContent: content, convertedCount: 0, errors };
        }

        const pdfContents = successfulConversions.map(({ ref, result }) => {
            const filename = getFilename(ref.path);
            const cacheNote = result.fromCache ? ' (cached)' : '';
            return `### 📄 ${filename}${cacheNote}\n\n${result.markdown}`;
        });

        const enhancedContent = `${content}

---

## 📚 PDF 内容（已转换为 Markdown）

${pdfContents.join('\n\n---\n\n')}
`;

        return {
            enhancedContent,
            convertedCount: successfulConversions.length,
            errors,
        };
    };

    // ========================================================================
    // Event Handlers
    // ========================================================================

    // Subscribe to message will send event
    const messageHandler = events.on(
        'chat.message.willSend',
        async (
            input: HookInput<'chat.message.willSend'>,
            output: HookOutput<'chat.message.willSend'>
        ) => {
            const config = getSettings();

            if (!config.enabled) {
                logger.debug('PDF conversion disabled, skipping');
                return;
            }

            try {
                const { enhancedContent, convertedCount, errors } = await processPdfReferences(
                    input.content,
                    config
                );

                if (convertedCount > 0) {
                    output.content = enhancedContent;
                    logger.info(`Injected ${convertedCount} PDF(s) as Markdown`);

                    if (errors.length > 0) {
                        ui.showWarning(`Some PDFs failed to convert: ${errors.join(', ')}`);
                    }
                }
            } catch (error) {
                logger.error('Error processing PDFs:', error);
                ui.showError(`PDF conversion error: ${error instanceof Error ? error.message : String(error)}`);
            }
        },
        { priority: 100 } // High priority to process before other plugins
    );
    disposables.push(messageHandler);

    // ========================================================================
    // Commands
    // ========================================================================

    // Manual conversion command
    const convertCommand = commands.register('convert', async () => {
        const pdfPath = await ui.showInputBox({
            title: 'Convert PDF to Markdown',
            prompt: 'Enter PDF URL or file path',
            placeholder: 'https://example.com/document.pdf or C:\\path\\to\\file.pdf',
        });

        if (!pdfPath) {
            return;
        }

        const config = getSettings();
        const isUrl = pdfPath.startsWith('http://') || pdfPath.startsWith('https://');

        const ref: PdfReference = {
            originalText: pdfPath,
            path: pdfPath,
            isUrl,
            startIndex: 0,
            endIndex: pdfPath.length,
        };

        await ui.withProgress(
            { title: 'Converting PDF...', cancellable: false },
            async (progress: { report: (value: ProgressReport) => void }) => {
                progress.report({ message: 'Starting conversion...' });

                const result = await convertPdf(ref, config);

                if (result.success) {
                    ui.showNotification(`PDF converted successfully!${result.fromCache ? ' (from cache)' : ''}`, {
                        type: 'success',
                    });
                    logger.info(`Conversion result:\n${result.markdown?.substring(0, 500)}...`);
                } else {
                    ui.showError(`Conversion failed: ${result.error}`);
                }
            }
        );
    });
    disposables.push(convertCommand);

    // Toggle command
    const toggleCommand = commands.register('toggle', async () => {
        const current = settings.get<boolean>('pdf-to-markdown.enabled', true);
        await settings.update('pdf-to-markdown.enabled', !current);

        const status = !current ? 'enabled' : 'disabled';
        ui.showNotification(`PDF auto-conversion ${status}`, { type: 'info' });
    });
    disposables.push(toggleCommand);

    // Clear cache command
    const clearCacheCommand = commands.register('clearCache', async () => {
        const confirmed = await ui.showConfirmDialog(
            'Are you sure you want to clear the PDF conversion cache?',
            { type: 'warning' }
        );

        if (confirmed) {
            await cache.clear();
            ui.showNotification('PDF cache cleared', { type: 'success' });
        }
    });
    disposables.push(clearCacheCommand);

    // Set API key command
    const setApiKeyCommand = commands.register('setApiKey', async () => {
        const apiKey = await ui.showInputBox({
            title: 'Set MinerU API Key',
            prompt: 'Enter your MinerU API key',
            password: true,
        });

        if (apiKey) {
            await storage.secrets.set(API_KEY_SECRET, apiKey);
            mineruClient = new MineruClient(apiKey, logger);
            ui.showNotification('API key saved', { type: 'success' });
        }
    });
    disposables.push(setApiKeyCommand);

    // ========================================================================
    // Cleanup
    // ========================================================================

    return {
        dispose: () => {
            logger.info('PDF to Markdown plugin deactivated');
            for (const disposable of disposables) {
                disposable.dispose();
            }
        },
    };
}
