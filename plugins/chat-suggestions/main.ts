import type { PluginContext, PluginActivation, Provider, Message } from 'alma-plugin-api';

/**
 * Extended Provider interface to include createChatCompletion
 * This assumes the runtime object has this method even if the public type doesn't expose it yet.
 */
interface RuntimeProvider extends Provider {
    id: string;
    createChatCompletion(request: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        stream?: boolean;
    }): Promise<{ content: string }>;
}

/**
 * Chat Suggestions Plugin
 *
 * This plugin generates chat suggestions based on the conversation context.
 * It listens for incoming messages and uses the AI to generate potential
 * user replies.
 */

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, settings, chat, providers, ui } = context;

    logger.info('Chat Suggestions plugin activated!');

    // Get current settings
    const getSettings = () => ({
        enabled: settings.get<boolean>('chatSuggestions.enabled', true),
    });

    // Subscribe to message received event
    const eventDisposable = events.on(
        'chat.message.didReceive',
        async (input) => {
            const config = getSettings();

            if (!config.enabled) {
                return;
            }

            try {
                // Get the thread history
                const messages = await chat.getMessages(input.threadId);
                
                // Prepare the prompt for generating suggestions
                const prompt = `
帮我写个新插件  可用生成聊天建议 我会在\`<content>\`块中提供一些聊天内容，包括用户和AI助手之间的对话。
你需要扮演**用户**来回复助手，生成3~5条恰当且符合上下文的回复。

规则：
1. 直接回复建议，不要添加任何格式，用换行分隔建议，无需添加Markdown列表格式。
2. 使用{locale}语言。
3. 确保每条建议都有效。
4. 每条建议不超过10个字符。
5. 模仿用户之前的对话风格。
6. 扮演用户，而非助手！ 这是我之前用过的提示词 ,作为聊天 建议的提示词使用

<content>
${messages.map((m: Message) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}
</content>
`.replace('{locale}', context.i18n.locale);

                // Find a suitable model (using the same one as the conversation or a default)
                const providerList = await providers.list();
                const provider = (providerList.find((p: Provider) => p.id === input.providerId) || providerList[0]) as RuntimeProvider;
                
                if (!provider) {
                    logger.warn('No provider available for generating suggestions');
                    return;
                }

                // Use the provider to generate suggestions
                // Note: We are casting to RuntimeProvider assuming the method exists at runtime
                if (typeof provider.createChatCompletion === 'function') {
                    const response = await provider.createChatCompletion({
                        model: input.model,
                        messages: [{ role: 'user', content: prompt }]
                    });

                    if (response && response.content) {
                        const suggestions = response.content.split('\n').filter(s => s.trim().length > 0);
                        logger.info('Generated suggestions:', suggestions);
                        
                        // Show suggestions in UI
                        if (suggestions.length > 0) {
                            ui.showNotification('Chat suggestions available', {
                                type: 'info',
                                action: {
                                    label: 'View',
                                    callback: async () => {
                                        const selected = await ui.showQuickPick(
                                            suggestions.map(s => ({ label: s, value: s })),
                                            { title: 'Select a reply to copy to clipboard' }
                                        );
                                        
                                        if (selected) {
                                            ui.showNotification(`Selected: ${selected}`, { type: 'success' });
                                        }
                                    }
                                }
                            });
                        }
                    }
                } else {
                    logger.warn(`Provider ${provider.id} does not support createChatCompletion`);
                }
                
            } catch (error) {
                logger.error('Error generating suggestions:', error);
            }
        }
    );

    return {
        dispose: () => {
            eventDisposable.dispose();
        }
    };
}
