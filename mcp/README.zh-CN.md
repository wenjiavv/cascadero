# cascadero-mcp（卡斯卡德罗 MCP 服务）

一个 [MCP](https://modelcontextprotocol.io) 服务：让 AI（Claude Code、Claude Desktop、Cursor 等任何支持 MCP 的客户端）
**只靠文字工具调用**就能和内置电脑下完整的卡斯卡德罗——不截屏、不用视觉模型。它包的是网页版和联机牌桌共用的那套
无头规则引擎，所以每一个答复都经过真实规则校验。

## 安装

需要 Node.js 20+。在仓库根目录：

```bash
cd mcp && npm install
python3 ../online/build-engine.py     # 生成 online/engine.js；文件缺失或过期时服务启动也会自己生成
```

Claude Code 里一条命令装上：

```bash
claude mcp add cascadero -e CASC_MCP_LANG=zh -- node /绝对路径/cascadero/mcp/src/index.mjs
```

其他客户端在它的 MCP 配置里加：

```json
{ "mcpServers": { "cascadero": { "command": "node", "args": ["/绝对路径/cascadero/mcp/src/index.mjs"], "env": { "CASC_MCP_LANG": "zh" } } } }
```

然后对 AI 说一句「和普通档下一局卡斯卡德罗」即可，或使用 `cascadero_play` 提示词。

| 环境变量 | 含义 |
|---|---|
| `CASC_MCP_DATA` | 对局存档、对局记录、赛后笔记的目录（默认 `~/.cascadero-mcp`） |
| `CASC_MCP_LANG` | `en`（默认）或 `zh`：对局日志和手册的语言 |
| `CASC_ENGINE` | 指定另一份 `engine.js` |

## 工具

| 工具 | 作用 |
|---|---|
| `new_game` | 开局：座位（`agent` / `easy` / `normal` / `hard`，2–4 个）、版图（`front` 正面 / `back` 背面农夫板）、先手、颜色、使者棋起始组、语言 |
| `get_state` | 完整局面 + 上次调用以来发生了什么 + 正在等的决策；可附字符地图 |
| `list_moves` | 合法落点及精确事实：相邻城镇、哪座城计分几格、模拟结果、农夫板块、安静着法能铺垫什么；`filter` = `scoring` / `setup` / `all`，`near` = 某城或某格 |
| `inspect` | 某城 / 某格的精确邻接；如果格上有使者，给出它所在的群和这个群已经不能再计分的城镇 |
| `place_envoy` | 主动作：放使者（`field`，可选 `use_seal`） |
| `choose_track` | 回答「任选一个方块推 1 格」（连锁格或农夫板块） |
| `move_envoy` | 回答「印章已被拿走，可移动一枚使者」 |
| `move_herald` | 回答农夫板块「移动使者棋」 |
| `engine_advice` | 问内置电脑（普通 / 困难）此刻会怎么答 |
| `undo` | 撤回自己上一手，电脑重新应对 |
| `list_games` | 存档列表；把 id 作为 `game_id` 传给任意工具即可续下未完成的对局 |
| `get_rules` | `handbook`（规则摘要 + 工具用法 + 策略 + 以前记下的教训）、`tracks`、`board_front`、`board_back` |
| `save_postgame_notes` | 记下一局的教训；最近五条会自动附在手册后面 |

每个动作都会返回后果、对手的应对和下一个要做的决策，AI 只需要循环「看 → 想 → 做」。不合法的答复以工具错误返回并说明
原因（城镇格、已被占、农夫格未解锁、此处用印章无效、方块被禁行格挡住、决策类型不对……），不会改变局面。

资料：`cascadero://handbook`、`cascadero://handbook/zh`、`cascadero://tracks`、`cascadero://board/front`、
`cascadero://board/back`、`cascadero://postgame/{name}`。提示词：`cascadero_play`。

## 说明

- 可以有多个 `agent` 座位：待决策里总会写明是哪个座位，所以一个 AI 可以左右互搏，两个 AI 也可以同桌。
- 下完的对局追加到 `gamelog.jsonl`，格式与联机牌桌的对局记录一致（开局快照 + 决策序列）。
- `npm test` 用脚本化客户端走真实协议下三整局，并检查非法答复、撤销、赛后笔记、重启续局。

非官方爱好者项目，见仓库 NOTICE.md。
