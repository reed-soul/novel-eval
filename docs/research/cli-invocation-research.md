# Node.js 后端调用本地 CLI 工具调研报告

> 调研时间：2026-07-08
> 目标场景：Node.js 后端需要编程式地调用 Claude Code CLI、Cursor Agent 等 AI 编码 CLI 工具

---

## 一、核心发现：三大调用范式

经过调研，Node.js 调用本地 AI CLI 工具主要存在三种范式：

| 范式 | 原理 | 代表工具 | 复杂度 |
|------|------|----------|--------|
| **SDK/stdio 流式调用** | CLI 提供 `-p` (print) 模式，通过 stdin/stdout 交换 JSON 消息 | Claude Code (`-p --output-format stream-json --input-format stream-json`) | 中 |
| **PTY/tmux 桥接** | CLI 需要交互式 TTY，通过伪终端或 tmux 会话中转 | Cursor Agent, Codex (交互模式) | 高 |
| **MCP Server** | 将 CLI 包装为 MCP Server，通过标准化协议暴露能力 | Claude Code (`claude mcp serve`) | 中 |

---

## 二、各方案详细分析

### 2.1 Claude Code CLI — SDK 模式（推荐）

Claude Code 原生提供了编程式调用的 SDK 模式，这是目前最成熟的方案。

#### 调用方式

```bash
# 单次调用（同步 JSON）
claude -p "Fix the bug in auth.ts" --output-format json

# 流式调用（实时 JSON 事件流）
claude -p "Refactor this module" --output-format stream-json --input-format stream-json
```

#### SDK 模式关键特性

- **`--output-format stream-json`**：输出为 JSONL 流，包含 `assistant`、`result`、`tool_use` 等事件
- **`--input-format stream-json`**：通过 stdin 接收 JSON 消息，支持多轮对话
- **`--system-prompt`**：注入自定义系统提示
- **`--allowed-tools`** / **`--disallowed-tools`**：精确控制可用工具
- **`--permission-mode`**：设置权限模式（`auto`、`plan`、`bypassPermissions`）
- **`--model`**：选择模型
- **`--max-budget-usd`**：设置 API 预算上限
- **`--session-id`** / **`--resume`**：会话持久化和恢复
- **`--json-schema`**：结构化输出验证

#### Node.js 调用示例

```typescript
import { spawn } from 'child_process';

// 方式一：单次调用
function callClaude(prompt: string, cwd: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '-p', prompt,
      '--output-format', 'json',
      '--permission-mode', 'auto',
      '--dangerously-skip-permissions', // 仅沙箱环境
    ], { cwd });

    let output = '';
    proc.stdout.on('data', (d) => output += d);
    proc.stderr.on('data', (d) => console.error(d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(JSON.parse(output));
      else reject(new Error(`Claude exit ${code}`));
    });
  });
}

// 方式二：流式多轮对话
function streamClaudeSession(cwd: string) {
  const proc = spawn('claude', [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--permission-mode', 'auto',
  ], { cwd });

  const eventEmitter = new EventEmitter();

  // 解析输出事件流
  proc.stdout.on('data', (chunk) => {
    chunk.toString().trim().split('\n').forEach(line => {
      if (line) eventEmitter.emit('event', JSON.parse(line));
    });
  });

  // 发送用户消息
  function send(message: string) {
    proc.stdin.write(JSON.stringify({
      type: 'user_message',
      content: message,
    }) + '\n');
  }

  return { eventEmitter, send, kill: () => proc.kill() };
}
```

#### MCP Server 模式

Claude Code 还可以作为 MCP Server 暴露：

```bash
claude mcp serve
```

这样其他 MCP 兼容的客户端可以通过标准协议调用 Claude Code 的能力。

### 2.2 Cursor Agent CLI — 原生 SDK 模式（与 Claude Code 对等）

Cursor Agent（`agent` CLI）**支持与 Claude Code 对等的编程调用模式**：

