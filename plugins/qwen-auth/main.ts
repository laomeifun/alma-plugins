/**
 * Qwen Auth Plugin for Alma
 *
 * Enables using Alibaba Qwen AI models via OAuth Device Flow authentication.
 * This plugin registers a custom provider that handles authentication and
 * API calls to the Qwen backend.
 *
 * Based on CLIProxyAPI's Qwen OAuth implementation.
 *
 * DISCLAIMER: This plugin is for personal development use only with your
 * own Qwen account. Not for commercial resale or multi-user services.
 */

import type { PluginContext, PluginActivation } from 'alma-plugin-api';
import { TokenStore } from './lib/token-store';
import { initiateDeviceFlow, pollForToken } from './lib/auth';
import { QWEN_MODELS, getBaseModel } from './lib/models';

// ============================================================================
// Constants
// ============================================================================

// Qwen API base URL (OpenAI-compatible endpoint)
// Default is portal.qwen.ai, but can be overridden by resource_url from OAuth
const QWEN_DEFAULT_BASE_URL = 'https://portal.qwen.ai/v1';

// Qwen-specific headers (matching CLIProxyAPI)
const QWEN_HEADERS = {
    USER_AGENT: 'google-api-nodejs-client/9.15.1',
    X_GOOG_API_CLIENT: 'gl-node/22.17.0',
    CLIENT_METADATA: 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
} as const;

// HTTP status codes
const HTTP_STATUS = {
    TOO_MANY_REQUESTS: 429,
    UNAUTHORIZED: 401,
    SERVER_ERROR: 500,
} as const;

// Default retry-after time in ms (1 minute)
const DEFAULT_RETRY_AFTER_MS = 60 * 1000;

