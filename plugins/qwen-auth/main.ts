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
        
        /**
         * Recursively convert all input_text/output_text to text type
         * This ensures Qwen API compatibility
         */
        const convertContentTypes = (obj: any): any => {
            if (obj === null || obj === undefined) return obj;
            
            if (Array.isArray(obj)) {
                return obj.map(item => convertContentTypes(item));
            }
            
            if (typeof obj === 'object') {
                // Convert input_text/output_text to text
                if (obj.type === 'input_text' || obj.type === 'output_text') {
                    return { type: 'text', text: obj.text || '' };
                }
                
                // Recursively process all properties
                const result: any = {};
                for (const key of Object.keys(obj)) {
                    result[key] = convertContentTypes(obj[key]);
                }
                return result;
            }
            
            return obj;
        };
        
        /**
         * Simplify content array to string if all text
         */
        const simplifyContent = (content: any): any => {
            if (typeof content === 'string') return content;
            if (!Array.isArray(content)) return content;
            
            // Check if all items are text type
            const allText = content.every((p: any) => 
                p.type === 'text' || (typeof p === 'object' && p.text && !p.type)
            );
            
            if (allText && content.length > 0) {
                return content.map((p: any) => p.text || '').join('');
            }
            
            return content;
        };
        
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

            // Transform request body from OpenAI Responses API format to Chat Completions format
            let transformedBody = init?.body;
            let isStreaming = false;
            
            if (init?.body && typeof init.body === 'string') {
                try {
                    let parsed = JSON.parse(init.body);
                    
                    // First, recursively convert all input_text/output_text to text
                    parsed = convertContentTypes(parsed);
                    
                    isStreaming = parsed.stream === true;
                    
                    // Transform from Responses API format to Chat Completions format
                    const transformed: Record<string, unknown> = {
                        model: parsed.model,
                        stream: isStreaming,
                    };
                    
                    // Convert 'input' array to 'messages' array
                    if (Array.isArray(parsed.input)) {
                        transformed.messages = parsed.input
                            .filter((item: any) => {
                                // Filter out unsupported types
                                if (item.type === 'item_reference') return false;
                                return true;
                            })
                            .map((item: any) => {
                                // Convert to Chat Completions message format
                                if (item.type === 'message') {
                                    const role = item.role === 'developer' ? 'system' : item.role;
                                    const content = simplifyContent(item.content);
                                    return { role, content };
                                }
                                
                                // Handle function_call_output -> tool message
                                if (item.type === 'function_call_output') {
                                    return {
                                        role: 'tool',
                                        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
                                        tool_call_id: item.call_id,
                                    };
                                }
                                
                                // Handle function_call -> assistant with tool_calls
                                if (item.type === 'function_call') {
                                    return {
                                        role: 'assistant',
                                        content: null,
                                        tool_calls: [{
                                            id: item.call_id || item.id,
                                            type: 'function',
                                            function: {
                                                name: item.name,
                                                arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments),
                                            },
                                        }],
                                    };
                                }
                                
                                // Default: try to extract as message
                                return {
                                    role: item.role || 'user',
                                    content: simplifyContent(item.content) || item.text || '',
                                };
                            })
                            .filter((msg: any) => msg.content !== '' || msg.tool_calls || msg.content === null);
                        
                        // Ensure messages array is not empty
                        if (!transformed.messages || (transformed.messages as any[]).length === 0) {
                            transformed.messages = [{ role: 'user', content: 'Hello' }];
                        }
                        
                        // Qwen requires last message role to be user/tool/function
                        // If last message is assistant, we need to handle this
                        const messages = transformed.messages as any[];
                        if (messages.length > 0) {
                            const lastMsg = messages[messages.length - 1];
                            if (lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
                                // This is unusual - assistant message at the end without tool_calls
                                // Add a placeholder user message
                                messages.push({ role: 'user', content: 'Continue.' });
                            }
                        }
                    } else if (Array.isArray(parsed.messages)) {
                        // Already in messages format - content types already converted by convertContentTypes
                        transformed.messages = parsed.messages.map((msg: any) => ({
                            ...msg,
                            content: simplifyContent(msg.content),
                        }));
                        
                        // Ensure not empty
                        if ((transformed.messages as any[]).length === 0) {
                            transformed.messages = [{ role: 'user', content: 'Hello' }];
                        }
                    } else {
                        // No input or messages, create default
                        transformed.messages = [{ role: 'user', content: 'Hello' }];
                    }
                    
                    // Copy other supported parameters
                    if (parsed.temperature !== undefined) transformed.temperature = parsed.temperature;
                    if (parsed.top_p !== undefined) transformed.top_p = parsed.top_p;
                    if (parsed.max_tokens !== undefined) transformed.max_tokens = parsed.max_tokens;
                    if (parsed.max_output_tokens !== undefined) transformed.max_tokens = parsed.max_output_tokens;
                    if (parsed.stop !== undefined) transformed.stop = parsed.stop;
                    
                    // Handle tools
                    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
                        transformed.tools = parsed.tools;
                    }
                    
                    // Add stream_options for usage tracking
                    if (isStreaming) {
                        transformed.stream_options = { include_usage: true };
                    }
                    
                    transformedBody = JSON.stringify(transformed);
                } catch {
                    // Keep original body if parsing fails
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
                    body: transformedBody,
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
                return response;
            }

            // Transform response from Chat Completions format to Responses API format
            if (isStreaming) {
                // Transform streaming response
                return transformStreamingResponse(response);
            } else {
                // Transform non-streaming response
                return await transformNonStreamingResponse(response);
            }
        };
    };

    /**
     * Transform streaming response from Chat Completions to Responses API format
     */
    const transformStreamingResponse = (response: Response): Response => {
        if (!response.body) {
            return response;
        }

        const reader = response.body.getReader();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const responseId = `resp_${Date.now()}`;
        const outputItemId = `msg_${Date.now()}`;
        let sentCreated = false;
        let sentOutputItemAdded = false;
        let fullContent = '';
        let buffer = ''; // Buffer for incomplete SSE lines

        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        // Process any remaining buffer
                        if (buffer.trim()) {
                            processLine(buffer, controller);
                        }
                        
                        // Send completion events
                        const doneEvent = {
                            type: 'response.output_text.done',
                            item_id: outputItemId,
                            output_index: 0,
                            content_index: 0,
                            text: fullContent,
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneEvent)}\n\n`));

                        const outputDone = {
                            type: 'response.output_item.done',
                            output_index: 0,
                            item: {
                                type: 'message',
                                id: outputItemId,
                                role: 'assistant',
                                content: [{ type: 'output_text', text: fullContent }],
                            },
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(outputDone)}\n\n`));

                        const completed = {
                            type: 'response.completed',
                            response: {
                                id: responseId,
                                status: 'completed',
                                output: [{
                                    type: 'message',
                                    id: outputItemId,
                                    role: 'assistant',
                                    content: [{ type: 'output_text', text: fullContent }],
                                }],
                            },
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(completed)}\n\n`));
                        controller.close();
                        return;
                    }

                    const text = decoder.decode(value, { stream: true });
                    buffer += text;
                    
                    // Process complete lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    for (const line of lines) {
                        processLine(line, controller);
                    }
                } catch (error) {
                    controller.error(error);
                }
            },
        });

        function processLine(line: string, controller: ReadableStreamDefaultController) {
            if (!line.startsWith('data: ')) return;
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === '') return;

            try {
                const chunk = JSON.parse(data);
                const delta = chunk.choices?.[0]?.delta;
                const finishReason = chunk.choices?.[0]?.finish_reason;
                
                if (!delta && !finishReason) return;

                // Send initial events
                if (!sentCreated) {
                    const created = {
                        type: 'response.created',
                        response: { id: responseId, status: 'in_progress', output: [] },
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(created)}\n\n`));
                    sentCreated = true;
                }

                if (!sentOutputItemAdded && delta && (delta.content || delta.role)) {
                    const added = {
                        type: 'response.output_item.added',
                        output_index: 0,
                        item: { type: 'message', id: outputItemId, role: 'assistant', content: [] },
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(added)}\n\n`));
                    sentOutputItemAdded = true;
                }

                // Send content delta
                if (delta?.content) {
                    fullContent += delta.content;
                    const deltaEvent = {
                        type: 'response.output_text.delta',
                        item_id: outputItemId,
                        output_index: 0,
                        content_index: 0,
                        delta: delta.content,
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`));
                }
                
                // Handle tool calls
                if (delta?.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                        if (toolCall.function?.arguments) {
                            const funcDelta = {
                                type: 'response.function_call_arguments.delta',
                                item_id: outputItemId,
                                output_index: 0,
                                call_id: toolCall.id,
                                delta: toolCall.function.arguments,
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(funcDelta)}\n\n`));
                        }
                    }
                }
            } catch {
                // Skip malformed JSON
            }
        }

        return new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers({
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
            }),
        });
    };

    /**
     * Transform non-streaming response from Chat Completions to Responses API format
     */
    const transformNonStreamingResponse = async (response: Response): Promise<Response> => {
        const text = await response.text();
        
        try {
            const data = JSON.parse(text);
            const choice = data.choices?.[0];
            const message = choice?.message;
            
            if (!message) {
                return new Response(text, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                });
            }

            const responseId = `resp_${data.id || Date.now()}`;
            const outputItemId = `msg_${Date.now()}`;

            // Build output array
            const output: any[] = [];
            
            // Add message content
            if (message.content) {
                output.push({
                    type: 'message',
                    id: outputItemId,
                    role: 'assistant',
                    content: [{
                        type: 'output_text',
                        text: message.content,
                    }],
                });
            }
            
            // Add tool calls if present
            if (message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    output.push({
                        type: 'function_call',
                        id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                        call_id: toolCall.id,
                        name: toolCall.function?.name,
                        arguments: toolCall.function?.arguments || '{}',
                    });
                }
            }
            
            // If no output, add empty message
            if (output.length === 0) {
                output.push({
                    type: 'message',
                    id: outputItemId,
                    role: 'assistant',
                    content: [{ type: 'output_text', text: '' }],
                });
            }

            const transformed = {
                id: responseId,
                object: 'response',
                created_at: data.created || Math.floor(Date.now() / 1000),
                status: 'completed',
                output,
                usage: data.usage ? {
                    input_tokens: data.usage.prompt_tokens,
                    output_tokens: data.usage.completion_tokens,
                    total_tokens: data.usage.total_tokens,
                } : undefined,
            };

            return new Response(JSON.stringify(transformed), {
                status: response.status,
                statusText: response.statusText,
                headers: new Headers({
                    'content-type': 'application/json',
                }),
            });
        } catch {
            return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        }
    };

    // =========================================================================
    // Register Provider
    // =========================================================================

    const providerDisposable = providers.register({
        id: 'qwen',
        name: 'Qwen (Alibaba)',
        description: 'Access Qwen AI models via your Qwen account',
        authType: 'oauth',
        // Note: Not specifying sdkType - Qwen uses standard OpenAI Chat Completions format
        // which is different from the new OpenAI Responses API format

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
                    functionCalling: model.functionCalling ?? true, // All Qwen models support function calling
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
