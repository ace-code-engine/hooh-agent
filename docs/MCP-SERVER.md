# `ace --mcp` —— 把执行层挂在别人的 agent 下面

> 一句话：**host 负责想，HooH 负责"这一下到底能不能动"。** 一次 `tools/call` = 一次经过
> 执行层裁决的工具执行；本进程**一行模型调用都没有**。
>
> 设计与非目标见立项卡 `docs/design/MCP-SERVER.md`；这里只讲怎么用、怎么排障。

```bash
python ai_code.py --mcp --project-root /path/to/project            # 只读（默认）
python ai_code.py --mcp --project-root /path/to/project --permission write
```

stdout **被协议独占**（一行一个 JSON-RPC 消息）；引擎的日志与提示全部走 stderr，
所以你在 host 的日志里看到的是"这台机器的边界是什么"，而不是被吞掉的诊断。

## 一、把 HooH 写进 host 的 MCP 配置

标准形状（各家 host 的键名差异见括号里的**未验证**说明）：

```json
{
  "mcpServers": {
    "ace": {
      "command": "python",
      "args": [
        "/abs/path/to/ace/ai_code.py", "--mcp",
        "--project-root", "/abs/path/to/your/project"
      ],
      "env": { "PYTHONIOENCODING": "utf-8" }
    }
  }
}
```

- **Claude Code**：`claude mcp add ace -- python /abs/path/ace/ai_code.py --mcp --project-root /abs/path/proj`，
  或项目里的 `.mcp.json`（形状同上）。
- **Cursor**：`~/.cursor/mcp.json`（全局）或项目 `.cursor/mcp.json`。
- **Codex CLI**：`~/.codex/config.toml` 里 `[mcp_servers.ace]` + `command` / `args` / `env`。

> **诚实声明**：以上三处的文件路径与键名是照各家公开格式写的，**本机没装任何 host，
> 因此一次都没在真 host 上跑过**。真 host 冒烟（第五节）第 1 步就是去撞这件事；
> 撞上了以 host 自己的报错为准，别把它的配置格式当成 HooH 的问题。

Windows 上两点经验（来自本项目自己的 `--serve`/子进程调试）：
`command` 要能被直接执行（用 `python` 的绝对路径最稳；`.cmd` 启动器在部分 host 上不被当可执行文件）；
路径含空格时按 host 的数组语义传，不要自己加引号。

## 二、两个旋钮（没有第三个）

| 旋钮 | 决定什么 | 怎么给 |
|---|---|---|
| **权限档** | *哪些工具够得着* | `--permission readonly`（headless 默认，显式钉死）/ `write` / `full`，或配置文件里的 `permission` |
| **授权令** | *哪些确认会收拢* | 配置文件里的 `mandate`（下面给命令） |

沙箱档（`--sandbox job|docker`）是第三个**可选**的东西：它不改裁决，改的是"跑起来之后还有没有
第二道边界"。headless + 没有内核边界时 HooH 会在 stderr 打一条无人值守提示（行为不变）。

**headless 默认只读**（WP-AGENCY 起显式钉死，不随交互式 CLI 的 `write` 默认走）：
读类工具（`file_read` / `grep` / `glob` / `terminal_view` …）直接能用；
写类工具会返回 `isError`，理由里写明"这是权限档拦下的"。

**要让它写**：加 `--permission write`。此时**项目内**的写不需要令；而"要问人的那几处"
（项目外**已存在**对象、`terminal_exec` / `edit_file` 这类逐次确认工具、外发目的地不在白名单）
在 headless 下**没有人可以答**，所以会被拒 —— 出路是签一张令：

```bash
# 签一张 2 小时、只允许动这个项目、可逆性下限 snapshot、不可逆动作额度 3 的令
python -m cli.ace_mandate issue \
    --roots /abs/path/to/your/project \
    --floor snapshot --quota 3 --ttl 7200 \
    --intents terminal_exec,edit_file,file_write
```

把输出填进 HooH 配置（`~/.ai_code.json` 或项目配置）的 `mandate` 键，重启 MCP server 即可。
令的边界是**真边界**：越出 `roots` 升级为问人、没点名这个工具（`intents`）升级、
可逆性低于 `floor` 升级、额度耗尽升级、过期升级（重签一张即可）—— 篡改则一律不认。
这条路走通了两次：`test_all [72]` 用真执行层验（令覆盖 → 项目外已存在文件被真的改掉；
令不覆盖 / 没点名 → 照旧问人），`e2e/mcp_probe.py` 用**真进程 + 真配置文件**验
（写一份带 `mandate` 的 `~/.ai_code.json`，`terminal_exec` 从被拒变成放行）。

