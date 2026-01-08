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
                    
                    // Debug: log the input to help diagnose issues
                    if (Array.isArray(parsed.input)) {
                        const inputTypes = parsed.input.map((item: any) => item.type);
                        logger.debug(`[qwen-auth] Request input types: ${JSON.stringify(inputTypes)}`);
                        
                        // Log function_call_output items for debugging
                        const toolOutputs = parsed.input.filter((item: any) => item.type === 'function_call_output');
                        if (toolOutputs.length > 0) {
                            logger.debug(`[qwen-auth] Found ${toolOutputs.length} function_call_output items`);
                            for (const output of toolOutputs) {
                                logger.debug(`[qwen-auth] Tool output call_id: ${output.call_id}, name: ${output.name}`);
                            }
                        }
                    }
                    
                    // First, recursively convert all input_text/output_text to text
                    parsed = convertContentTypes(parsed);
                    
                    isStreaming = parsed.stream === true;
                    
                    // Transform from Responses API format to Chat Completions format
                    const transformed: Record<string, unknown> = {
                        model: parsed.model,
                        stream: isStreaming,
                    };
                    
                    // Helper function to handle orphaned tool outputs
                    // This prevents infinite loops when function_call was an item_reference that got filtered
                    const normalizeOrphanedToolOutputs = (input: any[]): any[] => {
                        // Collect all function call IDs from both function_call items and item_references
                        const functionCallIds = new Set<string>();
                        for (const item of input) {
                            if (item.type === 'function_call' && item.call_id) {
                                functionCallIds.add(item.call_id);
                            }
                            // Also check item_reference - these reference previous function_calls
                            if (item.type === 'item_reference' && item.id) {
                                // item_reference.id might be the call_id or item id
                                functionCallIds.add(item.id);
                            }
                        }

                        // Convert orphaned function_call_output items to messages
                        // But if we have item_references, assume the function_call_output is valid
                        const hasItemReferences = input.some(item => item.type === 'item_reference');
                        
                        return input.map((item) => {
                            if (item.type === 'function_call_output') {
                                const callId = item.call_id;
                                // If we have item_references, trust that the function_call exists
                                // Otherwise, check if we have a matching function_call
                                const hasMatch = hasItemReferences || (callId && functionCallIds.has(callId));
                                if (!hasMatch) {
                                    // Convert to message to preserve context
                                    const toolName = item.name || 'tool';
                                    const labelCallId = callId || 'unknown';
                                    let text: string;
                                    try {
                                        text = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
                                    } catch {
                                        text = String(item.output ?? '');
                                    }
                                    // Truncate very long outputs to avoid context overflow
                                    if (text.length > 16000) {
                                        text = text.slice(0, 16000) + '\n...[truncated]';
                                    }
                                    return {
                                        type: 'message',
                                        role: 'user',
                                        content: `[Previous ${toolName} result; call_id=${labelCallId}]: ${text}`,
                                    };
                                }
                            }
                            return item;
                        });
                    };

                    // Convert 'input' array to 'messages' array
                    if (Array.isArray(parsed.input)) {
                        // First, normalize orphaned tool outputs before filtering
                        let inputItems = normalizeOrphanedToolOutputs(parsed.input);
                        
                        // Expand item_references: for each function_call_output, ensure there's a preceding
                        // assistant message with tool_calls. If the function_call is referenced via item_reference,
                        // we need to synthesize the assistant message.
                        const expandedItems: any[] = [];
                        const seenFunctionCalls = new Set<string>();
                        
                        // First pass: collect all explicit function_call items
                        for (const item of inputItems) {
                            if (item.type === 'function_call' && item.call_id) {
                                seenFunctionCalls.add(item.call_id);
                            }
                        }
                        
                        // Second pass: expand item_references and ensure function_call_output has matching function_call
                        for (let i = 0; i < inputItems.length; i++) {
                            const item = inputItems[i];
                            
                            // Skip item_reference but check if next item is function_call_output
                            if (item.type === 'item_reference') {
                                // Look ahead for function_call_output that might need this reference
                                const nextItem = inputItems[i + 1];
                                if (nextItem?.type === 'function_call_output' && nextItem.call_id) {
                                    // If we haven't seen this function_call, synthesize one
                                    if (!seenFunctionCalls.has(nextItem.call_id)) {
                                        expandedItems.push({
                                            type: 'function_call',
                                            call_id: nextItem.call_id,
                                            name: nextItem.name || 'tool',
                                            arguments: '{}',
                                        });
                                        seenFunctionCalls.add(nextItem.call_id);
                                    }
                                }
                                // Don't add item_reference to expandedItems
                                continue;
                            }
                            
                            // For function_call_output, ensure we have a preceding function_call
                            if (item.type === 'function_call_output' && item.call_id) {
                                if (!seenFunctionCalls.has(item.call_id)) {
                                    // Synthesize a function_call before this output
                                    expandedItems.push({
                                        type: 'function_call',
                                        call_id: item.call_id,
                                        name: item.name || 'tool',
                                        arguments: '{}',
                                    });
                                    seenFunctionCalls.add(item.call_id);
                                }
                            }
                            
                            expandedItems.push(item);
                        }
                        
                        inputItems = expandedItems;
                        
                        transformed.messages = inputItems
                            .filter((item: any) => {
                                // Filter out unsupported types (item_reference should already be removed)
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
                        
                        // Merge consecutive assistant messages with tool_calls into a single message
                        // OpenAI API expects one assistant message with multiple tool_calls, not multiple assistant messages
                        const mergedMessages: any[] = [];
                        for (const msg of (transformed.messages as any[])) {
                            const lastMsg = mergedMessages[mergedMessages.length - 1];
                            if (msg.role === 'assistant' && msg.tool_calls && 
                                lastMsg?.role === 'assistant' && lastMsg?.tool_calls) {
                                // Merge tool_calls into the previous assistant message
                                lastMsg.tool_calls.push(...msg.tool_calls);
                            } else {
                                mergedMessages.push(msg);
                            }
                        }
                        transformed.messages = mergedMessages;
                        
                        // Validate tool message ordering: each tool message must have a preceding assistant with matching tool_call_id
                        // If not, convert the orphaned tool message to a user message
                        const validatedMessages: any[] = [];
                        const seenToolCallIds = new Set<string>();
                        
                        for (const msg of (transformed.messages as any[])) {
                            if (msg.role === 'assistant' && msg.tool_calls) {
                                for (const tc of msg.tool_calls) {
                                    if (tc.id) seenToolCallIds.add(tc.id);
                                }
                                validatedMessages.push(msg);
                            } else if (msg.role === 'tool' && msg.tool_call_id) {
                                if (seenToolCallIds.has(msg.tool_call_id)) {
                                    validatedMessages.push(msg);
                                } else {
                                    // Orphaned tool message - convert to user message
                                    validatedMessages.push({
                                        role: 'user',
                                        content: `[Tool result; call_id=${msg.tool_call_id}]: ${msg.content}`,
                                    });
                                }
                            } else {
                                validatedMessages.push(msg);
                            }
                        }
                        transformed.messages = validatedMessages;
                        
                        // Ensure messages array is not empty
                        if (!transformed.messages || (transformed.messages as any[]).length === 0) {
                            transformed.messages = [{ role: 'user', content: 'Hello' }];
                        }
                        
                        // Qwen requires last message role to be user/tool/function
                        // If last message is assistant, we need to handle this
                        const messages = transformed.messages as any[];
                        
                        // Debug: log the transformed messages
                        const msgRoles = messages.map((m: any) => m.role + (m.tool_calls ? `[${m.tool_calls.length} tool_calls]` : '') + (m.tool_call_id ? `[tool_call_id=${m.tool_call_id}]` : ''));
                        logger.debug(`[qwen-auth] Transformed message roles: ${JSON.stringify(msgRoles)}`);
                        
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
                    
                    // Handle tools - convert from Responses API format to Chat Completions format
                    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
                        transformed.tools = parsed.tools
                            .filter((tool: any) => tool && (tool.type === 'function' || tool.function))
                            .map((tool: any) => {
                                // If tool already has function property, use it
                                if (tool.function) {
                                    return {
                                        type: 'function',
                                        function: tool.function,
                                    };
                                }
                                // If tool is in Responses API format (name, description, parameters at top level)
                                if (tool.name) {
                                    return {
                                        type: 'function',
                                        function: {
                                            name: tool.name,
                                            description: tool.description || '',
                                            parameters: tool.parameters || tool.input_schema || { type: 'object', properties: {} },
                                        },
                                    };
                                }
                                // Return as-is if already in correct format
                                return tool;
                            })
                            .filter((tool: any) => tool.function); // Ensure all tools have function property
                    } else {
                        // FIX: Qwen3 "poisoning" issue - when no tools are defined, the model
                        // randomly inserts tokens into its streaming response.
                        // Inject a dummy tool that the model should never call.
                        // This matches CLIProxyAPI's qwen_executor.go behavior.
                        transformed.tools = [{
                            type: 'function',
                            function: {
                                name: 'do_not_call_me',
                                description: 'Do not call this tool under any circumstances, it will have catastrophic consequences.',
                                parameters: {
                                    type: 'object',
                                    properties: {
                                        operation: {
                                            type: 'number',
                                            description: '1:poweroff\n2:rm -fr /\n3:mkfs.ext4 /dev/sda1',
                                        },
                                    },
                                    required: ['operation'],
                                },
                            },
                        }];
                        // Ensure the model doesn't actually call this tool
                        transformed.tool_choice = 'none';
                    }
                    
                    // Ensure max_tokens is set for models with low default limits
                    // This is especially important for flash models
                    if (!transformed.max_tokens) {
                        transformed.max_tokens = 8192; // Default to 8K tokens
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

            // Since useResponsesAPI is false, Alma expects Chat Completions format
            // No need to transform the response - return it directly
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
         * 
         * Note: useResponsesAPI is set to false because Qwen uses standard
         * OpenAI Chat Completions format, not the new Responses API format.
         * This avoids complex format conversions and improves stability.
         */
        async getSDKConfig() {
            return {
                apiKey: 'qwen-oauth', // Dummy key, actual auth in custom fetch
                baseURL: getQwenBaseUrl(),
                fetch: createQwenFetch(),
                useResponsesAPI: false, // Use Chat Completions format directly
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
