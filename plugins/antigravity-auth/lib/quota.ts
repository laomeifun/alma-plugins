/**
 * Quota API for fetching real quota data from Google Cloud Code API.
 * This mirrors the implementation in Antigravity-Manager.
 */

const QUOTA_API_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';

interface QuotaInfo {
    remainingFraction?: number;
    resetTime?: string;
}

interface ModelInfo {
    quotaInfo?: QuotaInfo;
}

interface QuotaResponse {
    models: Record<string, ModelInfo>;
}

export interface ModelQuota {
    name: string;
    percentage: number;
    resetTime: string;
}

export interface QuotaData {
    models: ModelQuota[];
    lastUpdated: number;
}

/**
 * Fetch quota data from the Google Cloud Code API.
 * @param accessToken - Valid OAuth access token
 * @param projectId - Antigravity project ID
 * @returns QuotaData with model quotas
 */
export async function fetchQuota(accessToken: string, projectId: string): Promise<QuotaData> {
    const response = await fetch(QUOTA_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity/1.11.3 Darwin/arm64',
        },
        body: JSON.stringify({ project: projectId }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Quota API error: ${response.status} - ${errorText}`);
    }

    const data: QuotaResponse = await response.json();
    const models: ModelQuota[] = [];

    for (const [name, info] of Object.entries(data.models)) {
        if (info.quotaInfo && (name.includes('gemini') || name.includes('claude'))) {
            models.push({
                name,
                percentage: Math.round((info.quotaInfo.remainingFraction ?? 0) * 100),
                resetTime: info.quotaInfo.resetTime ?? '',
            });
        }
    }

    // Sort models by name for consistent display
    models.sort((a, b) => a.name.localeCompare(b.name));

    return {
        models,
        lastUpdated: Date.now(),
    };
}
