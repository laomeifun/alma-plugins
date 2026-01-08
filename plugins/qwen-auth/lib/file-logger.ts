/**
 * File Logger for Qwen Auth Plugin
 * 
 * Writes logs to a file for debugging purposes.
 * Uses dynamic import to handle environments where fs might not be available.
 */

// Log buffer for environments without fs access
const logBuffer: string[] = [];
const MAX_BUFFER_SIZE = 1000;

// Try to get fs module (may not be available in all environments)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fsModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pathModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let osModule: any = null;
let logFilePath: string | null = null;

// Initialize modules asynchronously
(async () => {
    try {
        // Use dynamic import to avoid compile-time errors
        // @ts-ignore - dynamic import of Node.js modules
        fsModule = await import('fs');
        // @ts-ignore
        pathModule = await import('path');
        // @ts-ignore
        osModule = await import('os');
        logFilePath = pathModule.join(osModule.homedir(), 'qwen-auth-debug.log');
        
        // Write initial log entry
        const timestamp = new Date().toISOString();
        fsModule.appendFileSync(logFilePath, `\n\n=== Qwen Auth Plugin Started at ${timestamp} ===\n\n`, 'utf8');
    } catch {
        // fs not available, will use buffer only
        console.log('[qwen-auth] File logging not available, using console only');
    }
})();

/**
 * Write a log entry
 */
export function fileLog(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    
    // Append additional arguments
    if (args.length > 0) {
        for (const arg of args) {
            if (typeof arg === 'object') {
                try {
                    logMessage += ' ' + JSON.stringify(arg, null, 2);
                } catch {
                    logMessage += ' [Object]';
                }
            } else {
                logMessage += ' ' + String(arg);
            }
        }
    }
    
    // Always log to console
    console.log(`[qwen-auth] ${logMessage}`);
    
    // Try to write to file
    if (fsModule && logFilePath) {
        try {
            fsModule.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
        } catch {
            // Ignore file write errors
        }
    }
    
    // Also keep in buffer
    logBuffer.push(logMessage);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

/**
 * Log debug message
 */
export function logDebug(message: string, ...args: unknown[]): void {
    fileLog('DEBUG', message, ...args);
}

/**
 * Log info message
 */
export function logInfo(message: string, ...args: unknown[]): void {
    fileLog('INFO', message, ...args);
}

/**
 * Log warning message
 */
export function logWarn(message: string, ...args: unknown[]): void {
    fileLog('WARN', message, ...args);
}

/**
 * Log error message
 */
export function logError(message: string, ...args: unknown[]): void {
    fileLog('ERROR', message, ...args);
}

/**
 * Get the log file path (if available)
 */
export function getLogFilePath(): string | null {
    return logFilePath;
}

/**
 * Get buffered logs
 */
export function getLogBuffer(): string[] {
    return [...logBuffer];
}
