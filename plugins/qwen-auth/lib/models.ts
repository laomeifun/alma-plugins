/**
 * Qwen Model Definitions
 *
 * Defines the available Qwen models and their capabilities.
 * Based on CLIProxyAPI's model registry.
 */

import type { QwenModelInfo } from './types';

// ============================================================================
// Model Definitions
// ============================================================================

export const QWEN_MODELS: QwenModelInfo[] = [
    // Qwen3 Coder Models
    {
        id: 'qwen3-coder-plus',
        name: 'Qwen3 Coder Plus',
        description: 'Advanced code generation and understanding model',
        baseModel: 'qwen3-coder-plus',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },
    {
        id: 'qwen3-coder-flash',
        name: 'Qwen3 Coder Flash',
        description: 'Fast code generation model',
        baseModel: 'qwen3-coder-flash',
        contextWindow: 8192,
        maxOutputTokens: 2048,
    },

    // Qwen3 General Models
    {
        id: 'qwen3-max',
        name: 'Qwen3 Max',
        description: 'Qwen3 flagship model with maximum capabilities',
        baseModel: 'qwen3-max',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },
    {
        id: 'qwen3-max-preview',
        name: 'Qwen3 Max Preview',
        description: 'Qwen3 Max preview build with latest features',
        baseModel: 'qwen3-max-preview',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },

    // Qwen3 Vision Models
    {
        id: 'qwen3-vl-plus',
        name: 'Qwen3 VL Plus',
        description: 'Qwen3 multimodal vision-language model',
        baseModel: 'qwen3-vl-plus',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        vision: true,
    },
    {
        id: 'vision-model',
        name: 'Qwen3 Vision Model',
        description: 'Vision model for image understanding',
        baseModel: 'vision-model',
        contextWindow: 32768,
        maxOutputTokens: 2048,
        vision: true,
    },

    // Qwen3 Large Models
    {
        id: 'qwen3-235b-a22b-thinking-2507',
        name: 'Qwen3 235B Thinking',
        description: 'Qwen3 235B A22B Thinking model with reasoning capabilities',
        baseModel: 'qwen3-235b-a22b-thinking-2507',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        reasoning: true,
    },
    {
        id: 'qwen3-235b-a22b-instruct',
        name: 'Qwen3 235B Instruct',
        description: 'Qwen3 235B A22B Instruct model',
        baseModel: 'qwen3-235b-a22b-instruct',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },
    {
        id: 'qwen3-235b',
        name: 'Qwen3 235B',
        description: 'Qwen3 235B A22B base model',
        baseModel: 'qwen3-235b',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },
    {
        id: 'qwen3-32b',
        name: 'Qwen3 32B',
        description: 'Qwen3 32B efficient model',
        baseModel: 'qwen3-32b',
        contextWindow: 32768,
        maxOutputTokens: 8192,
    },
];

// ============================================================================
// Model Helpers
// ============================================================================

/**
 * Get model info by ID
 */
export function getModelById(modelId: string): QwenModelInfo | undefined {
    return QWEN_MODELS.find(m => m.id === modelId);
}

/**
 * Check if a model supports vision
 */
export function isVisionModel(modelId: string): boolean {
    const model = getModelById(modelId);
    return model?.vision ?? false;
}

/**
 * Check if a model supports reasoning/thinking
 */
export function isReasoningModel(modelId: string): boolean {
    const model = getModelById(modelId);
    return model?.reasoning ?? false;
}

/**
 * Get the base model ID for API calls
 */
export function getBaseModel(modelId: string): string {
    const model = getModelById(modelId);
    return model?.baseModel ?? modelId;
}
