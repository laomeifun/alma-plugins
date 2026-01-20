/**
 * MinerU API Client
 * 
 * Client for interacting with the MinerU PDF extraction API.
 * API Documentation: https://mineru.net/apiManage/docs
 */

import type {
    CreateTaskRequest,
    CreateTaskData,
    TaskQueryData,
    ApiResponse,
    BatchUploadData,
    ConversionResult,
    ModelVersion,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const MINERU_API_BASE = 'https://mineru.net/api/v4';
const POLL_INTERVAL_MS = 3000; // 3 seconds
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes max wait time

// ============================================================================
// MinerU API Client
// ============================================================================

export class MineruClient {
    private apiKey: string;
    private logger: { info: Function; warn: Function; error: Function; debug: Function };

    constructor(apiKey: string, logger?: any) {
        this.apiKey = apiKey;
        this.logger = logger || console;
    }

    /**
     * Update the API key
     */
    setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
    }

    /**
     * Get common headers for API requests
     */
    private getHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': '*/*',
        };
    }

    /**
     * Create a PDF extraction task from URL
     * 
     * Note: enable_formula, enable_table, language only work with 'pipeline' model
     */
    async createTaskFromUrl(
        url: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            language?: string;
            pageRanges?: string;
            dataId?: string;
        }
    ): Promise<string> {
        const modelVersion = options?.modelVersion ?? 'vlm';
        
        // Build request - only include pipeline-specific options for pipeline model
        const request: CreateTaskRequest = {
            url,
            model_version: modelVersion,
        };

        // These options only work with pipeline model
        if (modelVersion === 'pipeline') {
            if (options?.enableFormula !== undefined) {
                request.enable_formula = options.enableFormula;
            }
            if (options?.enableTable !== undefined) {
                request.enable_table = options.enableTable;
            }
            if (options?.language) {
                request.language = options.language;
            }
        }

        if (options?.pageRanges) {
            request.page_ranges = options.pageRanges;
        }
        if (options?.dataId) {
            request.data_id = options.dataId;
        }

        this.logger.debug(`Creating task for URL: ${url}, model: ${modelVersion}`);
        this.logger.debug(`Request body: ${JSON.stringify(request)}`);

        const response = await fetch(`${MINERU_API_BASE}/extract/task`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request),
        });

        const responseText = await response.text();
        this.logger.debug(`Response status: ${response.status}`);
        this.logger.debug(`Response body: ${responseText}`);

        if (!response.ok) {
            // Try to parse error details
            try {
                const errorJson = JSON.parse(responseText);
                throw new Error(`API error (${errorJson.code}): ${errorJson.msg || responseText}`);
            } catch (e) {
                throw new Error(`Failed to create task: ${response.status} - ${responseText}`);
            }
        }

        let result: ApiResponse<CreateTaskData>;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Invalid JSON response: ${responseText}`);
        }

        if (result.code !== 0) {
            // Provide more helpful error messages based on error code
            const errorMessages: Record<number, string> = {
                [-500]: 'Invalid parameters - check request format',
                [-60002]: 'Invalid file format - ensure URL points to a valid PDF',
                [-60008]: 'URL timeout - the URL may be inaccessible from China (GitHub, AWS, etc.)',
                [-60018]: 'Daily limit reached - try again tomorrow',
            };
            const helpMessage = errorMessages[result.code] || '';
            throw new Error(`API error (${result.code}): ${result.msg}${helpMessage ? ` - ${helpMessage}` : ''}`);
        }

        if (!result.data?.task_id) {
            throw new Error('No task_id in response');
        }

        this.logger.info(`Task created: ${result.data.task_id}`);
        return result.data.task_id;
    }

    /**
     * Upload a local file and create extraction task using batch upload API
     */
    async uploadAndCreateTask(
        fileContent: Uint8Array,
        filename: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            language?: string;
            pageRanges?: string;
            dataId?: string;
        }
    ): Promise<string> {
        const modelVersion = options?.modelVersion ?? 'vlm';

        // Step 1: Request upload URL
        this.logger.debug(`Requesting upload URL for: ${filename}`);

        const batchRequest: any = {
            files: [
                {
                    name: filename,
                    data_id: options?.dataId || `upload-${Date.now()}`,
                }
            ],
            model_version: modelVersion,
        };

        // Add pipeline-specific options
        if (modelVersion === 'pipeline') {
            if (options?.enableFormula !== undefined) {
                batchRequest.enable_formula = options.enableFormula;
            }
            if (options?.enableTable !== undefined) {
                batchRequest.enable_table = options.enableTable;
            }
            if (options?.language) {
                batchRequest.language = options.language;
            }
        }

        const batchResponse = await fetch(`${MINERU_API_BASE}/file-urls/batch`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(batchRequest),
        });

        if (!batchResponse.ok) {
            const errorText = await batchResponse.text();
            throw new Error(`Failed to get upload URL: ${batchResponse.status} - ${errorText}`);
        }

        const batchResult: ApiResponse<BatchUploadData> = await batchResponse.json();

        if (batchResult.code !== 0) {
            throw new Error(`Batch API error: ${batchResult.msg}`);
        }

        if (!batchResult.data?.file_urls?.[0]) {
            throw new Error('No upload URL in response');
        }

        const uploadUrl = batchResult.data.file_urls[0];
        const batchId = batchResult.data.batch_id;

        this.logger.debug(`Got upload URL, batch_id: ${batchId}`);

        // Step 2: Upload file using PUT
        const arrayBuffer = fileContent.buffer.slice(
            fileContent.byteOffset,
            fileContent.byteOffset + fileContent.byteLength
        ) as ArrayBuffer;

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: arrayBuffer,
        });

        if (!uploadResponse.ok) {
            throw new Error(`Failed to upload file: ${uploadResponse.status}`);
        }

        this.logger.info(`File uploaded successfully, batch_id: ${batchId}`);

        // Return batch_id - the system will auto-submit the task
        return `batch:${batchId}`;
    }

    /**
     * Query task status
     */
    async queryTask(taskId: string): Promise<TaskQueryData> {
        // Handle batch tasks
        if (taskId.startsWith('batch:')) {
            return this.queryBatchTask(taskId.slice(6));
        }

        const response = await fetch(`${MINERU_API_BASE}/extract/task/${taskId}`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to query task: ${response.status} - ${errorText}`);
        }

        const result: ApiResponse<TaskQueryData> = await response.json();

        if (result.code !== 0) {
            throw new Error(`Query API error: ${result.msg}`);
        }

        if (!result.data) {
            throw new Error('No data in query response');
        }

        return result.data;
    }

    /**
     * Query batch task status
     */
    private async queryBatchTask(batchId: string): Promise<TaskQueryData> {
        const response = await fetch(`${MINERU_API_BASE}/extract-results/batch/${batchId}`, {
            method: 'GET',
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to query batch: ${response.status} - ${errorText}`);
        }

        const result: ApiResponse<{
            batch_id: string;
            extract_result: Array<{
                file_name: string;
                state: string;
                full_zip_url?: string;
                err_msg?: string;
                extract_progress?: {
                    extracted_pages: number;
                    total_pages: number;
                    start_time: string;
                };
            }>;
        }> = await response.json();

        if (result.code !== 0) {
            throw new Error(`Batch query API error: ${result.msg}`);
        }

        // Get first result
        const firstResult = result.data?.extract_result?.[0];
        if (!firstResult) {
            return {
                task_id: batchId,
                state: 'pending',
            };
        }

        return {
            task_id: batchId,
            state: firstResult.state as any,
            full_zip_url: firstResult.full_zip_url,
            err_msg: firstResult.err_msg,
            extract_progress: firstResult.extract_progress,
        };
    }

    /**
     * Wait for task completion and return result
     */
    async waitForCompletion(
        taskId: string,
        onProgress?: (state: string, progress?: { extracted: number; total: number }) => void
    ): Promise<TaskQueryData> {
        let attempts = 0;

        while (attempts < MAX_POLL_ATTEMPTS) {
            const status = await this.queryTask(taskId);

            if (onProgress && status.extract_progress) {
                onProgress(status.state, {
                    extracted: status.extract_progress.extracted_pages,
                    total: status.extract_progress.total_pages,
                });
            } else if (onProgress) {
                onProgress(status.state);
            }

            if (status.state === 'done') {
                this.logger.info(`Task ${taskId} completed`);
                return status;
            }

            if (status.state === 'failed') {
                throw new Error(`Task failed: ${status.err_msg || 'Unknown error'}`);
            }

            this.logger.debug(`Task ${taskId} state: ${status.state}`);
            await this.sleep(POLL_INTERVAL_MS);
            attempts++;
        }

        throw new Error('Task timed out');
    }

    /**
     * Download and extract markdown from ZIP result
     */
    async downloadMarkdown(zipUrl: string): Promise<string> {
        this.logger.debug(`Downloading result from: ${zipUrl}`);

        // The ZIP contains markdown files - we need to fetch and extract
        // For now, we'll try to get the markdown directly
        // MinerU returns a ZIP with structure: auto/{filename}.md
        
        const response = await fetch(zipUrl);

        if (!response.ok) {
            throw new Error(`Failed to download result: ${response.status}`);
        }

        // Get the ZIP content
        const zipBuffer = await response.arrayBuffer();
        
        // Simple ZIP extraction for markdown file
        // ZIP files have a specific structure - we look for .md files
        const markdown = await this.extractMarkdownFromZip(new Uint8Array(zipBuffer));
        
        return markdown;
    }

    /**
     * Extract markdown content from ZIP buffer
     * Simple implementation that looks for .md files in the ZIP
     */
    private async extractMarkdownFromZip(zipData: Uint8Array): Promise<string> {
        // ZIP file structure:
        // Local file header signature: 0x04034b50 (PK\x03\x04)
        // We'll look for .md files and extract their content
        
        const decoder = new TextDecoder('utf-8');
        const markdownContents: string[] = [];
        
        let offset = 0;
        while (offset < zipData.length - 4) {
            // Check for local file header signature
            if (zipData[offset] === 0x50 && zipData[offset + 1] === 0x4b &&
                zipData[offset + 2] === 0x03 && zipData[offset + 3] === 0x04) {
                
                // Parse local file header
                const compressionMethod = zipData[offset + 8] | (zipData[offset + 9] << 8);
                const compressedSize = zipData[offset + 18] | (zipData[offset + 19] << 8) |
                                       (zipData[offset + 20] << 16) | (zipData[offset + 21] << 24);
                const uncompressedSize = zipData[offset + 22] | (zipData[offset + 23] << 8) |
                                         (zipData[offset + 24] << 16) | (zipData[offset + 25] << 24);
                const fileNameLength = zipData[offset + 26] | (zipData[offset + 27] << 8);
                const extraFieldLength = zipData[offset + 28] | (zipData[offset + 29] << 8);
                
                const fileNameStart = offset + 30;
                const fileName = decoder.decode(zipData.slice(fileNameStart, fileNameStart + fileNameLength));
                
                const dataStart = fileNameStart + fileNameLength + extraFieldLength;
                
                // Check if this is a markdown file
                if (fileName.endsWith('.md') && compressionMethod === 0) {
                    // Uncompressed (STORE method)
                    const content = decoder.decode(zipData.slice(dataStart, dataStart + uncompressedSize));
                    markdownContents.push(content);
                } else if (fileName.endsWith('.md') && compressionMethod === 8) {
                    // DEFLATE compression - we need to decompress
                    // For simplicity, we'll try to use the browser's DecompressionStream if available
                    try {
                        const compressedData = zipData.slice(dataStart, dataStart + compressedSize);
                        const decompressed = await this.inflateData(compressedData);
                        const content = decoder.decode(decompressed);
                        markdownContents.push(content);
                    } catch (e) {
                        this.logger.warn(`Failed to decompress ${fileName}: ${e}`);
                    }
                }
                
                // Move to next file
                offset = dataStart + compressedSize;
            } else {
                offset++;
            }
        }
        
        if (markdownContents.length === 0) {
            throw new Error('No markdown files found in ZIP');
        }
        
        return markdownContents.join('\n\n---\n\n');
    }

    /**
     * Inflate (decompress) DEFLATE data
     */
    private async inflateData(data: Uint8Array): Promise<Uint8Array> {
        // Try using DecompressionStream (modern browsers)
        if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            const buffer = data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength
            ) as ArrayBuffer;
            writer.write(buffer);
            writer.close();
            
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            
            // Combine chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            
            return result;
        }
        
        throw new Error('DecompressionStream not available');
    }

    /**
     * Convert PDF URL to Markdown (full workflow)
     */
    async convertUrlToMarkdown(
        url: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            language?: string;
            pageRanges?: string;
            onProgress?: (state: string, progress?: { extracted: number; total: number }) => void;
        }
    ): Promise<ConversionResult> {
        try {
            // Create task
            const taskId = await this.createTaskFromUrl(url, options);

            // Wait for completion
            const result = await this.waitForCompletion(taskId, options?.onProgress);

            if (!result.full_zip_url) {
                throw new Error('No result URL in response');
            }

            // Download and extract markdown
            const markdown = await this.downloadMarkdown(result.full_zip_url);

            return {
                success: true,
                markdown,
                taskId,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Conversion failed: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Convert local PDF file to Markdown (full workflow)
     */
    async convertFileToMarkdown(
        fileContent: Uint8Array,
        filename: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            language?: string;
            pageRanges?: string;
            onProgress?: (state: string, progress?: { extracted: number; total: number }) => void;
        }
    ): Promise<ConversionResult> {
        try {
            // Upload and create task
            const taskId = await this.uploadAndCreateTask(fileContent, filename, options);

            // Wait for completion
            const result = await this.waitForCompletion(taskId, options?.onProgress);

            if (!result.full_zip_url) {
                throw new Error('No result URL in response');
            }

            // Download and extract markdown
            const markdown = await this.downloadMarkdown(result.full_zip_url);

            return {
                success: true,
                markdown,
                taskId,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Conversion failed: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
