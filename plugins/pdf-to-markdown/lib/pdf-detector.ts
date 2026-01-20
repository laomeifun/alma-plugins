/**
 * PDF Detection Utilities
 * 
 * Utilities for detecting PDF references in chat messages,
 * including text references and file attachments.
 */

import type { PdfReference, MessageContentWithParts, FileAttachmentPart } from './types';

// ============================================================================
// PDF Reference Detection
// ============================================================================

/**
 * Regex patterns for detecting PDF references in message text
 */
const PDF_PATTERNS: RegExp[] = [
    // URL patterns
    /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.pdf(?:\?[^\s<>"{}|\\^`\[\]]*)?/gi,
    
    // Windows file paths (e.g., C:\path\to\file.pdf)
    /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\.pdf/gi,
    
    // Unix/Mac file paths (e.g., /home/user/file.pdf)
    /(?:\/[^\/\s:*?"<>|]+)+\.pdf/gi,
    
    // Relative paths (e.g., ./docs/file.pdf, ../file.pdf)
    /(?:\.\.?\/)?(?:[^\/\s:*?"<>|]+\/)*[^\/\s:*?"<>|]+\.pdf/gi,
    
    // file:// protocol
    /file:\/\/[^\s<>"{}|\\^`\[\]]+\.pdf/gi,
];

/**
 * Patterns for detecting Alma attachment references
 * These patterns match various ways Alma might represent file attachments in message text
 */
const ATTACHMENT_PATTERNS: { pattern: RegExp; extractor: (match: RegExpExecArray) => string }[] = [
    // [附件: filename.pdf] or [Attachment: filename.pdf]
    {
        pattern: /\[(?:附件|Attachment|attachment|文件|File|file):\s*([^\]]+\.pdf)\]/gi,
        extractor: (match) => match[1].trim(),
    },
    // <attachment>filename.pdf</attachment>
    {
        pattern: /<attachment>([^<]+\.pdf)<\/attachment>/gi,
        extractor: (match) => match[1].trim(),
    },
    // 📎 filename.pdf or 📄 filename.pdf
    {
        pattern: /[📎📄📁]\s*([^\s\n]+\.pdf)/gi,
        extractor: (match) => match[1].trim(),
    },
    // [file:filename.pdf] or [pdf:filename.pdf]
    {
        pattern: /\[(?:file|pdf|doc):\s*([^\]]+\.pdf)\]/gi,
        extractor: (match) => match[1].trim(),
    },
    // Markdown link to PDF: [text](path/to/file.pdf)
    {
        pattern: /\[[^\]]*\]\(([^)]+\.pdf)\)/gi,
        extractor: (match) => match[1].trim(),
    },
    // Quoted paths: "path/to/file.pdf" or 'path/to/file.pdf'
    {
        pattern: /["']([^"']+\.pdf)["']/gi,
        extractor: (match) => match[1].trim(),
    },
    // Backtick paths: `path/to/file.pdf`
    {
        pattern: /`([^`]+\.pdf)`/gi,
        extractor: (match) => match[1].trim(),
    },
];

/**
 * Detect PDF references in a message (both direct paths and attachment references)
 */
export function detectPdfReferences(content: string): PdfReference[] {
    const references: PdfReference[] = [];
    const seen = new Set<string>();

    // Helper to add reference if not duplicate
    const addReference = (path: string, originalText: string, startIndex: number, isAttachment: boolean = false) => {
        const normalizedPath = path.toLowerCase();
        if (seen.has(normalizedPath)) {
            return;
        }
        seen.add(normalizedPath);

        // Handle file:// protocol
        let cleanPath = path;
        if (cleanPath.startsWith('file://')) {
            cleanPath = cleanPath.slice(7); // Remove 'file://'
            // On Windows, file:///C:/path becomes C:/path
            if (cleanPath.startsWith('/') && /^\/[A-Za-z]:/.test(cleanPath)) {
                cleanPath = cleanPath.slice(1);
            }
        }

        const isUrl = path.startsWith('http://') || path.startsWith('https://');

        references.push({
            originalText,
            path: cleanPath,
            isUrl,
            startIndex,
            endIndex: startIndex + originalText.length,
            isAttachment,
        });
    };

    // First, detect attachment-style references (higher priority)
    for (const { pattern, extractor } of ATTACHMENT_PATTERNS) {
        pattern.lastIndex = 0;
        
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const path = extractor(match);
            addReference(path, match[0], match.index, true);
        }
    }

    // Then, detect direct path references
    for (const pattern of PDF_PATTERNS) {
        pattern.lastIndex = 0;
        
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const path = match[0];
            addReference(path, path, match.index, false);
        }
    }

    // Sort by position in message
    references.sort((a, b) => a.startIndex - b.startIndex);

    return references;
}

/**
 * Check if a file path looks like a PDF
 */
export function isPdfPath(path: string): boolean {
    return path.toLowerCase().endsWith('.pdf');
}

/**
 * Extract filename from path
 */
export function getFilename(path: string): string {
    // Handle URLs
    if (path.includes('?')) {
        path = path.split('?')[0];
    }
    
    // Get last segment
    const segments = path.split(/[\/\\]/);
    return segments[segments.length - 1] || 'document.pdf';
}

/**
 * Generate a simple hash for caching purposes
 */
export async function generateHash(content: string | Uint8Array): Promise<string> {
    let data: Uint8Array;
    
    if (typeof content === 'string') {
        data = new TextEncoder().encode(content);
    } else {
        data = content;
    }

    // Use SubtleCrypto if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
        ) as ArrayBuffer;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback: simple hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data[i];
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

// ============================================================================
// Attachment Detection
// ============================================================================

/**
 * Detect PDF attachments from message content (UIMessage format)
 */
export function detectPdfAttachments(content: unknown): PdfReference[] {
    const references: PdfReference[] = [];

    if (!content || typeof content !== 'object') {
        return references;
    }

    const msg = content as MessageContentWithParts;

    // Check if content has parts array
    if (!msg.parts || !Array.isArray(msg.parts)) {
        return references;
    }

    for (const part of msg.parts) {
        // Check for file attachment type
        if (part.type === 'file') {
            const filePart = part as FileAttachmentPart;
            
            // Check if it's a PDF
            if (
                filePart.mimeType === 'application/pdf' ||
                (filePart.name && filePart.name.toLowerCase().endsWith('.pdf'))
            ) {
                const ref: PdfReference = {
                    originalText: filePart.name || 'attachment.pdf',
                    path: filePart.url || filePart.name || 'attachment.pdf',
                    isUrl: filePart.url?.startsWith('http') || false,
                    startIndex: 0,
                    endIndex: 0,
                    isAttachment: true,
                    mimeType: filePart.mimeType,
                };

                // If data is base64 encoded, decode it
                if (filePart.data) {
                    try {
                        ref.fileContent = base64ToUint8Array(filePart.data);
                    } catch (e) {
                        // Ignore decode errors
                    }
                }

                references.push(ref);
            }
        }
    }

    return references;
}

/**
 * Detect all PDF references (both text and attachments)
 */
export function detectAllPdfReferences(
    textContent: string,
    rawContent?: unknown
): PdfReference[] {
    // Get text-based references
    const textRefs = detectPdfReferences(textContent);

    // Get attachment-based references
    const attachmentRefs = rawContent ? detectPdfAttachments(rawContent) : [];

    // Combine and deduplicate
    const allRefs = [...attachmentRefs, ...textRefs];
    const seen = new Set<string>();
    
    return allRefs.filter(ref => {
        const key = ref.path.toLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    // Decode base64
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes;
}
