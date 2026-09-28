# typesafe-jev

一个把 TypeSafe **Jev**（System One 结构化语义判断模型）接入 WorkBuddy 的 Skill + MCP 组合包。用于对给定状态做**类型化判断**：分类（choice）、评分（score）、是非（noul），返回带概率/置信度的可分支、可排序结果。

> 适用：Agent 需要"对一个状态给出一个可比较、可排序的结构化结论"时，把这件事交给 Jev，而不是让宿主模型凭感觉猜。

---

## 功能简介

| 能力 | 说明 |
| --- | --- |
| **结构化判断** | 对 `state` 做三类判断：`noul`（是非）、`choice`（封闭集单选）、`score`（2–10 级评分） |
| **概率/置信度** | `noul` 返回"yes"概率；`choice`/`score` 额外返回置信度 |
| **一批多问** | 一次请求可对同一 `state` 同时问多个独立问题，各自独立评估 |
| **本地 MCP 适配** | `server.py` 是 stdio MCP 适配器，把 `jev_evaluate` 暴露为 MCP 工具 |

**边界（skill 本身不做的）**：不取源数据、不写解释、不替宿主选下一步。它只对"你喂进来的状态"做判断，结果由宿主工作流解释和使用。

**依赖**：
- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/)（启动 MCP server 用）
- TypeSafe API key（`TYPESAFE_API_KEY`）
- WorkBuddy（或任何支持 MCP 的宿主）用于加载 server

---

## 安装指令

### 1. 安装 Skill

把本目录的 `skills/typesafe-jev/`（`SKILL.md` + `agents/openai.yaml`）复制到用户级 skill 目录：

```bash
mkdir -p ~/.workbuddy/skills/typesafe-jev
cp skills/typesafe-jev/SKILL.md skills/typesafe-jev/agents/openai.yaml ~/.workbuddy/skills/typesafe-jev/
```

### 2. 部署 MCP server

把 MCP server 代码放到一个固定目录（下面用 `~/.workbuddy/typesafe-jev-server`），并安装锁定依赖：

```bash
mkdir -p ~/.workbuddy/typesafe-jev-server
# 复制 server.py / pyproject.toml / uv.lock / .mcp.json / README.md 到该目录
uv sync --locked        # 在 server 目录内执行，安装 mcp 依赖
```

### 3. 配置 MCP 到 WorkBuddy

WorkBuddy 的 MCP 配置入口：**侧边栏 → 插件 → 右上角「MCP 服务器」→「配置 MCP」**，在编辑器里粘贴以下 JSON 并保存：

```json
{
  "mcpServers": {
    "typesafe-jev": {
      "command": "uv",
      "args": [
        "run",
        "--project",
        "C:\\Users\\Administrator\\.workbuddy\\typesafe-jev-server",
        "--locked",
        "python",
        "C:\\Users\\Administrator\\.workbuddy\\typesafe-jev-server\\server.py"
      ],
      "env": {}
    }
  }
}
```

> 把路径替换为你实际的 server 目录。保存后界面应显示 `typesafe-jev` 状态灯 🟢（绿 = 连接成功；🔴 = 异常，需检查路径/命令环境）。

### 4. 验证

在对话中让 Agent 调 `jev_evaluate`，或直接对 server 做 MCP 握手：

```bash
cd ~/.workbuddy/typesafe-jev-server
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}' \
  | uv run --project . --locked python server.py
```

看到返回 `serverInfo.name = "typesafe-jev"` 即成功。

---

## 配置方法

### API key（必须）

MCP server 从 `TYPESAFE_API_KEY` 读取 TypeSafe key，两个来源二选一：

| 来源 | 方式 | 适用 |
| --- | --- | --- |
| **环境变量** | 设置用户级环境变量 `TYPESAFE_API_KEY` | 命令行 / 服务器 |
| **Windows 注册表** | 在 `HKCU\Environment` 下建字符串值 `TYPESAFE_API_KEY` | WorkBuddy 桌面端（MCP 子进程读取） |

> 桌面端优先用**注册表**：MCP 子进程可在不把密钥写进配置文件/Git 历史的情况下读到。
> 密钥不落盘、不进配置、不进 Git。

### 调用方式（给宿主模型）

`jev_evaluate` 参数：

```json
{
  "state": { "任何 JSON 状态" },
  "questions": {
    "q1": { "type": "noul", "instructions": "一个明确的 yes/no 陈述" },
    "q2": {
      "type": "choice",
      "instructions": "从封闭集中选一个",
      "criteria": { "A": "描述", "B": "描述", "other": "都不符合时" }
    },
    "q3": {
      "type": "score",
      "instructions": "按 2–10 级打分",
      "criteria": [ {"label": "1", "description": "..."}, {"label": "10", "description": "..."} ]
    }
  }
}
```

**最佳实践**：
- 一次只问一个窄判断；独立问题可同批发（互不构成上下文）。
- 依赖前一个答案的问题，等结果出来再发第二轮。
- 需要"都不支持所列答案"时，显式加 `other`/`none`/`unknown` 选项。
- 确定性逻辑（精确查表、算术、日期比较）留在代码里，别交给 Jev。

---

## 常见问题

### Q1：在 WorkBuddy 的「自定义连接器」里找不到 typesafe-jev？
**入口不对。** MCP 不是 connector 管理页。正确入口是 **侧边栏 → 插件 → 右上角「MCP 服务器」→「配置 MCP」**。配置保存后才会加载。

### Q2：配置保存了，但对话里调不到 `jev_evaluate`？
确认两点：
1. 状态灯是否为 🟢 绿色（🔴 = server 启动失败）。
2. 是否**重启过 WorkBuddy**。改 MCP 配置后常需重启才在运行时生效。

### Q3：报 "TypeSafe API key is not configured"？
`TYPESAFE_API_KEY` 没被 MCP 子进程读到。桌面端请在 `HKCU\Environment` 注册表设置，**不要只设当前终端会话的环境变量**（MCP 子进程不一定继承）。

### Q4：报 "TypeSafe rejected the API key (401)"？
Key 本身无效或过期。去 TypeSafe 控制台重新生成 key，更新注册表后重启 WorkBuddy。

### Q5：MCP server 能启动，但调用卡住/超时？
- 网络访问 `api.typesafe.ai` 是否通畅（可能需要代理）。
- server 内置 2 次重试 + 60s 超时，429/529 会退避重试；持续超时先排查网络。

### Q6：为什么加了 `cwd` 字段却报错？
WorkBuddy 的 MCP 解析器可能不认 `cwd` 字段。**不要加 `cwd`**，直接在 `args` 里用 `server.py` 的**绝对路径**启动（见上文配置 JSON）。

### Q7：这个 skill 和直接问模型有什么区别？
Jev 是**独立的、类型化的、可比较的判断引擎**，返回概率/置信度，适合需要跨样本排序、分支决策的场景。宿主模型负责喂状态、解释结果、决定下一步。确定性规则请留在代码。

---

## 参考

- [TypeSafe API](https://docs.typesafe.ai/api)
- [TypeSafe primitives](https://docs.typesafe.ai/primitives)
- [TypeSafe workflow 设计](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
