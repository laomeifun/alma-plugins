# Alma Plugin API 参考文档

> 本文档基于 `alma-plugin-api` 包自动生成，描述了 Alma 插件开发可用的所有 API。

## 目录

- [核心类型](#核心类型)
- [PluginContext - 插件上下文](#plugincontext---插件上下文)
- [Logger API - 日志](#logger-api---日志)
- [Storage API - 存储](#storage-api---存储)
- [Tools API - 工具注册](#tools-api---工具注册)
- [Commands API - 命令](#commands-api---命令)
- [Events API - 事件钩子](#events-api---事件钩子)
- [UI API - 用户界面](#ui-api---用户界面)
- [Chat API - 聊天](#chat-api---聊天)
- [Providers API - AI 提供商](#providers-api---ai-提供商)
- [Workspace API - 工作区](#workspace-api---工作区)
- [Settings API - 设置](#settings-api---设置)
- [I18n API - 国际化](#i18n-api---国际化)
- [插件入口点](#插件入口点)

---

## 核心类型

### Disposable

可释放资源的接口，用于清理订阅和注册。

```typescript
interface Disposable {
    dispose(): void;
}
```

### PluginActivation

插件激活后返回的结果，包含清理函数。

```typescript
interface PluginActivation {
    dispose(): void;
}
```

### Event<T>

事件订阅函数类型。

```typescript
interface Event<T> {
    (listener: (data: T) => void): Disposable;
}
```

---

## PluginContext - 插件上下文

`PluginContext` 是传递给插件 `activate` 函数的主要对象，提供对所有 Alma API 的访问。

### 属性

| 属性 | 类型 | 描述 |
|------|------|------|
| `id` | `string` | 插件唯一标识符 |
| `extensionPath` | `string` | 插件安装目录路径 |
| `storagePath` | `string` | 插件本地存储路径 |
| `globalStoragePath` | `string` | 插件全局存储路径 |
| `logger` | `Logger` | 日志工具 |
| `storage` | `{ local, workspace, secrets }` | 存储 API |
| `tools` | `ToolsAPI` | 工具注册 API |
| `commands` | `CommandsAPI` | 命令注册 API |
| `events` | `EventsAPI` | 事件钩子 API |
| `ui` | `UIAPI` | 用户界面 API |
| `chat` | `ChatAPI` | 聊天 API |
| `providers` | `ProvidersAPI` | AI 提供商 API |
| `workspace` | `WorkspaceAPI` | 工作区 API |
| `settings` | `SettingsAPI` | 设置 API |
| `i18n` | `I18nAPI` | 国际化 API |

---

## Logger API - 日志

提供插件日志记录功能。

### 方法

| 方法 | 签名 | 描述 |
|------|------|------|
| `info` | `(message: string, ...args: unknown[]) => void` | 记录信息级别日志 |
| `warn` | `(message: string, ...args: unknown[]) => void` | 记录警告级别日志 |
| `error` | `(message: string, ...args: unknown[]) => void` | 记录错误级别日志 |
| `debug` | `(message: string, ...args: unknown[]) => void` | 记录调试级别日志 |

### 示例

```typescript
context.logger.info('插件已启动');
context.logger.error('发生错误:', error);
context.logger.debug('调试信息', { data: someData });
```

---

## Storage API - 存储

### Storage - 持久化键值存储

```typescript
interface Storage {
    get<T>(key: string): Promise<T | undefined>;
    get<T>(key: string, defaultValue: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}
```

### SecretStorage - 安全存储

用于存储敏感数据（如 API 密钥）。

```typescript
interface SecretStorage {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
```

### 存储类型

通过 `context.storage` 访问：

| 属性 | 类型 | 描述 |
|------|------|------|
| `local` | `Storage` | 本地持久化存储 |
| `workspace` | `Storage` | 工作区级别存储 |
| `secrets` | `SecretStorage` | 安全存储（加密） |

### 示例

```typescript
// 保存数据
await context.storage.local.set('myKey', { count: 42 });

// 读取数据
const data = await context.storage.local.get<{ count: number }>('myKey');

// 安全存储 API 密钥
await context.storage.secrets.set('apiKey', 'sk-xxx...');
```

---

## Tools API - 工具注册

允许插件注册可被 AI 助手调用的工具。

### ToolsAPI

```typescript
interface ToolsAPI {
    register<TParams extends z.ZodType>(id: string, definition: ToolDefinition<TParams>): Disposable;
    unregister(id: string): void;
}
```

### ToolDefinition

```typescript
interface ToolDefinition<TParams extends z.ZodType = z.ZodType> {
    description: string;                                              // 工具描述
    parameters: TParams;                                              // Zod 参数模式
    execute: (params: z.infer<TParams>, context: ToolContext) => Promise<unknown>;
}
```

### ToolContext

```typescript
interface ToolContext {
    threadId: string;        // 当前对话线程 ID
    messageId: string;       // 当前消息 ID
    abortSignal?: AbortSignal;  // 取消信号
}
```

### 示例

```typescript
import { z } from 'zod';

const disposable = context.tools.register('myPlugin.searchWeb', {
    description: '搜索网页内容',
    parameters: z.object({
        query: z.string().describe('搜索关键词'),
        limit: z.number().optional().describe('结果数量限制')
    }),
    execute: async (params, ctx) => {
        const results = await searchWeb(params.query, params.limit);
        return results;
    }
});
```

---

## Commands API - 命令

注册可在命令面板中执行的命令。

### CommandsAPI

```typescript
interface CommandsAPI {
    register(id: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): Disposable;
    execute<T>(id: string, ...args: unknown[]): Promise<T>;
}
```

### 示例

```typescript
// 注册命令
const disposable = context.commands.register('myPlugin.sayHello', async () => {
    context.ui.showNotification('Hello, World!');
});

// 执行命令
await context.commands.execute('myPlugin.sayHello');
```

---

## Events API - 事件钩子

订阅应用生命周期事件。

### EventsAPI

```typescript
interface EventsAPI {
    on<T extends HookName>(hookName: T, handler: HookHandler<T>, options?: { priority?: number }): Disposable;
    once<T extends HookName>(hookName: T, handler: HookHandler<T>): Disposable;
}
```

### 可用钩子

| 钩子名称 | 描述 | 输入类型 | 输出类型 |
|----------|------|----------|----------|
| `chat.message.willSend` | 消息发送前 | `{ threadId, content, model, providerId }` | `{ content?, cancel? }` |
| `chat.message.didSend` | 消息发送后 | `unknown` | `{}` |
| `chat.message.didReceive` | 收到响应后 | `{ threadId, model, providerId, response, pricing? }` | `{}` |
| `chat.thread.created` | 线程创建时 | `{ threadId, title, model? }` | `{}` |
| `chat.thread.deleted` | 线程删除时 | `unknown` | `{}` |
| `thread.activated` | 线程激活时 | `{ threadId, title?, model?, providerId?, usage?, pricing? }` | `{}` |
| `tool.willExecute` | 工具执行前 | `{ tool, args, context }` | `{ args?, cancel? }` |
| `tool.didExecute` | 工具执行后 | `{ tool, args, result, duration, context }` | `{ result? }` |
| `tool.onError` | 工具执行出错 | `{ tool, args, error, duration, context }` | `{ result?, rethrow? }` |
| `app.ready` | 应用就绪 | `unknown` | `{}` |
| `app.willQuit` | 应用即将退出 | `unknown` | `{}` |

### 相关类型

```typescript
interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
}

interface ModelPricing {
    input?: number;   // 每百万输入 token 成本 (USD)
    output?: number;  // 每百万输出 token 成本 (USD)
    cacheRead?: number; // 每百万缓存输入 token 成本 (USD)
}

interface ToolExecutionContext {
    threadId: string;
    messageId: string;
    sessionId?: string;
}
```

### 示例

```typescript
// 监听消息接收
context.events.on('chat.message.didReceive', (input, output) => {
    context.logger.info('收到响应:', input.response.content);
    if (input.response.usage) {
        context.logger.info('Token 使用:', input.response.usage.totalTokens);
    }
});

// 修改即将发送的消息
context.events.on('chat.message.willSend', (input, output) => {
    output.content = input.content + '\n\n[由插件增强]';
});

// 取消消息发送
context.events.on('chat.message.willSend', (input, output) => {
    if (input.content.includes('禁止词')) {
        output.cancel = true;
    }
});

// 监听工具执行
context.events.on('tool.didExecute', (input, output) => {
    context.logger.info(`工具 ${input.tool} 执行耗时: ${input.duration}ms`);
});
```

---

## UI API - 用户界面

提供用户界面交互功能。

### UIAPI

```typescript
interface UIAPI {
    showNotification(message: string, options?: NotificationOptions): void;
    showError(message: string): void;
    showWarning(message: string): void;
    showQuickPick<T>(items: QuickPickItem<T>[], options?: QuickPickOptions): Promise<T | undefined>;
    showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
    showConfirmDialog(message: string, options?: ConfirmOptions): Promise<boolean>;
    withProgress<T>(options: ProgressOptions, task: ProgressTask<T>): Promise<T>;
    createStatusBarItem(options: StatusBarItemOptions): StatusBarItem;
    readonly theme: {
        current: Theme;
        onChange: Event<Theme>;
    };
}
```

### 通知选项

```typescript
interface NotificationOptions {
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;  // 显示时长（毫秒）
    action?: {
        label: string;
        callback: () => void;
    };
}
```

### 快速选择

```typescript
interface QuickPickItem<T = string> {
    label: string;
    description?: string;
    detail?: string;
    value: T;
}

interface QuickPickOptions {
    title?: string;
    placeholder?: string;
    canSelectMany?: boolean;
}
```

### 输入框

```typescript
interface InputBoxOptions {
    title?: string;
    prompt?: string;
    placeholder?: string;
    value?: string;
    password?: boolean;
    validateInput?: (value: string) => string | undefined;
}
```

### 确认对话框

```typescript
interface ConfirmOptions {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'info' | 'warning' | 'danger';
}
```

### 进度指示器

```typescript
interface ProgressOptions {
    title: string;
    cancellable?: boolean;
}

interface ProgressReport {
    increment?: number;
    message?: string;
}

type ProgressTask<T> = (
    progress: { report: (value: ProgressReport) => void },
    token: { isCancellationRequested: boolean }
) => Promise<T>;
```

### 状态栏

```typescript
interface StatusBarItem extends Disposable {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
}

interface StatusBarItemOptions {
    id: string;
    alignment: 'left' | 'right';
    priority?: number;
}
```

### 主题

```typescript
interface Theme {
    id: string;
    name: string;
    type: 'dark' | 'light';
}
```

### 示例

```typescript
// 显示通知
context.ui.showNotification('操作成功!', { type: 'success' });

// 显示错误
context.ui.showError('发生错误');

// 快速选择
const selected = await context.ui.showQuickPick([
    { label: '选项 A', value: 'a' },
    { label: '选项 B', value: 'b' }
], { title: '请选择' });

// 输入框
const name = await context.ui.showInputBox({
    prompt: '请输入名称',
    placeholder: '名称...'
});

// 确认对话框
const confirmed = await context.ui.showConfirmDialog('确定要删除吗?', {
    type: 'danger',
    confirmLabel: '删除'
});

// 进度指示器
await context.ui.withProgress({ title: '处理中...' }, async (progress, token) => {
    for (let i = 0; i < 100; i++) {
        if (token.isCancellationRequested) break;
        progress.report({ increment: 1, message: `步骤 ${i + 1}` });
        await delay(100);
    }
});

// 状态栏
const statusBar = context.ui.createStatusBarItem({
    id: 'myPlugin.status',
    alignment: 'right',
    priority: 100
});
statusBar.text = '$(check) 就绪';
statusBar.show();

// 监听主题变化
context.ui.theme.onChange((theme) => {
    context.logger.info('主题已切换:', theme.name);
});
```

---

## Chat API - 聊天

访问聊天线程和消息。

### ChatAPI

```typescript
interface ChatAPI {
    listThreads(): Promise<Thread[]>;
    getThread(id: string): Promise<Thread | undefined>;
    getActiveThread(): Promise<Thread | undefined>;
    createThread(options?: { title?: string; model?: string }): Promise<Thread>;
    getMessages(threadId: string): Promise<Message[]>;
}
```

### Thread

```typescript
interface Thread {
    id: string;
    title?: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
}
```

### Message

```typescript
interface Message {
    id: string;
    threadId: string;
    role: 'user' | 'assistant' | 'system';
    content: unknown;  // 可以是字符串或 UIMessage
    createdAt: string;
}
```

### 示例

```typescript
// 获取所有线程
const threads = await context.chat.listThreads();

// 获取当前活动线程
const activeThread = await context.chat.getActiveThread();

// 创建新线程
const newThread = await context.chat.createThread({
    title: '新对话',
    model: 'gpt-4'
});

// 获取线程消息
const messages = await context.chat.getMessages(activeThread.id);
```

---

## Providers API - AI 提供商

管理 AI 提供商。

### ProvidersAPI

```typescript
interface ProvidersAPI {
    list(): Promise<Provider[]>;
    get(id: string): Promise<Provider | undefined>;
    register(provider: ProviderDefinition): Disposable;
}
```

### Provider

```typescript
interface Provider {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
}
```

### ProviderDefinition

```typescript
interface ProviderDefinition {
    id: string;
    name: string;
    icon?: string;
    getModels(): Promise<Array<{ id: string; name: string }>>;
    createChatCompletion(request: {
        model: string;
        messages: Message[];
        stream?: boolean;
    }): Promise<ReadableStream | { content: string }>;
}
```

### 示例

```typescript
// 列出所有提供商
const providers = await context.providers.list();

// 获取特定提供商
const openai = await context.providers.get('openai');

// 注册自定义提供商
const disposable = context.providers.register({
    id: 'my-provider',
    name: 'My Custom Provider',
    async getModels() {
        return [
            { id: 'model-1', name: 'Model 1' },
            { id: 'model-2', name: 'Model 2' }
        ];
    },
    async createChatCompletion(request) {
        // 实现聊天完成逻辑
        return { content: 'Response from custom provider' };
    }
});
```

---

## Workspace API - 工作区

工作区和文件系统操作。

### WorkspaceAPI

```typescript
interface WorkspaceAPI {
    readonly rootPath: string | undefined;
    readonly workspaceFolders: WorkspaceFolder[];
    readFile(filePath: string): Promise<Uint8Array>;
    writeFile(filePath: string, content: Uint8Array): Promise<void>;
    stat(filePath: string): Promise<FileStat>;
    readDirectory(dirPath: string): Promise<[string, FileType][]>;
    createFileSystemWatcher(pattern: string): FileSystemWatcher;
}
```

### WorkspaceFolder

```typescript
interface WorkspaceFolder {
    id: string;
    path: string;
    name: string;
}
```

### FileStat

```typescript
interface FileStat {
    type: 'file' | 'directory' | 'symlink';
    size: number;
    mtime: number;  // 修改时间
    ctime: number;  // 创建时间
}
```

### FileType

```typescript
type FileType = 'file' | 'directory' | 'symlink' | 'unknown';
```

### FileSystemWatcher

```typescript
interface FileSystemWatcher extends Disposable {
    onDidCreate: Event<string>;
    onDidChange: Event<string>;
    onDidDelete: Event<string>;
}
```

### 示例

```typescript
// 读取文件
const content = await context.workspace.readFile('/path/to/file.txt');
const text = new TextDecoder().decode(content);

// 写入文件
const data = new TextEncoder().encode('Hello, World!');
await context.workspace.writeFile('/path/to/file.txt', data);

// 获取文件信息
const stat = await context.workspace.stat('/path/to/file.txt');
context.logger.info('文件大小:', stat.size);

// 读取目录
const entries = await context.workspace.readDirectory('/path/to/dir');
for (const [name, type] of entries) {
    context.logger.info(`${name}: ${type}`);
}

// 监听文件变化
const watcher = context.workspace.createFileSystemWatcher('**/*.ts');
watcher.onDidChange((path) => {
    context.logger.info('文件已修改:', path);
});
```

---

## Settings API - 设置

读取和写入插件设置。

### SettingsAPI

```typescript
interface SettingsAPI {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Promise<void>;
    onDidChange: Event<SettingsChangeEvent>;
}
```

### SettingsChangeEvent

```typescript
interface SettingsChangeEvent {
    key: string;
    oldValue: unknown;
    newValue: unknown;
}
```

### 示例

```typescript
// 读取设置
const apiKey = context.settings.get<string>('apiKey');
const maxTokens = context.settings.get('maxTokens', 1000);

// 更新设置
await context.settings.update('maxTokens', 2000);

// 监听设置变化
context.settings.onDidChange((event) => {
    context.logger.info(`设置 ${event.key} 从 ${event.oldValue} 变为 ${event.newValue}`);
});
```

---

## I18n API - 国际化

国际化支持。

### I18nAPI

```typescript
interface I18nAPI {
    t(key: string, params?: Record<string, unknown>): string;
    locale: string;
    onDidChangeLocale: Event<string>;
}
```

### 示例

```typescript
// 获取翻译文本
const greeting = context.i18n.t('greeting', { name: 'World' });

// 获取当前语言
const currentLocale = context.i18n.locale;

// 监听语言变化
context.i18n.onDidChangeLocale((locale) => {
    context.logger.info('语言已切换:', locale);
});
```

---

## 插件入口点

每个插件必须导出一个 `activate` 函数。

### ActivateFunction

```typescript
type ActivateFunction = (context: PluginContext) => Promise<PluginActivation>;
```

### 完整示例

```typescript
import type { PluginContext, PluginActivation } from 'alma-plugin-api';

export async function activate(context: PluginContext): Promise<PluginActivation> {
    context.logger.info('插件已激活!');

    // 注册命令
    const commandDisposable = context.commands.register('myPlugin.hello', () => {
        context.ui.showNotification('Hello from my plugin!');
    });

    // 订阅事件
    const eventDisposable = context.events.on('chat.message.didReceive', (input) => {
        context.logger.info('收到消息:', input.response.content);
    });

    // 创建状态栏项
    const statusBar = context.ui.createStatusBarItem({
        id: 'myPlugin.status',
        alignment: 'right'
    });
    statusBar.text = '$(check) My Plugin';
    statusBar.show();

    // 返回清理函数
    return {
        dispose: () => {
            commandDisposable.dispose();
            eventDisposable.dispose();
            statusBar.dispose();
            context.logger.info('插件已停用');
        }
    };
}
```

---

## 附录：类型导入

```typescript
import type {
    // 核心类型
    Disposable,
    PluginActivation,
    PluginContext,
    ActivateFunction,
    Event,
    EventCallback,
    
    // Logger
    Logger,
    
    // Storage
    Storage,
    SecretStorage,
    
    // Tools
    ToolsAPI,
    ToolDefinition,
    ToolContext,
    
    // Commands
    CommandsAPI,
    
    // Events
    EventsAPI,
    HookName,
    HookHandler,
    HookInput,
    HookOutput,
    TokenUsage,
    ModelPricing,
    ToolExecutionContext,
    
    // UI
    UIAPI,
    NotificationOptions,
    QuickPickItem,
    QuickPickOptions,
    InputBoxOptions,
    ConfirmOptions,
    ProgressOptions,
    ProgressReport,
    ProgressTask,
    StatusBarItem,
    StatusBarItemOptions,
    Theme,
    
    // Chat
    ChatAPI,
    Thread,
    Message,
    
    // Providers
    ProvidersAPI,
    Provider,
    ProviderDefinition,
    
    // Workspace
    WorkspaceAPI,
    WorkspaceFolder,
    FileStat,
    FileType,
    FileSystemWatcher,
    
    // Settings
    SettingsAPI,
    SettingsChangeEvent,
    
    // I18n
    I18nAPI
} from 'alma-plugin-api';
```
