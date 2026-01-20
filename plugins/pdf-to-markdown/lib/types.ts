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
 */
export type ModelVersion = 'vlm' | 'doclayout_yolo';

/**
 * File source type
 */
export type FileSource = 'url' | 'file';

/**
 * Request to create a PDF extraction task
 */
export interface CreateTaskRequest {
    /** URL of the PDF file (when using URL source) */
    url?: string;
    /** File ID from upload (when using file source) */
    file_id?: string;
    /** Model version to use */
    model_version?: ModelVersion;
    /** Enable formula recognition */
    enable_formula?: boolean;
    /** Enable table recognition */
    enable_table?: boolean;
    /** Layout detection model */
    layout_model?: string;
    /** OCR language */
    language?: string;
    /** Page range to extract (e.g., "1-5" or "1,3,5") */
    page_range?: string;
}

/**
 * Request to upload a file
 */
export interface UploadFileRequest {
    file: Blob | File;
    filename: string;
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
    data?: T;
}

/**
 * Task creation response data
 */
export interface CreateTaskData {
    task_id: string;
}

/**
 * File upload response data
 */
export interface UploadFileData {
    file_id: string;
}

/**
 * Task status values
 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * Task query response data
 */
export interface TaskQueryData {
    task_id: string;
    status: TaskStatus;
    progress?: number;
    /** Full result URL (available when status is 'done') */
    full_result_url?: string;
    /** Markdown result URL */
    md_url?: string;
    /** Error message (when status is 'failed') */
    error_msg?: string;
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
    enableFormula: boolean;
    enableTable: boolean;
    layoutModel: string;
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
