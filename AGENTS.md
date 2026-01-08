# AGENTS.md - AI Assistant Guide for alma-plugins

## Project Overview

This is the **Alma Plugins** repository - a collection of plugins for the [Alma](https://alma.now) AI coding assistant. It contains:
- **Plugin API** (`packages/plugin-api/`) - TypeScript type definitions for plugin development
- **Example Plugins** (`plugins/`) - Reference implementations for various plugin types
- **CLIProxyAPI** (`data/CLIProxyAPI/`) - Go-based API proxy for OAuth providers (Qwen, Codex, Antigravity, etc.)

## Architecture

### Plugin System
```
plugins/
├── {plugin-name}/
│   ├── manifest.json    # Plugin metadata, type, permissions
│   ├── main.ts          # Entry point: export activate(context: PluginContext)
│   └── lib/             # Supporting modules (auth, models, etc.)
```

**Plugin Types**: `tool`, `ui`, `theme`, `provider`, `transform`, `integration`, `composite`

### Auth Provider Plugins Pattern
Auth plugins (`antigravity-auth`, `openai-codex-auth`, `qwen-auth`) follow a consistent pattern:
1. **TokenStore** (`lib/token-store.ts`) - Manages OAuth tokens with SecretStorage
2. **Auth** (`lib/auth.ts`) - OAuth flow implementation (Device Flow or Authorization Code)
3. **Models** (`lib/models.ts`) - Model definitions and mappings
4. **Request Transform** - Convert between API formats (OpenAI Responses API ↔ Chat Completions)

### CLIProxyAPI Translators
Located in `data/CLIProxyAPI/internal/translator/`, these Go modules handle API format translation:
- `openai/claude/` - OpenAI → Claude format
- `claude/openai/` - Claude → OpenAI format
- `gemini/openai/` - Gemini → OpenAI format
- `codex/claude/` - Codex → Claude format

## Critical Patterns

### OpenAI Responses API Streaming Events
When implementing streaming responses for tool calls, emit events in this order:
```typescript
// 1. Announce tool call
{ type: 'response.output_item.added', item: { type: 'function_call', ... } }

// 2. Stream arguments
{ type: 'response.function_call_arguments.delta', delta: '{"path":' }

// 3. CRITICAL: Finalize arguments (often missed!)
{ type: 'response.function_call_arguments.done', arguments: '{"path":".", "pattern":"*"}' }

// 4. Complete item
{ type: 'response.output_item.done', item: { type: 'function_call', arguments: '...' } }
```

**Common Bug**: Missing `response.function_call_arguments.done` causes tool calls to have parameters but no return value.

### Token/Auth Management
```typescript
// TokenStore pattern (see plugins/qwen-auth/lib/token-store.ts)
class TokenStore {
    constructor(secrets: SecretStorage, logger: Logger) { ... }
    async getValidAccessToken(): Promise<string>  // Auto-refresh if expired
    async forceRefreshToken(): Promise<void>
    hasValidToken(): boolean
}
```

### Request Body Transformation
Auth plugins must transform between formats:
- **Input**: OpenAI Responses API format (`input[]` array with `type: 'message'`, `type: 'function_call'`)
- **Output**: Provider-specific format (Chat Completions `messages[]` for Qwen, Gemini format for Antigravity)

Key transformations in `qwen-auth/main.ts`:
- `input_text`/`output_text` → `text` type
- `function_call_output` → `tool` role message
- `function_call` → `assistant` with `tool_calls[]`

## Key Files

| File | Purpose |
|------|---------|
| `packages/plugin-api/src/index.ts` | All TypeScript types for plugin development |
| `plugins/*/manifest.json` | Plugin metadata, permissions, activation events |
| `plugins/*/lib/token-store.ts` | OAuth token management pattern |
| `data/CLIProxyAPI/internal/translator/*/` | API format translation (Go) |
| `registry.json` | Plugin registry for distribution |

## Development Commands

```bash
# No build step for plugins - Alma loads TypeScript directly
# CLIProxyAPI (Go):
cd data/CLIProxyAPI
go build ./cmd/server
go test ./...
```

## Common Issues & Fixes

1. **Tool calls with no return**: Check `response.function_call_arguments.done` event is emitted
2. **Empty arguments**: Default to `'{}'` not `''` for JSON parsing
3. **Orphaned tool outputs**: Use `normalizeOrphanedToolOutputs()` to convert to user messages
4. **Rate limiting**: Implement token refresh on 401, respect `retry-after` header on 429
