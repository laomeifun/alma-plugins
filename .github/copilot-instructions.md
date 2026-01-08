# Alma Plugins Development Guide

This repository contains official and example plugins for [Alma](https://alma.now), an AI-powered coding assistant.

## Project Structure

- `plugins/`: Contains individual plugin directories.
  - `qwen-auth/`: Qwen (Alibaba) authentication and provider plugin.
  - `openai-codex-auth/`: OpenAI Codex authentication and provider plugin.
  - `antigravity-auth/`: Antigravity authentication plugin.
  - `hello-world/`: Example tool plugin.
  - `token-counter/`: Example UI plugin.
  - `catppuccin-theme/`: Example theme plugin.
  - `prompt-enhancer/`: Example transform plugin.
- `packages/`: Shared packages.
  - `plugin-api/`: TypeScript type definitions for Alma plugins.
- `data/`: Backend services and data (CLIProxyAPI).

## Plugin Architecture

Alma plugins are TypeScript-based and run within the Alma environment.

### Key Components

1.  **Manifest (`manifest.json`)**: Defines plugin metadata, permissions, activation events, and contributions (tools, commands, providers).
2.  **Entry Point (`main.ts`)**: The `activate` function initializes the plugin, registers resources, and returns a `dispose` method.
3.  **Context (`PluginContext`)**: Passed to `activate`, providing access to Alma APIs (`logger`, `tools`, `commands`, `ui`, `storage`, `providers`, etc.).

### Common Patterns

-   **Authentication**:
    -   Use `authType: 'oauth'` in provider registration.
    -   Implement OAuth Device Flow (RFC 8628) for CLI-like authentication.
    -   Store tokens securely using `storage.secrets`.
    -   Implement auto-refresh logic for tokens.
-   **Providers**:
    -   Register using `providers.register`.
    -   Implement `authenticate`, `isAuthenticated`, `getModels`, and `getSDKConfig`.
    -   `getSDKConfig` should return a custom `fetch` implementation to handle authentication headers and API adaptations.
-   **Tools**:
    -   Register using `tools.register`.
    -   Define Zod schemas or JSON schemas for parameters.
    -   Implement `execute` function.
-   **Streaming**:
    -   For providers, handle Server-Sent Events (SSE) for streaming responses.
    -   Transform upstream API formats (e.g., OpenAI Chat Completions) to Alma's internal format if necessary.
    -   **Critical**: When handling tool calls in streams, ensure `output_index` is consistent and `call_id` is preserved across chunks.

## Development Workflow

1.  **Setup**:
    -   `npm install` in the root or specific plugin directory.
    -   Ensure `alma-plugin-api` is installed/linked.
2.  **Build**:
    -   Plugins are typically compiled from TypeScript to JavaScript.
    -   Check `package.json` for build scripts (usually `npm run build`).
3.  **Testing**:
    -   Use `vitest` or `jest` if configured.
    -   Manual testing in Alma via "Load Unpacked Plugin" (if available).

## Specific Plugin Notes

### Qwen Auth (`plugins/qwen-auth`)

-   **Auth Flow**: OAuth Device Flow with PKCE.
-   **API**: Proxies requests to `portal.qwen.ai` or custom `resource_url`.
-   **Streaming**:
    -   Converts OpenAI Chat Completions format to Alma's internal Responses API format.
    -   Handles `tool_calls` specially:
        -   Tracks `index` to `id` mapping because Qwen might omit `id` in subsequent chunks.
        -   Fixes `output_index` for tool calls to prevent interleaving issues.

### CLIProxyAPI (`data/CLIProxyAPI`)

-   A Go-based proxy server for various AI providers.
-   Supports OpenAI, Gemini, Claude, Codex, Qwen, etc.
-   Used as a reference implementation for some auth flows and API adaptations.

## Best Practices

-   **Error Handling**: Wrap API calls in try-catch blocks and use `logger.error` and `ui.showError`.
-   **Logging**: Use `logger.info/warn/debug` for tracing execution.
-   **Type Safety**: Use `alma-plugin-api` types (`PluginContext`, `PluginActivation`, etc.).
-   **Security**: Never hardcode secrets. Use `storage.secrets`.

## Git Workflow

-   **Commit Messages**: Follow Conventional Commits (e.g., `fix(qwen-auth): ...`, `feat(ui): ...`).
-   **Versioning**: Update `version` in `manifest.json` before release.
