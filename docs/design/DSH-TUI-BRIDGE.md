# dsh-TUI × ace 桥接（B 方案：**UI 用它的，引擎用我们的**）

> 一句话：给 dsh-TUI 一个本地 **OpenAI 兼容端点**，它以为在跟一个模型说话，
> 实际上每一轮都进了 **ace 的完整引擎**（工具 / 权限 / 沙箱 / 审计 / 回滚都在 ace 这边）。

## 为什么是这个方向

dsh-TUI 的前端不是"一个 HTTP 客户端"：它吃的是 **cordis 插件宿主**（`@deepseek-ai/dsh-*`
那 ~30 个包：session / llm / tools / storage / settings / commands / terminal…）。
把它的 UI 整棵树搬进 ace（A 方案）等于**在 ace 里重实现一遍 DSH 平台** —— 几百个文件、
几十个接口。B 方案绕开这件事：**UI 留在它那边，能力留在我们这边**。

你机器上已经有反方向的桥（`~/.dsh/profiles/dsh-tui/cordis.patch.yml` 里的 `mcp-ace`：
ace 的 31 个工具以 `mcp__ace__*` 进 dsh-TUI）。那套是"它的 agent 循环 + 我们的工具"；
这一套是"**我们的 agent 循环**"，两者可以并存，也可以只用后者。

## 起端点

```bash
# 只读（推荐先这样跑通）：写操作会被 ace 的权限层挡下
python tools/ace_openai_proxy.py --project-root G:\AI_Project\ace --permission readonly

# 离线验证链路本身（不需要任何密钥）
python tools/ace_openai_proxy.py --mock --project-root %TEMP%\ace_proxy_test
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--host/--port` | 默认 `127.0.0.1:8787`（**只监听本机**） |
| `--project-root` | **必须给对**：会话日志落在它的 `.ace_sessions/` |
| `--permission` | `readonly`（默认）/ `write` / `full` |
| `--allow` | 审批请求一律放行。**默认拒绝** —— 没人看着的端点不该自动放行写操作 |
| `--mock` | 离线演示（验证链路用） |
| `--python` | 用哪个解释器起引擎（默认当前解释器） |

## 在 dsh-TUI 里接上

`/provider` → 添加自定义：

1. `baseURL` = `http://127.0.0.1:8787/v1`
2. `protocol` = **`openai-completions`**
3. `apiKey` = 随便填（ace 不校验）
4. 它会**自动发现模型**（打 `/v1/models`，返回 `ace`）→ 勾选 `ace`

然后 `/model` 选 `ace`。之后这个会话的每一轮都走 ace 的引擎。

## 数据流

```
dsh-TUI 输入
   └─ POST /v1/chat/completions（带整段历史）
        └─ 代理只取**新出现的**用户消息（ace 自己记着上下文，不重放历史）
             └─ ai_code.py --serve（core/ace_serve，双向 NDJSON）
                  ├─ event model_delta → SSE 增量（客户端看得见逐字出）
                  ├─ event permission_request → **默认拒绝**（或 --allow 放行）
                  └─ event final → 作为 assistant 的 content 回给 TUI
```

回过去的是**纯文本**、`finish_reason: "stop"`，没有任何 `tool_calls` ——
所以 DSH 那条工具链不会被执行，工具全在 ace 里跑。

## 注意

- **会话粒度**：一个 OpenAI `user` 字段（或默认）对应一个 ace 子进程；ace 的上下文在进程内。
- **审批**：端点旁边没有人在答，所以默认 `deny`。要它写文件就 `--allow`（或 `--permission write`），
  清楚自己在放开什么。
- **端口只绑 127.0.0.1**：这东西没有鉴权（`apiKey` 不校验）。别往公网放。
- 端点自身零依赖（只用标准库）。