```bash
# 单次调用（结构化 JSON）
agent -p 'Analyze code' --output-format json

# 流式调用（实时 JSON 事件流）
agent -p 'Run tests' --output-format stream-json --stream-partial-output

# 自动执行模式（无需人工确认）
agent -p 'Fix all linting errors' --force
```

**注意：** 仅交互模式（不带 `-p`）需要 tmux 桥接。编程调用用 `-p` 模式即可。

#### 仅交互模式需要 tmux 桥接

```typescript
import { execSync } from 'child_process';

function runCursorAgent(task: string, cwd: string): string {
  const socket = '/tmp/cursor-agent.sock';
  const session = `cursor-${Date.now()}`;

  // 创建隔离的 tmux 会话
  execSync(`tmux -S ${socket} new-session -d -s ${session} -x 200 -y 50`);
  
  // 启动 agent
  execSync(
    `tmux -S ${socket} send-keys -t ${session} "cd ${cwd} && agent '${task}'" Enter`
  );

  // 等待完成（检测 shell 提示符返回）
  const waitForCompletion = () => {
    // 轮询检查，或使用 wait-for-text.sh
    const output = execSync(
      `tmux -S ${socket} capture-pane -p -J -t ${session} -S -500`
    ).toString();
    return output;
  };

  // ...轮询逻辑...

  // 清理
  execSync(`tmux -S ${socket} kill-session -t ${session}`);
}
```

**缺点（仅限交互模式）：**
- 需要解析 TUI 输出，不可靠
- tmux 会话管理复杂
- 无结构化输出，依赖屏幕文本抓取
- 并发管理困难

**`-p` 编程模式无上述问题。**

### 2.3 OpenAI Codex CLI

Codex CLI 的架构与 Claude Code 类似：
- 支持 `codex --quiet` / `codex -q` 非交互模式
- 支持 `--full-auto` / `--yolo` 自动执行模式
- 通过 tmux 可并行运行多个实例
- 有 `codex --approval-mode full-auto` 的自动化模式

### 2.4 MCP (Model Context Protocol) 方案

MCP 是 Anthropic 提出的标准化协议，用于 AI 模型与外部工具的交互。

#### 在本场景下的适用性

**适用：**
- Claude Code 自身支持作为 MCP Server（`claude mcp serve`）
- 可以用 MCP 统一多个工具的接口
- 标准化工具注册、发现和调用

**局限：**
- MCP 主要设计用于 LLM ↔ 工具的通信，不是 CLI 编排协议
- Cursor Agent 不原生支持 MCP
- 需要为不支持 MCP 的工具编写 MCP adapter

#### MCP Server 包装示例

```typescript
// 用 MCP 将自定义能力暴露给 Claude Code
// 在 .mcp.json 中配置
{
  "mcpServers": {
    "my-eval-tool": {
      "command": "npx",
      "args": ["-y", "my-eval-mcp-server"],
      "env": { "API_KEY": "xxx" }
    }
  }
}
```

### 2.5 OpenClaw 的 CLI 调用架构

OpenClaw 作为 AI Agent 框架，其内部调用架构提供了重要参考：

| 机制 | 用途 | 实现方式 |
|------|------|----------|
| `exec` | 执行 shell 命令 | `child_process.spawn`，支持 PTY |
| `process` | 管理后台进程 | 会话管理（poll/log/write/kill） |
| `sessions_yield` | 子 agent 协作 | 生成子 agent 并等待结果 |
| tmux skill | 交互式 CLI | tmux socket + send-keys + capture-pane |
| cursor-agent skill | Cursor 编排 | tmux 桥接（有详细文档） |
| opencli | 外部 CLI 统一接口 | adapter 模式，统一 `opencli <tool> <cmd>` |
| autoglm-browser-agent | 浏览器自动化 | 通过 mcporter 调用 |

