# 工程债与交接（Hand-off）

> 从 README 迁出。这是**交接清单**，不是待办的第二份副本：每行只说一句"欠什么"，
> 真正的证据、决定与边界都在那份**立项卡**里 —— **别把这张表当完整说明，点进去看卡**。
>
> **界面口径已经变过一次**（后加的注，见 [`docs/TUI-ENGINE.md`](TUI-ENGINE.md)）：
> 组件化全屏界面（Textual）已废弃，现在是**主屏两车道引擎**（转录进终端原生 scrollback，
> 状态行/输入行是帧缓冲 + 脏矩形），真终端下默认。下面"仍未验证"那节里提到的
> Textual / 备用屏结论只对**当时**有效。

## 还没做完的（附权威记录）

| 欠什么 | 一句话 | 权威记录 |
|---|---|---|
| **验收门槛还剩收尾** | 四道 ACC 门槛的机器那一半、A0b（`measured_*` 聚合）、**阈值判据**（`token_verdict`，暂用阈值 50%）都已落地；**只剩** `benchmarks/results/` 接校验器（要等 WP-10 的"下沉前/后可复核数据"） | [`docs/design/ACC-GATES.md`](design/ACC-GATES.md) §7.5 / §8.6 / §10.4 |
| **脊柱全落地（仅 HL-04 的 ACC 接线待 WP-10）** | `RL-01~04` · `DL-01~04` · `HL-01/02/03/05` 已落地；`HL-04` 的可判定机器也已落地（§9.14：`MaterialIncomplete` + `build_material` + `[73]` 五种偷换），只剩「接 ACC 门槛」仍被 WP-10 的 before/after 数据卡着 | [`docs/design/THREE-LAYERS.md`](design/THREE-LAYERS.md) §9 |
| **只剩批次 6 与 WP-10** | 批次 −1…5 已关闭；**批次 6** = 非 URL 出网通道（WP-8 后半，**Linux seccomp 已落地**，Windows 仍待 WFP / macOS 仍待 seatbelt）＋ CubeSandbox 沙箱后端（WP-9）；**WP-10** = Rust 核心化（**快照哈希下沉已实测否决**，见 engine/README.md；**grep/glob 也已实测否决**——regex 语义 + 零依赖 + 非热路径；剩 **流式客户端 / LSP / 路径判定下沉**） | [`docs/ROADMAP.md`](ROADMAP.md) §7.2 |

## 仍未验证

- **真 TTY 下的 Textual 全屏界面**、以及任何**非 Windows 控制台**。（CI 已装 `textual` 跑通 headless `run_test` 那几段；但"人在真终端里打字"这件事，无头 runner 验不了，仍需一台真机。）
- ~~darwin/amd64 执行器原生冒烟~~ —— 已补：`release-executor.yml` 的 `native-smoke` 加 `macos-13`（Intel runner）。

## 为什么停在这里

作者要上学 —— 这个仓库已经推到作者**当前能做的极限**，是**逐条实测**推出来的，不是"懒得做"：

- **能做的都做完了**：HL-04（脊柱收口，机器早已接线、补了记录）、WP-8 Linux 非 URL 出网（seccomp 真验）、冒烟上 CI（Textual + darwin/amd64）、grep / 快照哈希**实测否决**（不搬是有数据支撑的决定，不是没搬）。
- **剩下的每一项都不是"再努把力"能越过的**：WP-9 要一台 KVM 真机（本机没有）；WP-8 Windows 要 WFP（内核级，Go 执行器范围外）；WP-10 的 LSP / 路径判定是多日工程量、且路径判定要字节级对拍；ACC 卡在 WP-10 的"下沉前/后数据"——而那个下沉项已经被实测否决了。

这份清单就是交接 —— 每一行都指到那张卡，卡里写着证据、边界，以及"下一步该做什么"。
