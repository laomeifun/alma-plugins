import type { PluginContext, PluginActivation } from 'alma-plugin-api';

/**
 * Tool Monitor Plugin
 *
 * Monitors and tracks all tool executions with detailed statistics:
 * - Execution count per tool
 * - Success/failure rates
 * - Average execution time
 * - Real-time status bar display
 */

interface ToolStats {
    calls: number;
    successes: number;
    failures: number;
    totalTime: number;
    lastCall?: number;
    lastError?: string;
}

interface ExecutionRecord {
    tool: string;
    timestamp: number;
    duration: number;
    success: boolean;
    error?: string;
}

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, ui, commands, settings } = context;

    logger.info('Tool Monitor plugin activated!');

    // Statistics storage
    const toolStats = new Map<string, ToolStats>();
    const recentExecutions: ExecutionRecord[] = [];
    const MAX_RECENT = 100;

    // Status bar item
    const statusItem = ui.createStatusBarItem({
        id: 'tool-monitor',
        alignment: 'right',
        priority: 50,
    });

    // Get settings
    const getSettings = () => ({
        showInStatusBar: settings.get<boolean>('toolMonitor.showInStatusBar', true),
        logToConsole: settings.get<boolean>('toolMonitor.logToConsole', true),
    });

    // Get or create stats for a tool
    const getStats = (tool: string): ToolStats => {
        if (!toolStats.has(tool)) {
            toolStats.set(tool, {
                calls: 0,
                successes: 0,
                failures: 0,
                totalTime: 0,
            });
        }
        return toolStats.get(tool)!;
    };

    // Calculate totals
    const getTotals = () => {
        let totalCalls = 0;
        let totalSuccesses = 0;
        let totalFailures = 0;
        let totalTime = 0;

        for (const stats of toolStats.values()) {
            totalCalls += stats.calls;
            totalSuccesses += stats.successes;
            totalFailures += stats.failures;
            totalTime += stats.totalTime;
        }

        return { totalCalls, totalSuccesses, totalFailures, totalTime };
    };

    // Update status bar
    const updateStatusBar = () => {
        const { showInStatusBar } = getSettings();

        if (!showInStatusBar) {
            statusItem.hide();
            return;
        }

        const { totalCalls, totalFailures } = getTotals();

        if (totalCalls === 0) {
            statusItem.text = 'Tools: 0';
            statusItem.tooltip = 'No tools executed yet\nClick for details';
        } else {
            const failureIndicator = totalFailures > 0 ? ` (${totalFailures} failed)` : '';
            statusItem.text = `Tools: ${totalCalls}${failureIndicator}`;

            // Build tooltip
            const lines = ['Tool Execution Summary', ''];

            const sortedTools = Array.from(toolStats.entries())
                .sort((a, b) => b[1].calls - a[1].calls)
                .slice(0, 5);

            for (const [tool, stats] of sortedTools) {
                const avgTime = stats.calls > 0 ? stats.totalTime / stats.calls : 0;
                const successRate = stats.calls > 0
                    ? ((stats.successes / stats.calls) * 100).toFixed(0)
                    : '0';
                lines.push(`${tool}: ${stats.calls} calls, ${successRate}% success, ${avgTime.toFixed(0)}ms avg`);
            }

            if (toolStats.size > 5) {
                lines.push(`... and ${toolStats.size - 5} more tools`);
            }

            lines.push('', 'Click for full statistics');
            statusItem.tooltip = lines.join('\n');
        }

        statusItem.show();
    };

    // Format duration
    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    // Track tool execution start
    const willExecuteDisposable = events.on('tool.willExecute', (input) => {
        const { logToConsole } = getSettings();

        if (logToConsole) {
            logger.info(`[Tool] Starting: ${input.tool}`, {
                args: input.args,
                thread: input.context.threadId,
            });
        }
    });

    // Track tool execution completion
    const didExecuteDisposable = events.on('tool.didExecute', (input) => {
        const { logToConsole } = getSettings();
        const stats = getStats(input.tool);

        stats.calls++;
        stats.successes++;
        stats.totalTime += input.duration;
        stats.lastCall = Date.now();

        // Record execution
        recentExecutions.push({
            tool: input.tool,
            timestamp: Date.now(),
            duration: input.duration,
            success: true,
        });

        // Trim old records
        while (recentExecutions.length > MAX_RECENT) {
            recentExecutions.shift();
        }

        if (logToConsole) {
            logger.info(`[Tool] Completed: ${input.tool} (${formatDuration(input.duration)})`);
        }

        updateStatusBar();
    });

    // Track tool errors
    const onErrorDisposable = events.on('tool.onError', (input, output) => {
        const { logToConsole } = getSettings();
        const stats = getStats(input.tool);

        stats.calls++;
        stats.failures++;
        stats.totalTime += input.duration;
        stats.lastCall = Date.now();
        stats.lastError = input.error.message;

        // Record execution
        recentExecutions.push({
            tool: input.tool,
            timestamp: Date.now(),
            duration: input.duration,
            success: false,
            error: input.error.message,
        });

        // Trim old records
        while (recentExecutions.length > MAX_RECENT) {
            recentExecutions.shift();
        }

        if (logToConsole) {
            logger.error(`[Tool] Failed: ${input.tool} (${formatDuration(input.duration)})`, {
                error: input.error.message,
            });
        }

        // Show notification for failures
        ui.showWarning(`Tool "${input.tool}" failed: ${input.error.message}`);

        updateStatusBar();
    });

    // Command: Show detailed statistics
    const showStatsDisposable = commands.register('toolMonitor.showStats', async () => {
        const { totalCalls, totalSuccesses, totalFailures, totalTime } = getTotals();

        if (totalCalls === 0) {
            ui.showNotification('No tools have been executed yet.', { type: 'info' });
            return;
        }

        const avgTime = totalCalls > 0 ? totalTime / totalCalls : 0;
        const successRate = totalCalls > 0
            ? ((totalSuccesses / totalCalls) * 100).toFixed(1)
            : '0.0';

        const lines = [
            '═══ Tool Monitor Statistics ═══',
            '',
            `Total Executions: ${totalCalls}`,
            `Successful: ${totalSuccesses} (${successRate}%)`,
            `Failed: ${totalFailures}`,
            `Total Time: ${formatDuration(totalTime)}`,
            `Average Time: ${formatDuration(avgTime)}`,
            '',
            '─── Per-Tool Breakdown ───',
            '',
        ];

        const sortedTools = Array.from(toolStats.entries())
            .sort((a, b) => b[1].calls - a[1].calls);

        for (const [tool, stats] of sortedTools) {
            const toolAvgTime = stats.calls > 0 ? stats.totalTime / stats.calls : 0;
            const toolSuccessRate = stats.calls > 0
                ? ((stats.successes / stats.calls) * 100).toFixed(0)
                : '0';

            lines.push(`${tool}:`);
            lines.push(`  Calls: ${stats.calls} | Success: ${toolSuccessRate}% | Avg: ${formatDuration(toolAvgTime)}`);

            if (stats.lastError) {
                lines.push(`  Last error: ${stats.lastError.slice(0, 50)}${stats.lastError.length > 50 ? '...' : ''}`);
            }
        }

        // Show recent failures
        const recentFailures = recentExecutions
            .filter(r => !r.success)
            .slice(-5);

        if (recentFailures.length > 0) {
            lines.push('', '─── Recent Failures ───', '');
            for (const record of recentFailures) {
                const time = new Date(record.timestamp).toLocaleTimeString();
                lines.push(`[${time}] ${record.tool}: ${record.error?.slice(0, 40) || 'Unknown error'}`);
            }
        }

        // Use quick pick to show options
        const action = await ui.showQuickPick([
            {
                label: 'View Full Report',
                description: `${totalCalls} executions tracked`,
                value: 'view'
            },
            {
                label: 'Reset Statistics',
                description: 'Clear all tracked data',
                value: 'reset'
            },
            {
                label: 'Close',
                value: 'close'
            },
        ], { title: 'Tool Monitor' });

        if (action === 'view') {
            // Show detailed notification
            ui.showNotification(lines.join('\n'), { duration: 0 });
        } else if (action === 'reset') {
            await commands.execute('toolMonitor.reset');
        }
    });

    // Command: Reset statistics
    const resetDisposable = commands.register('toolMonitor.reset', async () => {
        const confirmed = await ui.showConfirmDialog(
            'Reset all tool statistics?',
            { type: 'warning', confirmLabel: 'Reset' }
        );

        if (confirmed) {
            toolStats.clear();
            recentExecutions.length = 0;
            updateStatusBar();
            ui.showNotification('Tool statistics reset', { type: 'success' });
            logger.info('Tool statistics reset');
        }
    });

    // Listen for settings changes
    const settingsDisposable = settings.onDidChange(() => {
        updateStatusBar();
    });

    // Set up status bar click handler
    statusItem.command = 'toolMonitor.showStats';

    // Initialize
    updateStatusBar();

    return {
        dispose: () => {
            logger.info('Tool Monitor plugin deactivated');
            willExecuteDisposable.dispose();
            didExecuteDisposable.dispose();
            onErrorDisposable.dispose();
            showStatsDisposable.dispose();
            resetDisposable.dispose();
            settingsDisposable.dispose();
            statusItem.dispose();
        },
    };
}
