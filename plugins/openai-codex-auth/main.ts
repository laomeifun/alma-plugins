/**
 * OpenAI Codex Auth Plugin for Alma
 *
 * Enables using ChatGPT Plus/Pro subscription to access OpenAI Codex models
 * via OAuth authentication. This plugin registers a custom provider that
 * handles authentication and API calls to the ChatGPT Codex backend.
 *
 * DISCLAIMER: This plugin is for personal development use only with your
 * own ChatGPT subscription. Not for commercial resale or multi-user services.
 */

import type { PluginContext, PluginActivation } from 'alma-plugin-api';
import { TokenStore } from './lib/token-store';
import { CodexClient } from './lib/codex-api';
import { getAuthorizationUrl, exchangeCodeForTokens } from './lib/auth';
import { CODEX_MODELS } from './lib/models';

// ============================================================================
// Plugin Activation
// ============================================================================

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, storage, providers, commands, ui } = context;

    logger.info('OpenAI Codex Auth plugin activating...');

    // Initialize token store
    const tokenStore = new TokenStore(storage.secrets, logger);
    await tokenStore.initialize();

    // Initialize Codex API client
    const codexClient = new CodexClient(tokenStore, logger);

    // =========================================================================
    // Register Provider
    // =========================================================================

    const providerDisposable = providers.register({
        id: 'openai-codex',
        name: 'OpenAI Codex (ChatGPT)',
        description: 'Access GPT-5.2 Codex and other models via your ChatGPT subscription',
        authType: 'oauth',

        async initialize(initContext) {
            logger.info('Codex provider initialized');
        },

        async isAuthenticated() {
            return tokenStore.hasValidToken();
        },

        async authenticate() {
            try {
                // Generate authorization URL
                const { url, verifier, state } = await getAuthorizationUrl();

                // Store verifier and state for code exchange
                await tokenStore.storePendingVerifier(verifier);
                await tokenStore.storePendingState(state);

                // Show instructions to user
                ui.showNotification(
                    'Opening browser for ChatGPT login. After logging in, copy the authorization code and paste it here.',
                    { type: 'info', duration: 10000 }
                );

                // Open browser (this requires shell:execute permission or system:openExternal)
                // For now, we'll show the URL and ask user to open it manually
                logger.info(`Authorization URL: ${url}`);

                // Ask user for the authorization code
                const code = await ui.showInputBox({
                    title: 'ChatGPT Authorization',
                    prompt: 'Please open this URL in your browser, log in to ChatGPT, then paste the authorization code here:',
                    placeholder: 'Paste authorization code here...',
                });

                if (!code) {
                    await tokenStore.clearPendingState();
                    return { success: false, error: 'Authorization cancelled' };
                }

                // Exchange code for tokens
                const pendingVerifier = await tokenStore.getPendingVerifier();
                if (!pendingVerifier) {
                    return { success: false, error: 'No pending authorization. Please try again.' };
                }

                const tokens = await exchangeCodeForTokens(code, pendingVerifier);
                await tokenStore.saveTokens(tokens);
                await tokenStore.clearPendingState();

                ui.showNotification('Successfully connected to ChatGPT!', { type: 'success' });
                logger.info('Codex authentication successful');

                return { success: true };
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Authentication failed';
                logger.error('Codex authentication error:', error);
                ui.showError(`Authentication failed: ${message}`);
                return { success: false, error: message };
            }
        },

        async logout() {
            await tokenStore.clearTokens();
            ui.showNotification('Logged out from ChatGPT', { type: 'info' });
            logger.info('Codex logout successful');
        },

        async getModels() {
            // Return all supported models
            return CODEX_MODELS.map(model => ({
                id: model.id,
                name: model.name,
                description: model.description,
                contextWindow: model.contextWindow,
                maxOutputTokens: model.maxOutputTokens,
                capabilities: {
                    streaming: true,
                    reasoning: model.reasoning !== 'none',
                },
                providerOptions: {
                    reasoning: model.reasoning,
                    baseModel: model.baseModel,
                },
            }));
        },

        async createChatCompletion(request) {
            return codexClient.createChatCompletion(request);
        },
    });

    // =========================================================================
    // Register Commands
    // =========================================================================

    const loginCommand = commands.register('login', async () => {
        const provider = await providers.get('openai-codex');
        if (!provider) {
            ui.showError('Codex provider not found');
            return;
        }

        // Trigger authentication
        const isAuth = await providerDisposable; // This won't work directly, need to access the registered provider
        // For now, just show a message
        ui.showNotification('Use the provider settings to connect to ChatGPT', { type: 'info' });
    });

    const logoutCommand = commands.register('logout', async () => {
        await tokenStore.clearTokens();
        ui.showNotification('Logged out from ChatGPT', { type: 'info' });
    });

    const statusCommand = commands.register('status', async () => {
        const isAuth = tokenStore.hasValidToken();
        const accountId = tokenStore.getAccountId();

        if (isAuth) {
            ui.showNotification(`Connected to ChatGPT (Account: ${accountId?.slice(0, 8)}...)`, { type: 'success' });
        } else {
            ui.showNotification('Not connected to ChatGPT', { type: 'warning' });
        }
    });

    logger.info('OpenAI Codex Auth plugin activated');

    // =========================================================================
    // Cleanup
    // =========================================================================

    return {
        dispose: () => {
            providerDisposable.dispose();
            loginCommand.dispose();
            logoutCommand.dispose();
            statusCommand.dispose();
            logger.info('OpenAI Codex Auth plugin deactivated');
        },
    };
}
