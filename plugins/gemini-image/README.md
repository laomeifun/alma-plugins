# Gemini Image Generator Plugin

使用 Gemini 图像生成模型，根据对话上下文生成图片的 Alma 插件。

## 功能特性

- 🎨 **对话上下文感知**：自动获取当前对话历史作为图片生成的上下文
- 📝 **自定义提示词**：支持在命令中添加额外的提示词
- 🖼️ **多图生成**：支持一次生成多张图片（1-4张）
- 💾 **自动保存**：图片自动保存到工作区目录
- 📋 **Markdown 渲染**：返回 Markdown 格式的图片路径，方便预览

## 使用方法

### Slash 命令

在聊天输入框中使用 `/image` 命令：

```
/image                          # 根据对话上下文生成图片
/image 一只可爱的猫咪            # 生成指定内容的图片
/image -n 2 未来城市的夜景       # 生成 2 张图片
/image -n 4                     # 根据上下文生成 4 张图片
```

### AI 工具调用

插件还注册了一个 `generateImage` 工具，AI 助手可以在需要时自动调用它来生成图片。

## 配置

在 Alma 设置中配置以下选项：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `geminiImage.baseUrl` | `http://127.0.0.1:8317` | Gemini API 代理地址 |
| `geminiImage.model` | `gemini-3-pro-image-preview` | 图像生成模型 |
| `geminiImage.imageSize` | `1024x1024` | 图片尺寸 (512x512, 1024x1024, 1536x1536) |
| `geminiImage.outputDir` | `generated-images` | 图片保存目录（相对于工作区根目录） |
| `geminiImage.timeoutMs` | `120000` | API 请求超时时间（毫秒） |
| `geminiImage.maxContextMessages` | `10` | 作为上下文的最大消息数量 |

### 设置 API Key

使用命令面板运行以下命令来设置 API Key：

- `Gemini Image: Set API Key` - 设置 API Key
- `Gemini Image: Clear API Key` - 清除已保存的 API Key

## 工作原理

1. 用户输入 `/image` 命令
2. 插件拦截消息，取消原始发送
3. 获取当前对话的历史消息作为上下文
4. 将上下文和用户提示词组合成完整的图片描述
5. 调用 Gemini API 生成图片
6. 将图片保存到工作区目录
7. 返回 Markdown 格式的图片路径

## API 兼容性

插件支持两种 API 模式：

1. **images/generations API**（优先）- OpenAI 兼容的图片生成接口
2. **chat/completions API**（备选）- 使用 `modalities: ["image"]` 的聊天接口

如果 `images/generations` 返回 404，会自动切换到 `chat/completions` 模式。

## 示例输出

```markdown
## 🎨 生成的图片

### 图片 1
![生成的图片 1](generated-images/gemini-20260110-143052-1-abc123.png)

📁 路径: `generated-images/gemini-20260110-143052-1-abc123.png`
```

## 依赖

- Alma >= 1.0.0
- 可访问的 Gemini API 代理服务

## 许可证

MIT
