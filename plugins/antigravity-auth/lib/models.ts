/**
 * Antigravity Model Definitions
 *
 * Defines Claude and Gemini models available through Antigravity OAuth.
 * Based on opencode-antigravity-auth model resolution.
 */

import type { AntigravityModelInfo, ThinkingLevel, ImageSize } from './types';

// ============================================================================
// Model Definitions
// ============================================================================

export const ANTIGRAVITY_MODELS: AntigravityModelInfo[] = [
    // -------------------------------------------------------------------------
    // Claude Models (Thinking variants)
    // Budgets based on opencode-antigravity-auth: { low: 8192, medium: 16384, high: 32768 }
    // -------------------------------------------------------------------------
    {
        id: 'claude-sonnet-4-5-thinking',
        name: 'Claude Sonnet 4.5 (Thinking)',
        description: 'Claude Sonnet 4.5 with extended thinking enabled',
        baseModel: 'claude-sonnet-4-5-thinking',
        family: 'claude',
        thinking: 'medium',
        thinkingBudget: 16384,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    {
        id: 'claude-sonnet-4-5-thinking-high',
        name: 'Claude Sonnet 4.5 (High Thinking)',
        description: 'Claude Sonnet 4.5 with high thinking budget',
        baseModel: 'claude-sonnet-4-5-thinking',
        family: 'claude',
        thinking: 'high',
        thinkingBudget: 32768,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    {
        id: 'claude-sonnet-4-5-thinking-low',
        name: 'Claude Sonnet 4.5 (Low Thinking)',
        description: 'Claude Sonnet 4.5 with low thinking budget',
        baseModel: 'claude-sonnet-4-5-thinking',
        family: 'claude',
        thinking: 'low',
        thinkingBudget: 8192,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        description: 'Claude Sonnet 4.5 without thinking',
        baseModel: 'claude-sonnet-4-5',
        family: 'claude',
        thinking: 'none',
        contextWindow: 200000,
        maxOutputTokens: 8192,
    },

    // -------------------------------------------------------------------------
    // Claude Opus 4.5 (Thinking variants)
    // -------------------------------------------------------------------------
    {
        id: 'claude-opus-4-5-thinking',
        name: 'Claude Opus 4.5 (Thinking)',
        description: 'Claude Opus 4.5 with extended thinking enabled',
        baseModel: 'claude-opus-4-5-thinking',
        family: 'claude',
        thinking: 'medium',
        thinkingBudget: 16384,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    {
        id: 'claude-opus-4-5-thinking-high',
        name: 'Claude Opus 4.5 (High Thinking)',
        description: 'Claude Opus 4.5 with high thinking budget',
        baseModel: 'claude-opus-4-5-thinking',
        family: 'claude',
        thinking: 'high',
        thinkingBudget: 32768,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    {
        id: 'claude-opus-4-5-thinking-low',
        name: 'Claude Opus 4.5 (Low Thinking)',
        description: 'Claude Opus 4.5 with low thinking budget',
        baseModel: 'claude-opus-4-5-thinking',
        family: 'claude',
        thinking: 'low',
        thinkingBudget: 8192,
        contextWindow: 200000,
        maxOutputTokens: 65536,
    },
    // NOTE: claude-opus-4-5 (without thinking) is NOT supported by Antigravity API
    // Only thinking variants are available for Opus

    // -------------------------------------------------------------------------
    // Gemini 2.0 Models
    // -------------------------------------------------------------------------
    {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash Exp',
        baseModel: 'gemini-2.0-flash-exp',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },

    // -------------------------------------------------------------------------
    // Gemini 2.5 Models
    // -------------------------------------------------------------------------
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        baseModel: 'gemini-2.5-pro',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        baseModel: 'gemini-2.5-flash',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        baseModel: 'gemini-2.5-flash-lite',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-2.5-flash-thinking',
        name: 'Gemini 2.5 Flash Thinking',
        baseModel: 'gemini-2.5-flash-thinking',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },

    // -------------------------------------------------------------------------
    // Gemini 3.0 Models
    // -------------------------------------------------------------------------
    {
        id: 'gemini-3-pro',
        name: 'Gemini 3 Pro',
        baseModel: 'gemini-3-pro',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-3-pro-low',
        name: 'Gemini 3 Pro Low',
        baseModel: 'gemini-3-pro-low',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-3-pro-high',
        name: 'Gemini 3 Pro High',
        baseModel: 'gemini-3-pro-high',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro Preview',
        baseModel: 'gemini-3-pro-preview',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },
    {
        id: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
        baseModel: 'gemini-3-flash',
        family: 'gemini',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
    },

    // -------------------------------------------------------------------------
    // Gemini 3 Pro Image Models
    // Dynamically generated combinations of resolution and aspect ratio
    // Matches Antigravity-Manager format
    // -------------------------------------------------------------------------
    ...generateImageModels(),
];

/**
 * Generate all Gemini 3 Pro Image model variants
 * Combinations: resolutions × ratios = 3 × 7 = 21 models
 */
function generateImageModels(): AntigravityModelInfo[] {
    const base = 'gemini-3-pro-image';
    const resolutions = ['', '-2k', '-4k'] as const;
    const ratios = ['', '-1x1', '-4x3', '-3x4', '-16x9', '-9x16', '-21x9'] as const;

    const resolutionLabels: Record<string, string> = {
        '': '',
        '-2k': '2K ',
        '-4k': '4K ',
    };

    const ratioLabels: Record<string, string> = {
        '': '1:1',
        '-1x1': '1:1',
        '-4x3': '4:3',
        '-3x4': '3:4',
        '-16x9': '16:9',
        '-9x16': '9:16',
        '-21x9': '21:9',
    };

    const models: AntigravityModelInfo[] = [];

    for (const res of resolutions) {
        for (const ratio of ratios) {
            const id = `${base}${res}${ratio}`;
            const resLabel = resolutionLabels[res];
            const ratioLabel = ratioLabels[ratio];
            // e.g., "Gemini 3 Pro (Image 4K 16:9)" or "Gemini 3 Pro (Image 1:1)"
            const name = `Gemini 3 Pro (Image ${resLabel}${ratioLabel})`;

            models.push({
                id,
                name,
                baseModel: base,
                family: 'gemini',
                contextWindow: 1048576,
                maxOutputTokens: 65536,
                imageOutput: true,
                functionCalling: true,
                reasoning: true,
            });
        }
    }

    return models;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strip provider prefix from model ID (e.g., "antigravity:claude-sonnet-4-5" -> "claude-sonnet-4-5")
 */
export function stripProviderPrefix(modelId: string): string {
    const colonIndex = modelId.indexOf(':');
    if (colonIndex !== -1) {
        return modelId.slice(colonIndex + 1);
    }
    return modelId;
}

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): AntigravityModelInfo | undefined {
    const cleanId = stripProviderPrefix(modelId);
    return ANTIGRAVITY_MODELS.find((m) => m.id === cleanId);
}

/**
 * Get the base model ID for API calls
 */
export function getBaseModelId(modelId: string): string {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    return model?.baseModel ?? cleanId;
}

/**
 * Get model family (claude or gemini)
 */
export function getModelFamily(modelId: string): 'claude' | 'gemini' {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    if (model) {
        return model.family;
    }
    // Detect from model ID
    if (cleanId.toLowerCase().includes('claude')) {
        return 'claude';
    }
    return 'gemini';
}

/**
 * Check if model is a Claude thinking model
 */
export function isClaudeThinkingModel(modelId: string): boolean {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    if (model) {
        return model.family === 'claude' && model.thinking !== 'none' && model.thinking !== undefined;
    }
    // Fallback detection from model ID
    const lower = cleanId.toLowerCase();
    return lower.includes('claude') && lower.includes('thinking');
}

/**
 * Get thinking budget for a model
 */
export function getThinkingBudget(modelId: string): number | undefined {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    return model?.thinkingBudget;
}

/**
 * Get thinking level for a model
 */
export function getThinkingLevel(modelId: string): ThinkingLevel {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    return model?.thinking ?? 'none';
}

/**
 * Check if a model is an image generation model
 */
export function isImageModel(modelId: string): boolean {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    if (model) {
        return model.imageOutput === true;
    }
    // Fallback detection from model ID
    return cleanId.toLowerCase().includes('gemini-3-pro-image');
}

/**
 * Parse image size from model ID (matches Antigravity-Manager logic)
 * Uses 'contains' matching like Antigravity-Manager
 * e.g., 'gemini-3-pro-image-4k' -> '4K'
 * e.g., 'gemini-3-pro-image-hd' -> '4K'
 * e.g., 'gemini-3-pro-image-2k' -> '2K'
 * e.g., 'gemini-3-pro-image-2k-16x9' -> '2K'
 */
export function parseImageSize(modelId: string): ImageSize | undefined {
    const cleanId = stripProviderPrefix(modelId).toLowerCase();

    // -4k and -hd both map to '4K' (matches Antigravity-Manager)
    if (cleanId.includes('-4k') || cleanId.includes('-hd')) {
        return '4K';
    }
    if (cleanId.includes('-2k')) {
        return '2K';
    }

    return undefined;
}

/**
 * Parse aspect ratio from image model ID (matches Antigravity-Manager logic)
 * Uses 'contains' matching like Antigravity-Manager
 * e.g., 'gemini-3-pro-image-16x9' -> '16:9'
 * e.g., 'gemini-3-pro-image-2k-16x9' -> '16:9'
 */
export function parseImageAspectRatio(modelId: string): string {
    const cleanId = stripProviderPrefix(modelId).toLowerCase();

    // Check aspect ratio patterns (matches Antigravity-Manager)
    if (cleanId.includes('-21x9') || cleanId.includes('-21-9')) return '21:9';
    if (cleanId.includes('-16x9') || cleanId.includes('-16-9')) return '16:9';
    if (cleanId.includes('-9x16') || cleanId.includes('-9-16')) return '9:16';
    if (cleanId.includes('-4x3') || cleanId.includes('-4-3')) return '4:3';
    if (cleanId.includes('-3x4') || cleanId.includes('-3-4')) return '3:4';
    if (cleanId.includes('-1x1') || cleanId.includes('-1-1')) return '1:1';

    // Default aspect ratio
    return '1:1';
}

/**
 * Parse model ID with tier suffix (e.g., claude-sonnet-4-5-thinking-high)
 * Returns the base model and thinking tier
 */
export function parseModelWithTier(modelId: string): {
    baseModel: string;
    thinkingLevel: ThinkingLevel;
    thinkingBudget?: number;
} {
    const cleanId = stripProviderPrefix(modelId);
    const model = getModelInfo(cleanId);
    if (model) {
        return {
            baseModel: model.baseModel,
            thinkingLevel: model.thinking ?? 'none',
            thinkingBudget: model.thinkingBudget,
        };
    }

    // Fallback: try to parse tier suffix (budgets match opencode-antigravity-auth)
    const tierMap: Record<string, { level: ThinkingLevel; budget: number }> = {
        '-high': { level: 'high', budget: 32768 },
        '-medium': { level: 'medium', budget: 16384 },
        '-low': { level: 'low', budget: 8192 },
    };

    for (const [suffix, config] of Object.entries(tierMap)) {
        if (cleanId.endsWith(suffix)) {
            return {
                baseModel: cleanId.slice(0, -suffix.length),
                thinkingLevel: config.level,
                thinkingBudget: config.budget,
            };
        }
    }

    return {
        baseModel: cleanId,
        thinkingLevel: 'none',
    };
}
