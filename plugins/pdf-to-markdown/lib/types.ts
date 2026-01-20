/**
 * MinerU API Types
 * 
 * Type definitions for the MinerU PDF extraction API.
 * API Documentation: https://mineru.net/apiManage/docs
 */

// ============================================================================
// Request Types
// ============================================================================

/**
 * Supported model versions for PDF extraction
 * - pipeline: Traditional layout detection model
 * - vlm: Vision Language Model (recommended)
 * - MinerU-HTML: For HTML files only
 */
export type ModelVersion = 'pipeline' | 'vlm' | 'MinerU-HTML';

/**
 * File source type
 */
export type FileSource = 'url' | 'file';

/**
 * Request to create a PDF extraction task
 */
export interface CreateTaskRequest {
    /** URL of the PDF file */
    url: string;
    /** Model version to use (default: pipeline) */
    model_version?: ModelVersion;
    /** Enable OCR (only for pipeline model) */
    is_ocr?: boolean;
    /** Enable formula recognition (only for pipeline model) */
    enable_formula?: boolean;
    /** Enable table recognition (only for pipeline model) */
    enable_table?: boolean;
    /** OCR language (only for pipeline model) */
    language?: string;
    /** Data ID for tracking */
    data_id?: string;
    /** Page ranges (e.g., "1-5" or "2,4-6") */
    page_ranges?: string;
    /** Extra export formats */
    extra_formats?: string[];
}

/**
 * Request for batch file upload
 */
export interface BatchUploadRequest {
    files: Array<{
        name: string;
        data_id?: string;
        is_ocr?: boolean;
        page_ranges?: string;
    }>;
    model_version?: ModelVersion;
    enable_formula?: boolean;
    enable_table?: boolean;
    language?: string;
    extra_formats?: string[];
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Base API response structure
 */
export interface ApiResponse<T = unknown> {
    code: number;
    msg: string;
    trace_id?: string;
    data?: T;
}

/**
 * Task creation response data
 */
export interface CreateTaskData {
    task_id: string;
}

/**
 * Batch upload response data
 */
export interface BatchUploadData {
    batch_id: string;
    file_urls: string[];
}

/**
 * Task status values
 */
export type TaskState = 'pending' | 'running' | 'done' | 'failed' | 'converting' | 'waiting-file';

/**
 * Extract progress info
 */
export interface ExtractProgress {
    extracted_pages: number;
    total_pages: number;
    start_time: string;
}

/**
 * Task query response data
 */
export interface TaskQueryData {
    task_id: string;
    /** Task state */
    state: TaskState;
    /** Data ID if provided */
    data_id?: string;
    /** Full ZIP result URL (available when state is 'done') */
    full_zip_url?: string;
    /** Error message (when state is 'failed') */
    err_msg?: string;
    /** Extract progress (when state is 'running') */
    extract_progress?: ExtractProgress;
}

/**
 * Batch task query response
 */
export interface BatchTaskQueryData {
    tasks: TaskQueryData[];
}

// ============================================================================
// Plugin Configuration Types
// ============================================================================

/**
 * Plugin settings
 */
export interface PdfToMarkdownSettings {
    enabled: boolean;
    modelVersion: ModelVersion;
    /** Enable formula recognition (only for pipeline model) */
    enableFormula: boolean;
    /** Enable table recognition (only for pipeline model) */
    enableTable: boolean;
    /** OCR language (only for pipeline model) */
    language: string;
    cacheEnabled: boolean;
    maxFileSizeMB: number;
}

/**
 * Cached conversion result
 */
export interface CachedConversion {
    pdfPath: string;
    pdfHash: string;
    markdown: string;
    convertedAt: string;
    expiresAt: string;
}

/**
 * Conversion result
 */
export interface ConversionResult {
    success: boolean;
    markdown?: string;
    error?: string;
    taskId?: string;
    fromCache?: boolean;
}

/**
 * PDF reference detected in message
 */
export interface PdfReference {
    /** Original text that referenced the PDF */
    originalText: string;
    /** Resolved file path or URL */
    path: string;
    /** Whether this is a URL or local file */
    isUrl: boolean;
    /** Start index in the message */
    startIndex: number;
    /** End index in the message */
    endIndex: number;
    /** Whether this is from an attachment */
    isAttachment?: boolean;
    /** File content if available (for attachments) */
    fileContent?: Uint8Array;
    /** MIME type if known */
    mimeType?: string;
}

// ============================================================================
// Message Part Types (for attachment detection)
// ============================================================================

/**
 * File attachment part in a message
 */
export interface FileAttachmentPart {
    type: 'file';
    name: string;
    mimeType: string;
    /** File path or data URL */
    url?: string;
    /** Base64 encoded data */
    data?: string;
}

/**
 * Image attachment part
 */
export interface ImageAttachmentPart {
    type: 'image';
    name?: string;
    mimeType: string;
    url?: string;
    data?: string;
}

/**
 * Text part in a message
 */
export interface TextPart {
    type: 'text';
    text: string;
}

/**
 * Union of all message part types
 */
export type MessagePart = FileAttachmentPart | ImageAttachmentPart | TextPart | { type: string; [key: string]: unknown };

/**
 * Message content with parts (UIMessage format)
 */
export interface MessageContentWithParts {
    parts?: MessagePart[];
    text?: string;
}
