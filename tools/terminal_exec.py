#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools.terminal_exec —— 命令执行（三值判定 + 审批闸门 + Go 执行器边界）

R-02（v3.9）：从 tools/file_tools.py 原样切出——方法体逐字节未改，只搬运。
共享常量在 tools/file_common.py。
"""

import os
import re
import subprocess
from typing import Any, Dict, Optional

from core import ace_execpolicy as execpolicy
from tools.base import MAX_COMMAND_LENGTH, sensitive_target
from tools.docker_sandbox import DockerUnavailable
from tools.file_common import _CMD_BUILTIN_BASES
from tools.result import ExecutionResult


class TerminalExec:
    def _evaluate_exec_command(self, cmd: str) -> "execpolicy.Verdict":
        """terminal_exec 判定：execpolicy 三值判定 + 敏感目标扫描

        两层是**互补**的，不是重复：

        - `ace_execpolicy` 管"这个动作本身有多坏"——不可逆删除、格式化、持久化、
          下载即执行、关闭防御。它是纯函数，所以每条拒绝路径都能被单测覆盖，
          不必真的把 `format C:` 跑起来。
        - `sensitive_target()` 管"这条命令碰的是什么"——凭据文件、私钥、自启动
          目录、系统目录。execpolicy 里**没有**这一层。

        所以不能整份换过去。`type %USERPROFILE%\\.ai_code.json` 在 execpolicy 眼里
        只是"含 shell 元字符"（`%`）→ prompt 档，人点一下 y 凭据就出去了；
        而它在这里必须是 forbidden —— 无论谁点头都不执行。
        """
        verdict = execpolicy.evaluate_command(cmd, str(self.project_root),
                                              sandbox=self.sandbox_policy)
        if verdict.forbidden:
            return verdict
        # 逐 token 判定，覆盖未展开的 %USERPROFILE%\.ai_code.json、
        # ~/.ssh/authorized_keys 这类写法（展开后再看就晚了）
        for token in re.split(r"[\s'\"=]+", cmd):
            if not token or len(token) < 3:
                continue
            reason = sensitive_target(token)
            if reason:
                return execpolicy.Verdict(
                    execpolicy.DECISION_FORBIDDEN,
                    f"命令触及敏感目标（{reason}）: {token}",
                    "sensitive_target",
                    normalized=verdict.normalized,
                    hits=list(verdict.hits) + [
                        ("sensitive_target", execpolicy.DECISION_FORBIDDEN, reason)])
        return verdict


    @staticmethod
    def _is_cmd_builtin(argv0: str) -> bool:
        """argv[0] 是不是 Windows cmd 的内建命令（因而只能经 shell 跑）。

        宿主分支和 Go 执行器分支都要问这一句，所以抽出来：两边答案不一致的话，
        同一条 `echo ok` 会在一条路上跑通、在另一条路上 spawn 失败。
        """
        if os.name != "nt":
            return False
        base = argv0.lower()
        if base.endswith(".exe"):
            base = base[:-4]
        return base in _CMD_BUILTIN_BASES


    def _exec_via_go(self, cmd: str, verdict: "execpolicy.Verdict",
                     approved: bool) -> Optional[ExecutionResult]:
        """把命令交给 Go 执行器执行。返回 None = 这条路走不了，由调用方决定后果。

        返回 ExecutionResult 的情况有两种，都不该被重试：执行成功，以及执行器
        **明确拒绝**（策略复检不通过、超时、沙箱不可用）。拿到拒绝之后回落到宿主
        重跑，等于绕过它刚刚给出的拒绝。
        """
        client = self._go_executor()
        if client is None:
            return None
        from core import ace_executor as _ax
        want_tier = _ax.TIER_JOB_OBJECT if self.sandbox_mode == "job" else None
        if want_tier and want_tier not in client.sandbox_available():
            return None   # 本平台没有 Tier-1（非 Windows），交回调用方

        # allow 档有干净的 argv，压根不经 shell。prompt 档（已获批准）往往正是靠
        # 管道/重定向才需要 shell，这时把整条字符串作为**单个** argv 元素交给平台
        # shell —— 让 shell 跑在边界**里面**。
        #
        # 这不是把命令注入放回来：这条字符串刚刚由人逐字看过并点头，而边界是 Job
        # Object，不是"没有 shell"。job 档下如果因为"执行器只收 argv"就把这类命令
        # 踢回宿主，边界就等于没有 —— 那比让 shell 在 Job 里跑坏得多。
        #
        # 例外是 cmd 内建命令（echo / dir / type ...）：它们不是磁盘上的可执行文件，
        # 执行器按 argv[0] 去 PATH 里找必然 E_SPAWN_FAILED。宿主分支早就有这一层
        # （见 _CMD_BUILTIN_BASES 与 _exec_terminal_exec 结尾），这里必须同样处理，
        # 否则 `echo ok` 这种最普通的 allow 档命令一进执行器就挂。
        if verdict.allowed and verdict.argv and not self._is_cmd_builtin(verdict.argv[0]):
            argv = list(verdict.argv)
        elif os.name == "nt":
            argv = ["cmd", "/c", cmd]
        else:
            argv = ["/bin/sh", "-c", cmd]

        try:
            out = client.exec_command(
                argv, cwd=str(self.project_root), tier=want_tier,
                # job 档不许降档：允许降档等于"用户要了 Job Object，实际拿到 tier0"，
                # 而他不会知道。off 档无所谓，那本来就没承诺任何边界。
                allow_weaker_tier=(self.sandbox_mode != "job"),
                policy=_ax.verdict_to_policy(verdict, user_approved=approved))
        except _ax.ExecutorError as e:
            if e.code == "E_TRANSPORT" and self.sandbox_mode != "job":
                # 会话本身断了，不是执行器在拒绝。off 档没承诺边界，回落到宿主。
                self.use_go_executor = False
                self._go_client = None
                return None
            if e.code == "E_SPAWN_FAILED" and self.sandbox_mode != "job":
                # 进程压根没起来（argv[0] 不在 PATH 上），既不是策略拒绝也不是边界失效，
                # 回落到宿主重跑不构成"绕过拒绝"——什么都还没执行。宿主的 shell=True
                # 能多认一些东西（.bat / .cmd / doskey），认不出来也会给出更好读的报错。
                # 注意这里**不**关掉执行器：这是单条命令的事，不是会话级故障。
                return None
            return ExecutionResult(

                status="error", error_code=e.http_like,
                message=f"Go 执行器拒绝或终止了该命令：{e.message}",
                metadata={"executor": {"code": e.code, "data": e.data}})
        except Exception:
            if self.sandbox_mode == "job":
                return None
            self.use_go_executor = False
            self._go_client = None
            return None

        if self.sandbox_mode == "job" and out.degraded:
            # 只部分生效就报错。给出一个自己都不确定的隔离保证，比明确说"做不到"更糟。
            return ExecutionResult(
                status="error", error_code="503",
                message=f"Job Object 只部分生效（{out.sandbox_applied}），已拒绝执行。")

        return ExecutionResult(status="success", data={
            "stdout": out.stdout,
            "stderr": out.stderr,
            "returncode": out.exit_code,
            "truncated": out.truncated,
            "executor": "go",
            "sandbox": out.sandbox_applied,
        })


    def _exec_terminal_exec(self, params: Dict) -> ExecutionResult:

        """写入权限下的真实终端执行（受权限门 + 三值判定 + 快照回滚保护）

        三条出口：
            forbidden → 403，任何审批都覆盖不了
            allow     → argv + shell=False 执行（不经 shell，元字符天然失效）
            prompt    → 问 approval_hook；无 hook 或被拒 → 403
        """
        cmd = (params.get("command") or "").strip()
        if not cmd:
            return ExecutionResult(status="error", error_code="400", message="command 参数为空")
        if len(cmd) > MAX_COMMAND_LENGTH:
            return ExecutionResult(status="error", error_code="400", message="命令过长")

        # 判定先行，且传的是原始 cmd：任何"先展开再判定"的顺序都会让判定看到的
        # 字符串与实际执行的不一致。
        verdict = self._evaluate_exec_command(cmd)
        if verdict.forbidden:
            return ExecutionResult(
                status="error", error_code="403",
                message=(f"命令被安全策略拒绝（{verdict.reason}），已拦截。"
                         f"如确需执行请在终端手动操作。"),
                metadata={"policy": {"decision": verdict.decision, "rule": verdict.rule}})

        approved = False
        if verdict.needs_approval:
            # on_failure 档（"沙箱内失败后才问"）：真实边界（docker/job）生效时
            # **先试后问** —— 让边界拦，失败无害（sandbox_denied 会如实上报并带
            # denied_hint），不打断用户；被拒后模型自然换做法。无真实边界时这一档
            # 退回 on_request 语义（询问），避免"先试"退化成裸跑。
            _sandbox_active = (self.docker_sandbox is not None
                               or self.sandbox_mode == "job")
            if (self.approval_policy == execpolicy.ApprovalPolicy.ON_FAILURE
                    and _sandbox_active):
                approved = True
            elif self.approval_hook is None:
                # 无人可问 → 拒绝。方向必须朝安全：把非交互场景的默认答案写成 "y"
                # 正是 SEC-004 那类事故的成因。
                return ExecutionResult(
                    status="error", error_code="403",
                    message=(f"命令需要人工确认但当前无审批通道：{verdict.reason}。"
                             f"可改用只读的 terminal_view，或拆成不含 shell 元字符的单条命令。"),
                    metadata={"policy": {"decision": verdict.decision, "rule": verdict.rule,
                                         "approval": "unavailable"}})
            else:
                try:
                    approved = bool(self.approval_hook(verdict))
                except Exception as e:
                    # 只把异常**类型**给模型：hook 由上层注入，它的异常文本不受本层控制，
                    # 完全可能把路径甚至凭据带进来（FileNotFoundError 的 str 就带路径）。
                    return ExecutionResult(
                        status="error", error_code="500",
                        message=f"审批回调异常（{type(e).__name__}），按拒绝处理",
                        metadata={"error": {"action": "approval_hook",
                                            "type": type(e).__name__, "detail": str(e)},
                                  "policy": {"decision": verdict.decision, "rule": verdict.rule}})
                if not approved:
                    return ExecutionResult(
                        status="error", error_code="403",
                        message=f"用户拒绝执行：{verdict.reason}",
                        metadata={"policy": {"decision": verdict.decision, "rule": verdict.rule,
                                             "approval": "denied"}})

        ok, why = execpolicy.should_execute(verdict, self.approval_policy,
                                           user_approved=approved)
        if not ok:
            return ExecutionResult(
                status="error", error_code="403", message=f"命令未获执行许可：{why}",
                metadata={"policy": {"decision": verdict.decision, "rule": verdict.rule}})

        # docker 沙箱：启用后命令跑在一次性容器里，宿主拿不到。这是这个工具唯一
        # 真正的边界——shell=True 的宿主分支靠判定层是拦不住一切的。
        # 注意不做静默回退：沙箱开了但 docker 挂了就报 503，绝不偷偷改回宿主执行，
        # 否则用户以为在容器里跑，实际在自己机器上跑，而且毫无提示。
        # 容器只接受 shell 字符串，所以这里不分 allow / prompt 档。
        if self.docker_sandbox is not None:
            try:
                out = self.docker_sandbox.run_shell(cmd)
            except DockerUnavailable as e:
                return ExecutionResult(
                    status="error", error_code="503",
                    message=(f"docker 沙箱不可用（{e}），已拒绝执行。"
                             "启动 Docker 后重试，或用 --sandbox off 显式改回宿主执行。"))
            if out["timeout"]:
                return ExecutionResult(status="error", error_code="504",
                                       message=out["stderr"])
            denied = bool(out.get("sandbox_denied"))
            return ExecutionResult(status="success", data={
                "stdout": out["stdout"],
                "stderr": out["stderr"],
                "returncode": out["returncode"],
                "sandbox_denied": denied,
                "sandbox": {"kind": "docker", "image": self.docker_sandbox.image,
                            "network": self.docker_sandbox.network,
                            "mount": "/work",
                            # 实际用的镜像是哪一份摘要 —— 镜像现在默认从 registry 拉，
                            # 不给摘要的话"我到底跑在什么上面"就答不上来（取证也要它）。
                            "image_digest": self.docker_sandbox.image_digest or None,
                            "denied_hint": ("沙箱策略拒绝（只读根文件系统/权限），"
                                            "不是命令失败——请改用不触碰该边界的方式"
                                            if denied else None)},
            })

        # Go 执行器：Tier-1 Job Object。docker 之后、宿主之前。
        #
        # 它解决的是 docker 解决不了的那个场景：docker 没装 / 没起来的机器上，
        # 宿主直跑连"把整棵进程树收干净"都做不到 —— Python 的 Process.Kill() 只杀
        # 直接子进程，孙进程会变孤儿继续跑。Job Object 是 OS 原语，Python 侧拿不到，
        # 这是把执行搬出进程的唯一理由；判定仍然在上面的 execpolicy 完成。
        if self.sandbox_mode == "job" or (verdict.allowed and verdict.argv):
            go_result = self._exec_via_go(cmd, verdict, approved)
            if go_result is not None:
                return go_result
            if self.sandbox_mode == "job":
                # job 档要的就是这个边界。拿不到就报错，绝不静默回落到宿主 ——
                # 和 docker 那条同一个原则：用户以为在 Job 里跑、实际在自己机器上跑，
                # 而且毫无提示，是最坏的一种"能用"。
                return ExecutionResult(
                    status="error", error_code="503",
                    message=("Job Object 沙箱不可用（执行器未编译、起不来，或本平台"
                             "不支持 Tier-1），已拒绝执行。补执行器的两条路："
                             "`ace --install-executor`（官方预编译，替代手工编译）"
                             "或在 executor/ 下 `go build -o ace-executor.exe .`；"
                             "或用 --sandbox off 显式改回宿主执行。"))


        # 不经 shell 则连"万一漏了一个元字符"的余地也没有。
        # 例外是 Windows 的 cmd 内建命令（echo / dir / type / copy / md ...）——
        # 它们不是可执行文件，argv + shell=False 会得到 FileNotFoundError。
        # 这类命令交给 shell 是安全的：元字符在第 2 关就已经被排除干净了。
        target: Any = cmd
        use_shell = True
        if verdict.allowed and verdict.argv and not self._is_cmd_builtin(verdict.argv[0]):
            target, use_shell = verdict.argv, False

        try:
            result = subprocess.run(target, shell=use_shell, capture_output=True, text=True,  # nosec B602 —— 三值判定(allowlist) + 元字符闸门在前面两层；shell 仅兜 cmd 内建命令（见上方注释）
                                    timeout=30, cwd=str(self.project_root),
                                    stdin=subprocess.DEVNULL)
            return ExecutionResult(status="success", data={
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            })
        except subprocess.TimeoutExpired:
            return ExecutionResult(status="error", error_code="504", message="命令执行超时（30 秒）")
        except Exception as e:
            return ExecutionResult(status="error", error_code="500", message=str(e))