**关键设计模式：**
1. **exec + PTY**：对需要 TTY 的 CLI（Cursor Agent 等），使用 `pty: true` 的 spawn
2. **后台 + 轮询**：长任务用 `background: true` + `process.poll` 检查状态
3. **tmux 隔离**：多实例并发使用独立 socket 的 tmux session
4. **adapter 抽象**：opencli 用 adapter 模式统一 100+ 外部工具

### 2.6 LSP (Language Server Protocol)

LSP 在本场景下 **不适用**：
- LSP 用于代码编辑器与语言服务的通信（补全、诊断、跳转）
- 不适合作为 CLI 工具调用协议
- Claude Code 内部使用 LSP 进行代码分析，但这是内部实现细节

---

## 三、方案对比

| 维度 | Claude Code SDK | Cursor Agent tmux | MCP 包装 | OpenClaw exec 模式 |
|------|----------------|-------------------|----------|-------------------|
| **调用可靠性** | ⭐⭐⭐⭐⭐ 结构化 JSON | ⭐⭐⭐⭐⭐ 结构化 JSON（`-p` 模式） | ⭐⭐⭐⭐ 标准协议 | ⭐⭐⭐ 依赖具体实现 |
| **实现复杂度** | ⭐⭐ 低 | ⭐⭐ 低（`-p` 模式）/ ⭐⭐⭐⭐ 高（交互模式） | ⭐⭐⭐ 中 | ⭐⭐⭐ 中 |
| **输出质量** | ⭐⭐⭐⭐⭐ 结构化 | ⭐⭐⭐⭐⭐ 结构化（`-p` 模式） | ⭐⭐⭐⭐ 结构化 | ⭐⭐⭐ 混合 |
| **多轮对话** | ✅ 原生支持 | ⚠️ 需要复杂编排 | ✅ 原生支持 | ✅ 进程管理 |
| **并发能力** | ✅ 多进程 | ✅ tmux 多 session | ✅ 多 server | ✅ 进程池 |
| **工具控制** | ⭐⭐⭐⭐⭐ 精细 | ⭐⭐⭐⭐ `--force` 自动执行 | ⭐⭐⭐⭐ 标准化 | ⭐⭐⭐ 取决于实现 |
| **错误处理** | ⭐⭐⭐⭐⭐ JSON 错误码 | ⭐⭐⭐⭐ JSON（`-p` 模式） | ⭐⭐⭐⭐ 协议级 | ⭐⭐⭐ 退出码 |
| **生态系统** | ⭐⭐⭐⭐⭐ 成熟 | ⭐⭐⭐⭐ 快速成长 | ⭐⭐⭐⭐ 快速增长 | ⭐⭐⭐ OpenClaw 内部 |

---

## 四、推荐方案

### 首选：Claude Code / Cursor Agent 的 `-p` SDK 模式（对等）

**两者均支持原生编程调用：**

| 能力 | Claude Code | Cursor Agent |
|------|------------|--------------|
| 非交互调用 | `claude -p` | `agent -p` |
| 结构化 JSON 输出 | `--output-format json` | `--output-format json` |
| 流式 JSON 事件 | `--output-format stream-json` | `--output-format stream-json` |
| 自动执行 | `--permission-mode auto` | `--force` |
| 多轮对话 | `--input-format stream-json` | 暂不支持（用会话恢复替代） |
| 工具控制 | `--allowed-tools` / `--disallowed-tools` | 无细粒度控制 |
| 会话恢复 | `--session-id` / `--resume` | `--resume="[chat-id]"` |
| 预算限制 | `--max-budget-usd` | 无 |
| 模型选择 | `--model` | `--model` |
| MCP 支持 | ✅ 原生（可作为 MCP Server） | ✅ 可加载 MCP Server |

**Claude Code 略胜于 Cursor Agent 的地方：** 多轮对话 stdin 支持、精细工具控制、预算限制。
**Cursor Agent 优势：** 语法更简洁、`--force` 更直接。