// ============================================================================
// Plugin Activation
// ============================================================================

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, storage, providers, commands, ui } = context;

    logger.info('Qwen Auth plugin activating...');

    // Initialize token store
    const tokenStore = new TokenStore(storage.secrets, logger);
    await tokenStore.initialize();

    // =========================================================================
    // Helper Functions
    // =========================================================================

    /**
     * Parse retry-after header to milliseconds
     */
    const parseRetryAfter = (response: Response): number => {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return seconds * 1000;
            }
        }
        return DEFAULT_RETRY_AFTER_MS;
    };

    // =========================================================================
    // Custom Fetch Wrapper
    // =========================================================================

    /**
     * Get the base URL for Qwen API
     * Uses resource_url from OAuth if available, otherwise default
     */
    const getQwenBaseUrl = (): string => {
        const tokens = tokenStore.getTokens();
        if (tokens?.resource_url) {
            return `https://${tokens.resource_url}/v1`;
        }
        return QWEN_DEFAULT_BASE_URL;
    };

    /**
     * Creates a custom fetch function that:
     * 1. Gets valid access token (refreshing if needed)
     * 2. Adds Qwen-specific headers
     * 3. Handles rate limiting and errors
     * 4. Retries on 401 with token refresh
     * 5. Rewrites URLs for Qwen API compatibility
     */
    const createQwenFetch = (): typeof globalThis.fetch => {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            // Extract URL string
            let url: string;
            if (typeof input === 'string') {
                url = input;
            } else if (input instanceof URL) {
                url = input.toString();
            } else {
                url = input.url;
            }

            // Check if this is a Qwen API request (portal.qwen.ai or custom resource_url)
            if (!url.includes('qwen.ai') && !url.includes('portal.qwen')) {
                // Not a Qwen request, pass through
                return globalThis.fetch(input, init);
            }

            // Rewrite URL for Qwen API compatibility
            // OpenAI SDK may use /responses, but Qwen uses /chat/completions
            let rewrittenUrl = url;
            if (url.includes('/responses')) {
                rewrittenUrl = url.replace('/responses', '/chat/completions');
            }
            // Also handle /completions -> /chat/completions if needed
            if (url.endsWith('/completions') && !url.includes('/chat/completions')) {
                rewrittenUrl = url.replace('/completions', '/chat/completions');
            }

            // Determine if streaming based on request body
            let isStreaming = false;
            if (init?.body && typeof init.body === 'string') {
                try {
                    const bodyJson = JSON.parse(init.body);
                    isStreaming = bodyJson.stream === true;
                } catch {
                    // Ignore parse errors
                }
            }

            // Helper function to make request with token
            const makeRequest = async (token: string): Promise<Response> => {
                const headers = new Headers(init?.headers);
                headers.set('Authorization', `Bearer ${token}`);
                headers.set('Content-Type', 'application/json');
                headers.set('User-Agent', QWEN_HEADERS.USER_AGENT);
                headers.set('X-Goog-Api-Client', QWEN_HEADERS.X_GOOG_API_CLIENT);
                headers.set('Client-Metadata', QWEN_HEADERS.CLIENT_METADATA);
                
                if (isStreaming) {
                    headers.set('Accept', 'text/event-stream');
                } else {
                    headers.set('Accept', 'application/json');
                }

                return globalThis.fetch(rewrittenUrl, {
                    ...init,
                    headers,
                });
            };

            // Get valid access token
            let accessToken: string;
            try {
                accessToken = await tokenStore.getValidAccessToken();
            } catch (error) {
                throw new Error(`Authentication required: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Make the request
            let response = await makeRequest(accessToken);

            // Handle unauthorized - try to refresh token and retry once
            if (response.status === HTTP_STATUS.UNAUTHORIZED) {
                logger.warn('Unauthorized response, attempting token refresh...');
                
                try {
                    // Force token refresh
                    await tokenStore.forceRefreshToken();
                    accessToken = await tokenStore.getValidAccessToken();
                    
                    // Retry the request with new token
                    logger.info('Token refreshed, retrying request...');
                    response = await makeRequest(accessToken);
                    
                    // If still unauthorized after refresh, the refresh token is also invalid
                    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
                        logger.error('Still unauthorized after token refresh. Please login again.');
                        ui.showError('Session expired. Please login to Qwen again.');
                    }
                } catch (refreshError) {
                    logger.error('Token refresh failed:', refreshError);
                    ui.showError('Session expired. Please login to Qwen again.');
                }
            }

            // Handle 404 Not Found - likely wrong URL or model
            if (response.status === 404) {
                const errorText = await response.clone().text();
                logger.error(`404 Not Found: ${url}`, errorText);
                logger.error('This may indicate wrong API endpoint or unsupported model');
            }

            // Handle rate limiting
            if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
                const retryAfterMs = parseRetryAfter(response);
                logger.warn(`Rate limited, retry after ${retryAfterMs}ms`);

                const headers = new Headers(response.headers);
                headers.set('retry-after', String(Math.ceil(retryAfterMs / 1000)));
                return new Response(response.body, {
                    status: HTTP_STATUS.TOO_MANY_REQUESTS,
                    statusText: 'Too Many Requests',
                    headers,
                });
            }

            // Handle server errors
            if (response.status >= HTTP_STATUS.SERVER_ERROR) {
                const errorText = await response.clone().text();
                logger.error(`Server error: ${response.status}`, errorText);
            }

            // Log non-OK responses for debugging
            if (!response.ok) {
                const errorText = await response.clone().text();
                logger.warn(`Qwen API response ${response.status}: ${errorText.slice(0, 500)}`);
            }

            return response;
        };
    };

    // =========================================================================
    // Register Provider
    // =========================================================================

    const providerDisposable = providers.register({
        id: 'qwen',
        name: 'Qwen (Alibaba)',
        description: 'Access Qwen AI models via your Qwen account',
        authType: 'oauth',
        sdkType: 'openai', // Use OpenAI-compatible SDK

        async initialize() {
            logger.info('Qwen provider initialized');
        },

        async isAuthenticated() {
            return tokenStore.hasValidToken();
        },

        async authenticate() {
            try {
                // Initiate device flow
                logger.info('Starting Qwen device flow authentication...');
                const deviceFlow = await initiateDeviceFlow();

                // Show user code and verification URL
                ui.showNotification(
                    `Please visit ${deviceFlow.verification_uri} and enter code: ${deviceFlow.user_code}`,
                    { type: 'info', duration: 60000 }
                );

                // Also show in a more prominent way
                const message = `
🔐 **Qwen Authentication**

1. Open: ${deviceFlow.verification_uri_complete || deviceFlow.verification_uri}
2. Enter code: **${deviceFlow.user_code}**
3. Authorize the application

Waiting for authorization...
                `.trim();

                logger.info(message);

                // Open browser to verification URL
                if (deviceFlow.verification_uri_complete) {
                    // Try to open the complete URL with code pre-filled
                    try {
                        await ui.openExternal(deviceFlow.verification_uri_complete);
                    } catch {
                        // Fallback to basic URL
                        await ui.openExternal(deviceFlow.verification_uri);
                    }
                } else {
                    await ui.openExternal(deviceFlow.verification_uri);
                }

                // Store pending device flow
                await tokenStore.storePendingDeviceFlow({
                    deviceCode: deviceFlow.device_code,
                    codeVerifier: deviceFlow.code_verifier,
                });

                // Poll for token
                const tokens = await pollForToken(
                    deviceFlow.device_code,
                    deviceFlow.code_verifier,
                    (attempt, maxAttempts) => {
                        logger.debug(`Polling for token: attempt ${attempt}/${maxAttempts}`);
                    }
                );

                // Save tokens
                await tokenStore.saveTokens(tokens);
                await tokenStore.clearPendingDeviceFlow();

                const emailInfo = tokens.email ? ` (${tokens.email})` : '';
                ui.showNotification(`Successfully connected to Qwen${emailInfo}!`, { type: 'success' });
                logger.info('Qwen authentication successful');

                return { success: true };
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Authentication failed';
                logger.error('Qwen authentication error:', error);
                ui.showError(`Authentication failed: ${message}`);
                return { success: false, error: message };
            }
        },

        async logout() {
            await tokenStore.clearTokens();
            ui.showNotification('Logged out from Qwen', { type: 'info' });
            logger.info('Qwen logout successful');
        },

        async getModels() {
            // Return all supported models
            return QWEN_MODELS.map((model) => ({
                id: model.id,
                name: model.name,
                description: model.description,
                contextWindow: model.contextWindow,
                maxOutputTokens: model.maxOutputTokens,
                capabilities: {
                    streaming: true,
                    reasoning: model.reasoning ?? false,
                    vision: model.vision ?? false,
                },
            }));
        },

        /**
         * Returns SDK configuration for AI SDK's createOpenAI().
         * Uses dummy API key since actual auth is handled in custom fetch.
         */
        async getSDKConfig() {
            return {
                apiKey: 'qwen-oauth', // Dummy key, actual auth in custom fetch
                baseURL: getQwenBaseUrl(),
                fetch: createQwenFetch(),
            };
        },
    });

    // =========================================================================
    // Register Commands
    // =========================================================================

    const loginCommand = commands.register('qwen-auth.login', async () => {
        const provider = providers.get('qwen');
        if (provider) {
            await provider.authenticate();
        }
    });

    const logoutCommand = commands.register('qwen-auth.logout', async () => {
        const provider = providers.get('qwen');
        if (provider) {
            await provider.logout();
        }
    });

    const statusCommand = commands.register('qwen-auth.status', async () => {
        const hasToken = tokenStore.hasValidToken();
        const email = tokenStore.getEmail();

        if (hasToken) {
            const emailInfo = email ? ` (${email})` : '';
            ui.showNotification(`Qwen: Authenticated${emailInfo}`, { type: 'info' });
        } else {
            ui.showNotification('Qwen: Not authenticated', { type: 'warning' });
        }
    });

    logger.info('Qwen Auth plugin activated');

    // =========================================================================
    // Return Activation
    // =========================================================================

    return {
        dispose() {
            providerDisposable.dispose();
            loginCommand.dispose();
            logoutCommand.dispose();
            statusCommand.dispose();
            logger.info('Qwen Auth plugin deactivated');
        },
    };
}
