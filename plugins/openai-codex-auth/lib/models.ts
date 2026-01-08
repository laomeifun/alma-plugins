/**
 * Codex Model Definitions
 *
 * Defines all 22 model variants supported by OpenAI Codex via ChatGPT OAuth.
 * Each variant has a specific reasoning effort level.
 */

import type { CodexModelInfo, ReasoningEffort } from './types';

// ============================================================================
// Model Definitions (22 variants)
// ============================================================================

export const CODEX_MODELS: CodexModelInfo[] = [
    // -------------------------------------------------------------------------
    // GPT-5.2 General (5 variants)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        description: 'GPT-5.2 general purpose model',
        baseModel: 'gpt-5.2',
        reasoning: 'none',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.2-low',
        name: 'GPT-5.2 (Low Reasoning)',
        baseModel: 'gpt-5.2',
        reasoning: 'low',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.2-medium',
        name: 'GPT-5.2 (Medium Reasoning)',
        baseModel: 'gpt-5.2',
        reasoning: 'medium',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.2-high',
        name: 'GPT-5.2 (High Reasoning)',
        baseModel: 'gpt-5.2',
        reasoning: 'high',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.2-xhigh',
        name: 'GPT-5.2 (XHigh Reasoning)',
        baseModel: 'gpt-5.2',
        reasoning: 'xhigh',
        contextWindow: 128000,
    },

    // -------------------------------------------------------------------------
    // GPT-5.2 Codex (4 variants - no 'none' reasoning)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        description: 'GPT-5.2 Codex - optimized for coding tasks',
        baseModel: 'gpt-5.2-codex',
        reasoning: 'medium',
        contextWindow: 272000,
        maxOutputTokens: 128000,
    },
    {
        id: 'gpt-5.2-codex-low',
        name: 'GPT-5.2 Codex (Low Reasoning)',
        baseModel: 'gpt-5.2-codex',
        reasoning: 'low',
        contextWindow: 272000,
        maxOutputTokens: 128000,
    },
    {
        id: 'gpt-5.2-codex-high',
        name: 'GPT-5.2 Codex (High Reasoning)',
        baseModel: 'gpt-5.2-codex',
        reasoning: 'high',
        contextWindow: 272000,
        maxOutputTokens: 128000,
    },
    {
        id: 'gpt-5.2-codex-xhigh',
        name: 'GPT-5.2 Codex (XHigh Reasoning)',
        baseModel: 'gpt-5.2-codex',
        reasoning: 'xhigh',
        contextWindow: 272000,
        maxOutputTokens: 128000,
    },

    // -------------------------------------------------------------------------
    // GPT-5.1 Codex Max (4 variants)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.1-codex-max',
        name: 'GPT-5.1 Codex Max',
        description: 'GPT-5.1 Codex Max - maximum capability variant',
        baseModel: 'gpt-5.1-codex-max',
        reasoning: 'high',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: 'gpt-5.1-codex-max-low',
        name: 'GPT-5.1 Codex Max (Low Reasoning)',
        baseModel: 'gpt-5.1-codex-max',
        reasoning: 'low',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: 'gpt-5.1-codex-max-medium',
        name: 'GPT-5.1 Codex Max (Medium Reasoning)',
        baseModel: 'gpt-5.1-codex-max',
        reasoning: 'medium',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: 'gpt-5.1-codex-max-xhigh',
        name: 'GPT-5.1 Codex Max (XHigh Reasoning)',
        baseModel: 'gpt-5.1-codex-max',
        reasoning: 'xhigh',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },

    // -------------------------------------------------------------------------
    // GPT-5.1 Codex (3 variants)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.1-codex',
        name: 'GPT-5.1 Codex',
        description: 'GPT-5.1 Codex - balanced coding model',
        baseModel: 'gpt-5.1-codex',
        reasoning: 'medium',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: 'gpt-5.1-codex-low',
        name: 'GPT-5.1 Codex (Low Reasoning)',
        baseModel: 'gpt-5.1-codex',
        reasoning: 'low',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: 'gpt-5.1-codex-high',
        name: 'GPT-5.1 Codex (High Reasoning)',
        baseModel: 'gpt-5.1-codex',
        reasoning: 'high',
        contextWindow: 200000,
        maxOutputTokens: 64000,
    },

    // -------------------------------------------------------------------------
    // GPT-5.1 Codex Mini (2 variants)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.1-codex-mini',
        name: 'GPT-5.1 Codex Mini',
        description: 'GPT-5.1 Codex Mini - fast and efficient',
        baseModel: 'gpt-5.1-codex-mini',
        reasoning: 'medium',
        contextWindow: 128000,
        maxOutputTokens: 32000,
    },
    {
        id: 'gpt-5.1-codex-mini-high',
        name: 'GPT-5.1 Codex Mini (High Reasoning)',
        baseModel: 'gpt-5.1-codex-mini',
        reasoning: 'high',
        contextWindow: 128000,
        maxOutputTokens: 32000,
    },

    // -------------------------------------------------------------------------
    // GPT-5.1 General (4 variants)
    // -------------------------------------------------------------------------
    {
        id: 'gpt-5.1',
        name: 'GPT-5.1',
        description: 'GPT-5.1 general purpose model',
        baseModel: 'gpt-5.1',
        reasoning: 'none',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.1-low',
        name: 'GPT-5.1 (Low Reasoning)',
        baseModel: 'gpt-5.1',
        reasoning: 'low',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.1-medium',
        name: 'GPT-5.1 (Medium Reasoning)',
        baseModel: 'gpt-5.1',
        reasoning: 'medium',
        contextWindow: 128000,
    },
    {
        id: 'gpt-5.1-high',
        name: 'GPT-5.1 (High Reasoning)',
        baseModel: 'gpt-5.1',
        reasoning: 'high',
        contextWindow: 128000,
    },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): CodexModelInfo | undefined {
    return CODEX_MODELS.find(m => m.id === modelId);
}

/**
 * Get the base model ID for API calls
 * Strips the reasoning suffix to get the actual model name
 */
export function getBaseModelId(modelId: string): string {
    const model = getModelInfo(modelId);
    return model?.baseModel ?? modelId;
}

/**
 * Get the reasoning effort for a model
 */
export function getReasoningEffort(modelId: string): ReasoningEffort {
    const model = getModelInfo(modelId);
    return model?.reasoning ?? 'medium';
}

/**
 * Check if a model supports a specific reasoning level
 * Codex models don't support 'none' reasoning
 */
export function supportsReasoningLevel(modelId: string, level: ReasoningEffort): boolean {
    const baseModel = getBaseModelId(modelId);

    // Codex models don't support 'none' reasoning
    if (baseModel.includes('codex') && level === 'none') {
        return false;
    }

    // Mini models don't support 'xhigh' or 'low'
    if (baseModel.includes('mini')) {
        return level === 'medium' || level === 'high';
    }

    return true;
}
