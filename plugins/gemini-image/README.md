# Gemini Image Generator

Generate images using OpenAI-compatible image generation APIs (like Gemini).

## Features

- 🎨 Registers a `generate_image` tool for AI to generate images
- 🔧 Supports both `/images/generations` and `/chat/completions` endpoints
- 💾 Automatically saves images to workspace directory
- 🔐 Secure API key storage

## Installation

Install from the Alma plugin marketplace or manually add to your plugins directory.

## Configuration

Configure the plugin in Alma settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `geminiImage.baseUrl` | `http://127.0.0.1:8317` | API endpoint URL |
| `geminiImage.apiKey` | (empty) | API key (or use `Set API Key` command) |
| `geminiImage.model` | `gemini-3-pro-image-preview` | Model name |
| `geminiImage.imageSize` | `1024x1024` | Default image size |
| `geminiImage.outputDir` | `generated-images` | Output directory (relative to workspace) |
| `geminiImage.timeoutMs` | `120000` | Request timeout in ms |
| `geminiImage.mode` | `auto` | API mode: `auto`, `images`, or `chat` |

### API Modes

- **auto** (default): Tries `/images/generations` first, falls back to `/chat/completions` on 404
- **images**: Uses only `/images/generations` endpoint (OpenAI-compatible)
- **chat**: Uses only `/chat/completions` endpoint (Gemini-style with `modalities: ["image"]`)

## Commands

| Command | Description |
|---------|-------------|
| `Gemini Image: Set API Key` | Securely store your API key |
| `Gemini Image: Clear API Key` | Remove stored API key |

## Tool Usage

The plugin registers a `generate_image` tool that AI can use:

```
Tool: generate_image

Parameters:
- prompt (required): Detailed image description
- size (optional): Image size (e.g., "1024x1024", "1792x1024")
- n (optional): Number of images to generate (1-4)
- outDir (optional): Output directory override
```

### Example Prompts

Ask the AI to generate images:

- "画一只橙色的猫咪坐在窗台上，水彩画风格"
- "Generate a futuristic cityscape at sunset, cyberpunk style"
- "Create a logo for a coffee shop, minimalist design"

## Compatible APIs

This plugin works with any OpenAI-compatible image generation API:

- **Gemini API** (via proxy like [gemini-openai-proxy](https://github.com/zuisong/gemini-openai-proxy))
- **OpenAI API** (DALL-E)
- **Local models** (Stable Diffusion with OpenAI-compatible wrapper)

## License

MIT
