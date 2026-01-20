/**
 * MinerU API Client
 * 
 * Client for interacting with the MinerU PDF extraction API.
 * Handles task creation, status polling, and result retrieval.
 */

import type {
    CreateTaskRequest,
    CreateTaskData,
    TaskQueryData,
    ApiResponse,
    UploadFileData,
    ConversionResult,
    ModelVersion,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const MINERU_API_BASE = 'https://mineru.net/api/v4';
const POLL_INTERVAL_MS = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max wait time

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
     */
    async createTaskFromUrl(
        url: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            layoutModel?: string;
            language?: string;
            pageRange?: string;
        }
    ): Promise<string> {
        const request: CreateTaskRequest = {
            url,
            model_version: options?.modelVersion ?? 'vlm',
            enable_formula: options?.enableFormula ?? true,
            enable_table: options?.enableTable ?? true,
            layout_model: options?.layoutModel ?? 'doclayout_yolo',
            language: options?.language ?? 'ch',
        };

        if (options?.pageRange) {
            request.page_range = options.pageRange;
        }

        this.logger.debug(`Creating task for URL: ${url}`);

        const response = await fetch(`${MINERU_API_BASE}/extract/task`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create task: ${response.status} - ${errorText}`);
        }

        const result: ApiResponse<CreateTaskData> = await response.json();

        if (result.code !== 0) {
            throw new Error(`API error: ${result.msg}`);
        }

        if (!result.data?.task_id) {
            throw new Error('No task_id in response');
        }

        this.logger.info(`Task created: ${result.data.task_id}`);
        return result.data.task_id;
    }

    /**
     * Upload a file and create extraction task
     */
    async uploadAndCreateTask(
        fileContent: Uint8Array,
        filename: string,
        options?: {
            modelVersion?: ModelVersion;
            enableFormula?: boolean;
            enableTable?: boolean;
            layoutModel?: string;
            language?: string;
            pageRange?: string;
        }
    ): Promise<string> {
        // Step 1: Upload file
        const formData = new FormData();
        const arrayBuffer = fileContent.buffer.slice(
            fileContent.byteOffset,
            fileContent.byteOffset + fileContent.byteLength
        ) as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        formData.append('file', blob, filename);

        this.logger.debug(`Uploading file: ${filename}`);

        const uploadResponse = await fetch(`${MINERU_API_BASE}/file/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: formData,
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Failed to upload file: ${uploadResponse.status} - ${errorText}`);
        }

        const uploadResult: ApiResponse<UploadFileData> = await uploadResponse.json();

        if (uploadResult.code !== 0) {
            throw new Error(`Upload API error: ${uploadResult.msg}`);
        }

        if (!uploadResult.data?.file_id) {
            throw new Error('No file_id in upload response');
        }

        const fileId = uploadResult.data.file_id;
        this.logger.info(`File uploaded: ${fileId}`);

        // Step 2: Create task with file_id
        const request: CreateTaskRequest = {
            file_id: fileId,
            model_version: options?.modelVersion ?? 'vlm',
            enable_formula: options?.enableFormula ?? true,
            enable_table: options?.enableTable ?? true,
            layout_model: options?.layoutModel ?? 'doclayout_yolo',
            language: options?.language ?? 'ch',
        };

        if (options?.pageRange) {
            request.page_range = options.pageRange;
        }

        const taskResponse = await fetch(`${MINERU_API_BASE}/extract/task`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request),
        });

        if (!taskResponse.ok) {
            const errorText = await taskResponse.text();
            throw new Error(`Failed to create task: ${taskResponse.status} - ${errorText}`);
        }

        const taskResult: ApiResponse<CreateTaskData> = await taskResponse.json();

        if (taskResult.code !== 0) {
            throw new Error(`Task API error: ${taskResult.msg}`);
        }

        if (!taskResult.data?.task_id) {
            throw new Error('No task_id in response');
        }

        this.logger.info(`Task created: ${taskResult.data.task_id}`);
        return taskResult.data.task_id;
    }

    /**
     * Query task status
     */
    async queryTask(taskId: string): Promise<TaskQueryData> {
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
     * Wait for task completion and return result
     */
    async waitForCompletion(
        taskId: string,
        onProgress?: (status: string, progress?: number) => void
    ): Promise<TaskQueryData> {
        let attempts = 0;

        while (attempts < MAX_POLL_ATTEMPTS) {
            const status = await this.queryTask(taskId);

            if (onProgress) {
                onProgress(status.status, status.progress);
            }

            if (status.status === 'done') {
                this.logger.info(`Task ${taskId} completed`);
                return status;
            }

            if (status.status === 'failed') {
                throw new Error(`Task failed: ${status.error_msg || 'Unknown error'}`);
            }

            this.logger.debug(`Task ${taskId} status: ${status.status}, progress: ${status.progress}%`);
            await this.sleep(POLL_INTERVAL_MS);
            attempts++;
        }

        throw new Error('Task timed out');
    }

    /**
     * Download markdown result
     */
    async downloadMarkdown(mdUrl: string): Promise<string> {
        this.logger.debug(`Downloading markdown from: ${mdUrl}`);

        const response = await fetch(mdUrl);

        if (!response.ok) {
            throw new Error(`Failed to download markdown: ${response.status}`);
        }

        return await response.text();
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
            layoutModel?: string;
            language?: string;
            pageRange?: string;
            onProgress?: (status: string, progress?: number) => void;
        }
    ): Promise<ConversionResult> {
        try {
            // Create task
            const taskId = await this.createTaskFromUrl(url, options);

            // Wait for completion
            const result = await this.waitForCompletion(taskId, options?.onProgress);

            if (!result.md_url) {
                throw new Error('No markdown URL in result');
            }

            // Download markdown
            const markdown = await this.downloadMarkdown(result.md_url);

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
            layoutModel?: string;
            language?: string;
            pageRange?: string;
            onProgress?: (status: string, progress?: number) => void;
        }
    ): Promise<ConversionResult> {
        try {
            // Upload and create task
            const taskId = await this.uploadAndCreateTask(fileContent, filename, options);

            // Wait for completion
            const result = await this.waitForCompletion(taskId, options?.onProgress);

            if (!result.md_url) {
                throw new Error('No markdown URL in result');
            }

            // Download markdown
            const markdown = await this.downloadMarkdown(result.md_url);

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
