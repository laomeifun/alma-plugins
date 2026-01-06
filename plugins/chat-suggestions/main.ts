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
                        
                        // Show suggestions in UI\n                        if (suggestions.length > 0) {\n                            // We use showQuickPick to display suggestions to the user\n                            // This allows the user to select one to send (conceptually)\n                            // Since we can't automatically populate the input box yet, we'll just show them.\n                            // If the user selects one, we could potentially copy it to clipboard or insert it if API allowed.\n                            // For now, we just show them.\n                            \n                            // Note: showQuickPick is async and might block if we await it, \n                            // but here we just want to show it. However, showing it immediately after a message might be intrusive.\n                            // A better UI would be a non-modal suggestion list, but we are limited to the current UI API.\n                            // Let's use a notification for the first one, or maybe a status bar item?\n                            // Actually, the user asked to "show in UI". \n                            // Let's try to use a status bar item to indicate suggestions are available,\n                            // or just show them in a QuickPick if the user runs a command.\n                            \n                            // But the requirement implies automatic display.\n                            // Let's use showNotification for now as it's the most visible non-blocking UI element we have access to\n                            // that doesn't require user initiation (like a command).\n                            // Alternatively, we can register a command "Show Suggestions" and trigger it, \n                            // but we can't trigger commands programmatically easily without a user action context usually.\n                            \n                            // Let's go with a "Show Suggestions" notification that has an action.\n                            ui.showNotification('Chat suggestions available', {\n                                type: 'info',\n                                action: {\n                                    label: 'View',\n                                    callback: async () => {\n                                        const selected = await ui.showQuickPick(\n                                            suggestions.map(s => ({ label: s, value: s })),\n                                            { title: 'Select a reply to copy to clipboard' }\n                                        );\n                                        \n                                        if (selected) {\n                                            // Ideally we would insert this into the chat input.\n                                            // Since we don't have an API for that, we'll just notify the user.\n                                            ui.showNotification(`Selected: ${selected}`, { type: 'success' });\n                                            // In a real app, we might write to clipboard here if we had access.\n                                        }\n                                    }\n                                }\n                            });\n                        }
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
