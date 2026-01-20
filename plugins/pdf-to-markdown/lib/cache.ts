/**
 * Conversion Cache
 * 
 * Caches PDF to Markdown conversions to avoid redundant API calls.
 */

import type { Storage } from 'alma-plugin-api';
import type { CachedConversion } from './types';

// ============================================================================
// Cache Configuration
// ============================================================================

const CACHE_KEY_PREFIX = 'pdf-cache:';
const CACHE_INDEX_KEY = 'pdf-cache-index';
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ============================================================================
// Conversion Cache
// ============================================================================

export class ConversionCache {
    private storage: Storage;
    private ttlMs: number;

    constructor(storage: Storage, ttlMs: number = DEFAULT_CACHE_TTL_MS) {
        this.storage = storage;
        this.ttlMs = ttlMs;
    }

    /**
     * Get cached conversion by hash
     */
    async get(hash: string): Promise<CachedConversion | undefined> {
        const key = CACHE_KEY_PREFIX + hash;
        const cached = await this.storage.get<CachedConversion>(key);

        if (!cached) {
            return undefined;
        }

        // Check expiration
        if (new Date(cached.expiresAt) < new Date()) {
            await this.delete(hash);
            return undefined;
        }

        return cached;
    }

    /**
     * Store conversion in cache
     */
    async set(hash: string, pdfPath: string, markdown: string): Promise<void> {
        const key = CACHE_KEY_PREFIX + hash;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlMs);

        const cached: CachedConversion = {
            pdfPath,
            pdfHash: hash,
            markdown,
            convertedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };

        await this.storage.set(key, cached);

        // Update index
        await this.addToIndex(hash);
    }

    /**
     * Delete cached conversion
     */
    async delete(hash: string): Promise<void> {
        const key = CACHE_KEY_PREFIX + hash;
        await this.storage.delete(key);
        await this.removeFromIndex(hash);
    }

    /**
     * Clear all cached conversions
     */
    async clear(): Promise<void> {
        const index = await this.getIndex();
        
        for (const hash of index) {
            const key = CACHE_KEY_PREFIX + hash;
            await this.storage.delete(key);
        }

        await this.storage.delete(CACHE_INDEX_KEY);
    }

    /**
     * Get cache statistics
     */
    async getStats(): Promise<{ count: number; totalSize: number }> {
        const index = await this.getIndex();
        let totalSize = 0;

        for (const hash of index) {
            const cached = await this.get(hash);
            if (cached) {
                totalSize += cached.markdown.length;
            }
        }

        return {
            count: index.length,
            totalSize,
        };
    }

    /**
     * Clean up expired entries
     */
    async cleanup(): Promise<number> {
        const index = await this.getIndex();
        let cleaned = 0;

        for (const hash of index) {
            const key = CACHE_KEY_PREFIX + hash;
            const cached = await this.storage.get<CachedConversion>(key);

            if (!cached || new Date(cached.expiresAt) < new Date()) {
                await this.storage.delete(key);
                await this.removeFromIndex(hash);
                cleaned++;
            }
        }

        return cleaned;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private async getIndex(): Promise<string[]> {
        return await this.storage.get<string[]>(CACHE_INDEX_KEY, []);
    }

    private async addToIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        if (!index.includes(hash)) {
            index.push(hash);
            await this.storage.set(CACHE_INDEX_KEY, index);
        }
    }

    private async removeFromIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        const newIndex = index.filter(h => h !== hash);
        await this.storage.set(CACHE_INDEX_KEY, newIndex);
    }
}
