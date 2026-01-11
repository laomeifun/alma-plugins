/**
 * 图片处理模块 - 图片保存和结果格式化
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Logger } from 'alma-plugin-api';
import { ImageResult, extFromMime, toDisplayPath, generateBatchId } from './utils';

/**
 * 保存结果
 */
export interface SaveResult {
    saved: string[];
    errors: string[];
    finalOutDir: string;
    warningMsg: string;
}

/**
 * 确保目录存在且可写
 */
async function ensureWritableDir(
    outDir: string,
    logger?: Logger
): Promise<{ dir: string; warning: string }> {
    let finalDir = outDir;
    let warning = '';

    try {
        await fs.mkdir(finalDir, { recursive: true });
        await fs.access(finalDir, fs.constants.W_OK);
    } catch (err) {
        const tmpDir = os.tmpdir();
        const errMsg = err instanceof Error ? err.message : String(err);
        logger?.debug(`[gemini-images] Directory ${finalDir} not writable (${errMsg}), falling back to temp dir`);
        warning = `⚠️ 原定目录 "${toDisplayPath(finalDir)}" 无法写入，已自动保存到临时目录。\n`;
        finalDir = tmpDir;
        await fs.mkdir(finalDir, { recursive: true });
    }

    return { dir: finalDir, warning };
}

/**
 * 保存图片到本地
 */
export async function saveImages(
    images: ImageResult[],
    outDir: string,
    logger?: Logger
): Promise<SaveResult> {
    const { dir: finalOutDir, warning: warningMsg } = await ensureWritableDir(outDir, logger);

    const batchId = generateBatchId();
    const saved: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < images.length; i += 1) {
        const img = images[i];
        const ext = extFromMime(img.mimeType);
        const filePath = path.join(finalOutDir, `image-${batchId}-${i + 1}.${ext}`);

        try {
            if (!img.base64 || typeof img.base64 !== 'string') {
                errors.push(`图片 ${i + 1}: 无效的图片数据`);
                continue;
            }
            const buffer = Buffer.from(img.base64, 'base64');
            if (buffer.length === 0) {
                errors.push(`图片 ${i + 1}: 图片数据为空`);
                continue;
            }
            await fs.writeFile(filePath, buffer);
            saved.push(filePath);
        } catch (writeErr) {
            const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
            errors.push(`图片 ${i + 1}: 保存失败 - ${errMsg}`);
        }
    }

    logger?.debug(`[gemini-images] Saved ${saved.length} images to ${finalOutDir}`);

    return { saved, errors, finalOutDir, warningMsg };
}

/**
 * 构建保存结果的文本消息
 */
export function formatSaveResultText(saveResult: SaveResult, sessionId: string): string {
    const { saved, errors, warningMsg } = saveResult;
    const lines: string[] = [];

    if (warningMsg) {
        lines.push(warningMsg);
    }

    if (saved.length > 0) {
        lines.push(`✅ 成功生成 ${saved.length} 张图片：\n`);
        for (const p of saved) {
            const displayPath = toDisplayPath(p);
            const fileUri = `file:///${displayPath.replace(/^\//, '')}`;
            lines.push(`![${path.basename(p)}](${fileUri})`);
            lines.push(`📁 ${displayPath}\n`);
        }
    }

    if (errors.length > 0) {
        lines.push(`⚠️ 部分失败：`);
        lines.push(...errors);
    }

    lines.push(`\n🔗 session_id: \`${sessionId}\``);
    lines.push(`💡 提示：后续调用时传入此 session_id 可继续编辑这张图片`);

    return lines.join('\n');
}

/**
 * 构建仅图片模式的返回文本
 */
export function formatImageOnlyText(sessionId: string): string {
    return `🔗 session_id: ${sessionId}\n（可用于后续多轮编辑）`;
}

/**
 * 构建错误消息
 */
export function formatErrorMessage(err: unknown): string {
    const errMsg = err instanceof Error ? err.message : String(err);

    // 提供更友好的错误信息和建议
    let suggestion = '';
    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND')) {
        suggestion = '\n💡 建议：检查网络连接和 API 地址是否正确';
    } else if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API Key')) {
        suggestion = '\n💡 建议：请通过命令 "Configure API Key" 设置正确的 Gemini API Key';
    } else if (errMsg.includes('超时') || errMsg.includes('timeout') || errMsg.includes('aborted')) {
        suggestion = '\n💡 建议：请求超时，可以在设置中增加超时时间';
    } else if (errMsg.includes('ENOSPC')) {
        suggestion = '\n💡 建议：磁盘空间不足，请清理后重试';
    } else if (errMsg.includes('EACCES') || errMsg.includes('EPERM')) {
        suggestion = '\n💡 建议：没有写入权限，请检查保存目录权限';
    }

    return `❌ 生成失败: ${errMsg}${suggestion}`;
}
