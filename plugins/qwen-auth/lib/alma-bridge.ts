/**
 * Alma Bridge Prompt for Qwen
 *
 * This prompt aligns Qwen tool usage with Alma's runtime conventions.
 */

export const ALMA_QWEN_BRIDGE = `# Qwen Running in Alma

You are running in Alma on Windows. The terminal tool executes PowerShell.

## CRITICAL: Use Alma Tool Names

- Use the provided tool names exactly as defined by the system (from the tools list).
- Do not invent tool names or omit required tools.
- If you need to modify files: DO NOT use "apply_patch" -> use the "Edit" tool instead.
- If you need to manage task plans: DO NOT use "update_plan" -> use the "TodoWrite" tool instead.

## Tool Guidance

- If you need to list files, use PowerShell commands like:
  - Get-ChildItem
  - dir
- Do NOT use: ls -la (PowerShell does not support -la)
`;

export function addAlmaBridgeMessage(input: any[] | undefined, hasTools: boolean): any[] | undefined {
    if (!hasTools || !Array.isArray(input)) return input;

    const bridgeMessage = {
        type: 'message',
        role: 'developer',
        content: [
            {
                type: 'text',
                text: ALMA_QWEN_BRIDGE,
            },
        ],
    };

    return [bridgeMessage, ...input];
}
