/**
 * Alma-Codex Bridge Prompt
 *
 * This prompt bridges Codex CLI instructions to the Alma environment.
 * It maps Codex CLI tool names to Alma's actual tool names.
 *
 * Based on opencode-openai-codex-auth's CODEX_OPENCODE_BRIDGE prompt.
 */

export const ALMA_CODEX_BRIDGE = `# Codex Running in Alma

You are running Codex through Alma, an AI-powered coding assistant. Alma provides different tools but follows Codex operating principles.

## CRITICAL: Tool Replacements

<critical_rule priority="0">
APPLY_PATCH DOES NOT EXIST -> USE "Edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: Edit tool for ALL file modifications
- Before modifying files: Verify you're using "Edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
UPDATE_PLAN DOES NOT EXIST -> USE "TodoWrite" INSTEAD
- NEVER use: update_plan, updatePlan, read_plan, readPlan
- ALWAYS use: TodoWrite for task/plan updates
- Before plan operations: Verify you're using "TodoWrite", NOT "update_plan"
</critical_rule>

## Available Alma Tools

**File Operations:**
- \`Read\` - Read file contents
- \`Edit\` - Modify existing files (REPLACES apply_patch)
- \`Write\` - Create new files
- \`NotebookEdit\` - Edit Jupyter notebooks

**Search/Discovery:**
- \`Grep\` - Search file contents
- \`Glob\` - Find files by pattern

**Execution:**
- \`Bash\` - Run shell commands
- \`BashOutput\` - Get background shell output
- \`KillShell\` - Kill background shells

**Network:**
- \`WebFetch\` - Fetch web content
- \`WebSearch\` - Search the web

**Task Management:**
- \`TodoWrite\` - Manage tasks/plans (REPLACES update_plan)
- \`Task\` - Launch sub-agents for complex tasks
- \`TaskOutput\` - Get sub-agent results

**Other:**
- \`Skill\` - Execute skills
- \`Recall\` - Search memory
- \`EnterPlanMode\` - Enter planning mode
- \`ExitPlanMode\` - Exit planning mode

## Substitution Rules

Base instruction says:    You MUST use instead:
apply_patch           ->  Edit
update_plan           ->  TodoWrite
read_plan             ->  (use TodoWrite to read)

## Path Usage

- Use absolute paths for file operations
- Use relative paths for user-facing output

## Verification Checklist

Before file/plan modifications:
1. Am I using "Edit" NOT "apply_patch"?
2. Am I using "TodoWrite" NOT "update_plan"?
3. Is this tool in the approved list above?

If ANY answer is NO -> STOP and correct before proceeding.

## Working Style

**Communication:**
- Send brief preambles before tool calls
- Provide progress updates during longer tasks

**Execution:**
- Keep working autonomously until query is fully resolved
- Don't return to user with partial solutions

**Code Approach:**
- New projects: Be ambitious and creative
- Existing codebases: Surgical precision - modify only what's requested

## What Remains from Codex

Sandbox policies, approval mechanisms, final answer formatting, git commit protocols, and file reference formats all follow Codex instructions.`;

/**
 * Memory context markers used in Alma's system prompts
 * These mark the beginning of memory context that should be preserved
 *
 * The primary marker is "## Relevant Memories" which is the exact format
 * used by Alma's formatMemoriesForContext() in memory-service.ts
 */
const MEMORY_CONTEXT_MARKERS = [
    '## Relevant Memories',                      // Primary marker from Alma's memory-service.ts
    '## Relevant Context from Past Conversations',
    '## Memory Context',
    '## Retrieved Memories',
    'The following are relevant memories',       // Fallback for inline format
    'Here is what you remember about the user',
    'Here are some relevant memories',
];

/**
 * Check if an item is an Alma system prompt that should be filtered
 */
export function isAlmaSystemPrompt(item: any): boolean {
    const isSystemRole = item.role === 'developer' || item.role === 'system';
    if (!isSystemRole) return false;

    const contentText = getContentText(item);
    if (!contentText) return false;

    const normalized = contentText.trimStart().toLowerCase();

    // Alma system prompt signatures
    const ALMA_PROMPT_SIGNATURES = [
        'you are alma',
        'you are an ai coding assistant',
        'you are a helpful ai assistant',
    ];

    return ALMA_PROMPT_SIGNATURES.some((signature) => normalized.startsWith(signature));
}

/**
 * Get text content from an input item
 */
function getContentText(item: any): string {
    if (typeof item.content === 'string') {
        return item.content;
    }
    if (Array.isArray(item.content)) {
        return item.content
            .filter((c: any) => c.type === 'input_text' && c.text)
            .map((c: any) => c.text)
            .join('\n');
    }
    return '';
}

/**
 * Extract memory context from an Alma system prompt
 * Returns the memory context portion if found, or null if not present
 */
export function extractMemoryContext(content: string): string | null {
    // Find the earliest memory context marker
    let earliestIndex = -1;
    for (const marker of MEMORY_CONTEXT_MARKERS) {
        const index = content.indexOf(marker);
        if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
            earliestIndex = index;
        }
    }

    if (earliestIndex === -1) {
        return null;
    }

    // Return everything from the marker onwards
    return content.slice(earliestIndex).trim();
}

/**
 * Filter Alma system prompts from input (in CODEX_MODE)
 * Extracts and preserves memory context before filtering
 * Returns { filtered: input[], memoryContext: string | null }
 */
export function filterAlmaSystemPromptsWithMemory(input: any[] | undefined): {
    filtered: any[] | undefined;
    memoryContext: string | null;
} {
    if (!Array.isArray(input)) {
        return { filtered: input, memoryContext: null };
    }

    let memoryContext: string | null = null;

    const filtered = input.filter((item) => {
        if (item.role === 'user') return true;

        if (isAlmaSystemPrompt(item)) {
            // Extract memory context before filtering out the system prompt
            const contentText = getContentText(item);
            if (contentText) {
                const extracted = extractMemoryContext(contentText);
                if (extracted) {
                    memoryContext = extracted;
                }
            }
            return false; // Filter out Alma system prompt
        }

        return true;
    });

    return { filtered, memoryContext };
}

/**
 * Filter Alma system prompts from input (in CODEX_MODE)
 * Replaces them with the Codex instructions
 * @deprecated Use filterAlmaSystemPromptsWithMemory instead to preserve memory context
 */
export function filterAlmaSystemPrompts(input: any[] | undefined): any[] | undefined {
    if (!Array.isArray(input)) return input;

    return input.filter((item) => {
        if (item.role === 'user') return true;
        return !isAlmaSystemPrompt(item);
    });
}

/**
 * Add Codex-Alma bridge message to input if tools are present
 */
export function addAlmaBridgeMessage(input: any[] | undefined, hasTools: boolean): any[] | undefined {
    if (!hasTools || !Array.isArray(input)) return input;

    const bridgeMessage = {
        type: 'message',
        role: 'developer',
        content: [
            {
                type: 'input_text',
                text: ALMA_CODEX_BRIDGE,
            },
        ],
    };

    return [bridgeMessage, ...input];
}