### 补充方案：统一抽象层

为支持多种 CLI 工具，建议构建一个统一的抽象层：

```
┌─────────────────────────────────────────────┐
│              Node.js 后端                      │
├─────────────────────────────────────────────┤
│           统一 CLI 调用抽象层                  │
│  interface AICodingAgent {                    │
│    run(prompt, options): AsyncIterable<Event> │
│    resume(sessionId, prompt): Promise<Result> │
│    kill(sessionId): void                      │
│    listSessions(): Promise<Session[]>         │
│  }                                            │
├──────────┬──────────┬──────────┬────────────┤
│ Claude   │ Cursor   │ Codex    │ Custom     │
│ Code     │ Agent    │ CLI      │ MCP Tools  │
│ Adapter  │ Adapter  │ Adapter  │ Adapter    │
├──────────┴──────────┴──────────┴────────────┤
│         (stream-json / tmux / pty)           │
└─────────────────────────────────────────────┘
```

### 不推荐

- **tmux 桥接**：仅在需要交互模式时使用，编程场景应优先 `-p` 模式
- **LSP 协议**：与本场景不匹配
- **直接 exec 调用交互式 CLI（不带 `-p`）**：会挂起

---

## 五、具体实现路径

### Phase 1：核心调用层（1-2 天）

1. 实现 `ClaudeCodeAdapter`：基于 `spawn` + `stream-json` 模式
2. 定义统一的 `AICodingAgent` 接口和事件类型
3. 实现基本的 prompt → result 调用

### Phase 2：增强功能（2-3 天）

1. 支持多轮对话（`--input-format stream-json`）
2. 支持会话持久化和恢复（`--session-id` / `--resume`）
3. 工具白名单/黑名单配置
4. 流式事件处理（`AsyncIterable` 或 `EventEmitter`）
5. 预算和超时控制

### Phase 3：多工具支持（2-3 天）

1. 实现 `CursorAgentAdapter`（基于 `-p --output-format stream-json`，与 Claude Code 对等）
2. 实现 `CodexAdapter`
3. MCP 客户端适配器（调用外部 MCP Server）
4. 工具选择策略（根据任务类型自动选择合适的 agent）

### Phase 4：生产化（持续）

1. 连接池 / 并发控制
2. 结果缓存
3. 可观测性（调用日志、耗时、token 用量）
4. 错误重试和降级策略

---

## 六、关键注意事项

### 安全

- **不要在生产环境使用 `--dangerously-skip-permissions`**
- 使用 `--allowed-tools` 严格限制可用工具
- 使用 `--max-budget-usd` 防止费用失控
- 在沙箱/容器中运行，限制文件系统访问

### 可靠性

- 设置合理的超时时间（Claude Code 一次调用可能 30s-5min）
- 实现优雅的进程清理（kill + timeout）
- 处理 API 限流和模型不可用的情况（`--fallback-model`）
- 使用 `--worktree` 隔离不同任务的文件系统

### 性能

- Claude Code 冷启动约 2-5s（需要加载配置、MCP servers 等）
- 使用 `--bare` 模式可减少启动开销
- 并发限制建议：2-5 个并发实例（取决于 API 配额和机器资源）

---

## 七、参考资源

- Claude Code 官方文档：`claude --help`（特别是 `-p`、`--output-format`、`--input-format` 相关选项）
- Cursor Agent 技能文档：`~/.openclaw-autoclaw/skills/cursor-agent/SKILL.md`
- OpenClaw exec 实现：支持 `pty: true`、`background: true`、会话管理
- OpenClaw tmux 技能：`~/.openclaw-autoclaw/skills/tmux/SKILL.md`
- MCP 规范：https://modelcontextprotocol.io
- OpenCLI 统一 CLI 接口：`~/.openclaw-autoclaw/skills/opencli-usage/SKILL.md`
