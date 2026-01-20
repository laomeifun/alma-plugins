# PDF to Markdown Plugin

自动将 PDF 文件转换为 Markdown 并注入到聊天上下文中。

## 功能

- 🔍 **自动检测** - 自动检测消息中的 PDF 引用（URL、本地文件路径、附件引用）
- 🔄 **智能转换** - 使用 MinerU API 将 PDF 转换为高质量 Markdown
- 💾 **缓存机制** - 缓存转换结果，避免重复 API 调用
- 📝 **上下文注入** - 自动将转换后的内容注入到聊天上下文

## 支持的 PDF 引用格式

插件可以检测以下格式的 PDF 引用：

### URL 格式
```
https://example.com/document.pdf
http://example.com/report.pdf?version=1
```

### 文件路径格式
```
C:\Documents\report.pdf
/home/user/documents/report.pdf
./docs/manual.pdf
../files/document.pdf
file:///path/to/file.pdf
```

### 附件引用格式
```
[附件: document.pdf]
[Attachment: report.pdf]
[file: manual.pdf]
📎 document.pdf
📄 report.pdf
`path/to/file.pdf`
"document.pdf"
[Download](https://example.com/file.pdf)
```

## 使用方法

### 1. 配置 API Key

首次使用时，插件会提示输入 MinerU API Key。你也可以通过命令手动设置：

1. 打开命令面板
2. 运行 `PDF to Markdown: Set API Key`
3. 输入你的 API Key（从 https://mineru.net 获取）

### 2. 自动转换

在聊天消息中包含 PDF 链接或文件路径，插件会自动：

1. 检测 PDF 引用
2. 调用 MinerU API 转换
3. 将 Markdown 内容注入到消息中

**示例：**
```
请帮我分析这个文档 https://example.com/report.pdf
```

```
请总结一下 [附件: quarterly-report.pdf] 的内容
```

### 3. 手动转换

运行命令 `PDF to Markdown: Convert PDF to Markdown` 手动转换单个 PDF。

## 命令

| 命令 | 描述 |
|------|------|
| `pdf-to-markdown.convert` | 手动转换 PDF 文件 |
| `pdf-to-markdown.toggle` | 开启/关闭自动转换 |
| `pdf-to-markdown.clearCache` | 清除转换缓存 |
| `pdf-to-markdown.setApiKey` | 设置 MinerU API Key |

## 设置

| 设置 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `pdf-to-markdown.enabled` | boolean | `true` | 启用自动转换 |
| `pdf-to-markdown.modelVersion` | string | `"vlm"` | MinerU 模型版本 (`vlm` 或 `doclayout_yolo`) |
| `pdf-to-markdown.enableFormula` | boolean | `true` | 启用公式识别 |
| `pdf-to-markdown.enableTable` | boolean | `true` | 启用表格识别 |
| `pdf-to-markdown.layoutModel` | string | `"doclayout_yolo"` | 布局检测模型 |
| `pdf-to-markdown.language` | string | `"ch"` | OCR 语言 (`ch` 中文, `en` 英文) |
| `pdf-to-markdown.cacheEnabled` | boolean | `true` | 启用缓存 |
| `pdf-to-markdown.maxFileSizeMB` | number | `50` | 最大文件大小 (MB) |

## MinerU API

本插件使用 [MinerU](https://mineru.net) 提供的 PDF 解析 API。

### 获取 API Key

1. 访问 https://mineru.net
2. 注册/登录账号
3. 进入 API 管理页面获取 Key

### API 特性

- 支持 VLM（视觉语言模型）和传统布局检测
- 高精度公式识别
- 表格结构保留
- 多语言 OCR 支持

## 工作原理

```
用户消息包含 PDF 引用
        ↓
插件检测 PDF 路径/URL
        ↓
检查缓存 → 命中 → 返回缓存内容
        ↓ 未命中
上传/提交到 MinerU API
        ↓
轮询任务状态
        ↓
下载 Markdown 结果
        ↓
缓存结果
        ↓
注入到消息上下文
```

## 注意事项

1. **API 配额** - MinerU API 有使用配额限制，请注意用量
2. **文件大小** - 默认限制 50MB，可在设置中调整
3. **转换时间** - 大型 PDF 可能需要较长时间转换
4. **缓存有效期** - 缓存默认 7 天有效

## License

MIT