## 三、被拒了怎么读（这条比配置重要）

拒绝是 `result.content` 里的一段文字 + `isError: true`，**不是** JSON-RPC 错误 ——
这是刻意的：协议错误意味着"服务器坏了"，而拒绝是**业务结论**，host 的 agent 该拿它继续想。
文本里会明确写出缺什么，例如：

```
{"status": "PERMISSION_REQUEST", ...}

[HooH] 本次调用**没有人可以确认**（MCP 是 headless 通道），已按 fail-close 拒绝。
要让这一步通过，用户需要二选一：① 让 HooH 的权限档允许这个工具（--permission write|full …）；
② 签一张覆盖它的授权令（python -m cli.ace_mandate issue ...）。
不要重试同一个调用，也不要换别的工具绕过它。
```

对照：**未知工具**才是 JSON-RPC 错误（`-32602`），因为那是调用方写错了名字，不是"这一步被拒"。

## 四、日志与台账

- **stderr**：`（MCP server 就绪 · HooH x.y.z · 权限 … · 沙箱 … · 项目 …）` + 引擎的所有提示。
- **请求是串行处理的**：一次只跑一个工具，按到达顺序应答（MCP 客户端通常等应答再发下一条）。
  这带来一个已知取舍：工具跑得久时，同时发来的通知要等它结束 —— 第一版不做并发工具执行，
  理由是执行层里的快照 / 台账 / `pending_permission` 都是"一次一个"的语义。
- **单条消息上限 8 MiB**（`core/ace_mcp_server.py::MAX_LINE_BYTES`）。MCP 把 `arguments`
  整包放进**一行** JSON，所以"文件内容"这种参数天然撑长行：探针实测 2 MiB 的 `file_write`
  要能过、9 MiB 会给一条说明白的 `-32600`，而且那条错误**会把 id 带回来**（第一版回
  `id: null`，客户端会一直等它自己那个 id —— 探针第一次跑就死等了 600 s）。host 侧可能设
  更小的上限，那是它的事；要传更大的内容请分块（还没有分块写工具，这是已知限制）。
- **会话台账**：每个 server 进程一份 `<项目>/.ace_sessions/<时间戳>.jsonl`，
  每次调用都在里面（`source=mcp` 的守卫记录 + 工具结果），每条带 MAC（RG-02 链式签名），
  所以"外部 agent 到底动过什么"是可核的，不是靠 host 的自述。
- 人看的汇总：`/audit stats`（在 HooH 里跑）会打出整链校验 + 两条测量；外部调用同样计入。

## 五、真 host 冒烟清单（这一条只能由人做）

1. 装好 host，把 HooH 写进它的 MCP 配置（第一节）；
2. 让它"读一下 README 的第一行"——预期：成功（只读档够用）；
3. 让它"把某文件改一行"——**先不配令**。预期：被拒，且拒绝文本里能看到"权限档/授权令"；
4. 签令（第二节）填进配置，重启 host，重来第 3 步——预期：成功；
5. `/audit stats`（或人读那份 `.jsonl`）确认事件与令的使用都在。

这五步走完才叫"有人用过"。协议测试全绿（`test_all [72]` + `e2e/mcp_probe.py`）**不算**。

## 六、明确不做（第一版）

- 不做 `elicitation`（服务端反向问用户）：靠"默认拒绝 + 令放行"就够，且不假定 host 支持它。
- 不做 `resources` / `prompts` 能力：HooH 的价值在执行。
- 不做 TCP / HTTP / SSE transport：stdio 已经给出"进程生死绑定 + 无需认证 + 无需端口"。
- 不暴露 `subagent` / `goal_*` / `todo_write` / `plan_propose` / `request_permission` /
  `image_generate`：前几个是 HooH 自己对话循环的控制面或 host 本来就有的东西，
  最后一个会产生外部费用且与"能不能动这个对象"无关。**白名单**写在
  `core/ace_mcp_server.py::MCP_TOOL_NAMES`，要加工具得有人显式加一行。

排障入口：`python e2e/mcp_probe.py -v`（它自己就是脚本 host，会把子进程的 stderr 一起打出来）。
