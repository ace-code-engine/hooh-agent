#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools.code_tools —— 代码执行沙盒与计算工具（code_execute / math_calc / datetime_now）"""

import ast
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Dict

from tools.base import MAX_CODE_LENGTH
from tools.docker_sandbox import DockerUnavailable
from tools.result import ExecutionResult


def _is_frozen() -> bool:
    """当前进程是否来自 PyInstaller 冻结包（单目录 / 单文件）。

    为什么要有这个判断：冻结后 `sys.executable` 是 ace.exe 自己，**不是** Python
    解释器。凡是"拿 sys.executable 去跑一段 Python"的地方都会静默变味，必须显式分支。
    `sys.frozen` 由 PyInstaller 的引导代码设置；`_MEIPASS` 是它的解包目录，两者取或
    即可覆盖单文件与单目录两种形态。抽成函数是为了让测试能注入判据，不必真的打包。
    """
    return bool(getattr(sys, "frozen", False) or hasattr(sys, "_MEIPASS"))



class CodeTools:
    DANGEROUS_CALLS = {
        "os.system", "os.popen", "os.spawnl", "os.spawnv", "os.execl", "os.execv",
        "subprocess.call", "subprocess.run", "subprocess.Popen",
        "subprocess.check_output", "subprocess.check_call",
        "socket.socket", "socket.connect", "socket.create_connection",
        "shutil.rmtree", "os.remove", "os.unlink", "os.rmdir", "os.removedirs",
    }
    # 整模块禁用导入（含别名导入、from x import y）。
    # 注意：黑名单枚举不可能闭合——补掉一批等价物只是抬高门槛，不是边界。
    # nt 是 CPython 内建（os.system 实际就是 nt.system）；pathlib 能绕过 open() 拦截
    # （Path.write_text）；runpy/webbrowser 都能触发外部执行。
    DANGEROUS_MODULES = {"subprocess", "socket", "ctypes", "os", "nt", "shutil",
                         "importlib", "pickle", "marshal", "multiprocessing",
                         "pty", "builtins", "sys", "pathlib", "runpy",
                         "webbrowser", "posix"}
    DANGEROUS_FUNCS = {"eval", "exec", "compile", "__import__",
                       "globals", "locals", "vars", "getattr", "setattr",
                       "delattr", "input", "breakpoint"}
    DANGEROUS_NAMES = {"__builtins__", "__loader__", "__spec__", "__import__"}
    DANGEROUS_ATTRS = {"__class__", "__bases__", "__subclasses__", "__globals__",
                       "__mro__", "__builtins__", "__code__", "__dict__",
                       "__getattribute__", "__getattr__"}

    @staticmethod
    def _qualname(node) -> str:
        parts = []
        cur = node
        while isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            parts.append(cur.id)
        return ".".join(reversed(parts))

    def _scan_dangerous_calls(self, code: str) -> str:
        """策略层沙箱 AST 扫描：拦截危险导入/调用/内建逃逸，返回拦截描述（空串 = 通过）

        注意：这是进程内静态策略层，不是 OS 级隔离；生产环境请配合容器/虚拟机使用。
        """
        try:
            import ast
            tree = ast.parse(code)
        except SyntaxError:
            return ""   # 语法错误交给 ASTDetector 报告
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[0] in self.DANGEROUS_MODULES:
                        return f"沙箱禁止导入模块: {alias.name}"
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module.split(".")[0] in self.DANGEROUS_MODULES:
                    return f"沙箱禁止导入模块: {node.module}"
            elif isinstance(node, ast.Name):
                if node.id in self.DANGEROUS_NAMES:
                    return f"沙箱禁止访问内建对象: {node.id}"
                # 引用级拦截（SEC-01）：危险内建只要被“读到”就拒绝——
                # 否则 f=open / (lambda: exec) 这类先取引用再调用的写法能绕过调用点黑名单。
                if (isinstance(node.ctx, ast.Load)
                        and (node.id in self.DANGEROUS_FUNCS or node.id == "open")):
                    return f"沙箱禁止引用危险内建: {node.id}（别名/间接调用同样禁止）"
            elif isinstance(node, ast.Attribute):
                if node.attr in self.DANGEROUS_ATTRS:
                    return f"沙箱禁止访问: .{node.attr}"
            elif isinstance(node, ast.Call):
                name = ""
                f = node.func
                if isinstance(f, ast.Name):
                    name = f.id
                elif isinstance(f, ast.Attribute):
                    name = self._qualname(f)
                if name in self.DANGEROUS_CALLS or name in self.DANGEROUS_FUNCS:
                    return f"沙箱禁止调用: {name}"
                if name == "open":
                    return "沙箱内禁止使用 open()（文件读写请使用 file_read/file_write 工具）"
        return ""

    def _exec_code_execute(self, params: Dict) -> ExecutionResult:
        """代码执行（受限沙箱：AST 危险调用拦截 + 临时目录 + 环境变量清洗 + 超时）"""
        lang = params.get("language", "python")
        code = params.get("code", "")
        if lang != "python":
            return ExecutionResult(status="error", error_code="400",
                                   message=f"暂不支持语言: {lang}")
        if not code.strip():
            return ExecutionResult(status="error", error_code="400", message="code 参数为空")
        if len(code) > MAX_CODE_LENGTH:
            return ExecutionResult(status="error", error_code="400", message="代码过长（上限 100KB）")

        # 冻结发行（PyInstaller 单目录/单文件）下这条能力**必然**不可用，如实报 501。
        # 为什么：真正执行代码的是下面那句 `subprocess.run([sys.executable, tmp_file])`。
        # 冻结后 sys.executable 指向 ace.exe 自己，它不是一个 Python 解释器；而 minimize
        # env 又把 PATH 洗成最小集，PATH 上也找不到第二个解释器。结果会是"拿 ace.exe 去
        # 跑一个 .py" —— 表现为一个看不懂的启动错误，而不是一句人话。
        # 这里不悄悄退回"找系统 Python"：那会把"宿主机装没装 Python"变成行为差异，
        # 同一份发行版在两台机器上能力不同，比明确禁用更难排查（与 ACE 其余"不静默降级"一致）。
        if _is_frozen():
            return ExecutionResult(
                status="error", error_code="501",
                message="此发行形态（打包 exe）不提供 code_execute："
                        "冻结后 sys.executable 不是 Python 解释器，无法安全地跑代码。"
                        "需要它请用源码运行（git clone + python ai_code.py），"
                        "或改用 terminal_exec 执行外部命令。")

        # 沙箱 1：AST 危险调用拦截
        denied = self._scan_dangerous_calls(code)
        if denied:
            return ExecutionResult(status="error", error_code="403", message=denied)

        # docker 沙箱：整段代码丢进一次性容器，内存 / 进程数 / 网络都由内核约束。
        # 这里刻意保留上面的 AST 扫描：docker 可用性是运行时探测出来的，万一探测
        # 判断错了、或者镜像被换成没有隔离能力的东西，放宽黑名单就等于把一个检测
        # bug 直接变成逃逸口。两道一起留着，代价只是容器里也用不了 os/subprocess。
        if self.docker_sandbox is not None:
            try:
                out = self.docker_sandbox.run_python(code)
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
                            "memory": self.docker_sandbox.memory,
                            "timeout": self.docker_sandbox.timeout,
                            "image_digest": self.docker_sandbox.image_digest or None,
                            "denied_hint": ("沙箱策略拒绝（只读根文件系统/权限），"
                                            "不是命令失败——请改用不触碰该边界的方式"
                                            if denied else None)},
            })

        # Go 执行器（Tier-1 Job Object）：与 docker 同级的"跑起来能碰到什么"边界。
        # AST 扫描保留在上面（两层正交）：docker/执行器可用性是运行时探测的，
        # 探测错了也不至于把黑名单直接变成逃逸口。
        if self.use_go_executor:
            client = self._go_executor()
            if client is None and self.sandbox_mode == "job":
                # job 档要的就是这个边界：执行器拿不到就报 503，绝不静默回落到宿主。
                # 修之前这里**直接掉出 if 块** → 往下走宿主 subprocess.run；而同一个
                # "没有边界"的状态下 terminal_exec 是返回 503 的（terminal_exec.py 里
                # 的 `if self.sandbox_mode == "job"`）。同档位两种行为已经很糟，
                # 更糟的是静默的那一个恰好是更危险的 code_execute。
                return ExecutionResult(
                    status="error", error_code="503",
                    message=("Job Object 沙箱不可用（执行器未编译、起不来，或本平台"
                             "不支持 Tier-1），已拒绝执行。在 executor/ 下跑 "
                             "`go build -o ace-executor.exe .`，或用 --sandbox off "
                             "显式改回宿主执行。"))
            if client is not None:
                from core import ace_executor as _ax
                try:
                    out = client.exec_python(
                        code, cwd=str(self.project_root),
                        timeout_ms=30_000,
                        max_output_bytes=1 << 20,
                        max_memory_bytes=256 << 20,
                        max_child_processes=2,
                    )
                except _ax.ExecutorError as e:
                    # job 档是用户要的边界，起不来必须报错，绝不静默回落宿主
                    # （与 terminal_exec 的 _exec_via_go 同一条理由）。
                    if self.sandbox_mode == "job":
                        return ExecutionResult(
                            status="error", error_code="503",
                            message=f"Go 执行器失败（job 档不回落）: {e.code} {e.message}")
                    # off 档：协议损坏 / 沙箱档位不可用才回落进程内；
                    # 其余（超时已作为 outcome、策略拒绝等）如实上报。
                    if e.code in ("E_TRANSPORT", "E_SANDBOX_UNAVAILABLE"):
                        self.use_go_executor = False
                        client = None
                    else:
                        return ExecutionResult(
                            status="error", error_code="500",
                            message=f"Go 执行器执行失败: {e.code} {e.message}")
                if client is not None:
                    return ExecutionResult(status="success", data={
                        "stdout": out.stdout,
                        "stderr": out.stderr,
                        "returncode": out.exit_code,
                        "truncated": out.truncated,
                        "sandbox": {
                            "kind": "go-executor",
                            "tier": out.sandbox_applied.get("tier"),
                            "job_object": out.sandbox_applied.get("job_object"),
                            "restricted_token": out.sandbox_applied.get("restricted_token"),
                            "integrity_level": out.sandbox_applied.get("integrity_level"),
                            "degraded": out.degraded,
                        },
                    })

        # H-30：能走到这里 = docker 与 Go 执行器**都没有**（上面两条路各自 return 了）。
        # 那就只剩宿主进程内执行，而唯一的闸门是 AST 黑名单 —— 见 tools/base.py 里
        # `code_execute_host` 的注释（为什么默认 fail-close）。此前这里是**静默**落到
        # 宿主 subprocess.run 的，于是一个 PERM_WRITE、免逐次确认的工具可以在没有任何
        # 边界的情况下跑任意 Python。
        if not self.code_execute_host:
            return ExecutionResult(
                status="error", error_code="503",
                message=("code_execute 需要一条真正的执行边界：当前既没有 docker 沙箱"
                         "也没有 Go 执行器，已拒绝在宿主进程内执行。三条出路："
                         "① 起 docker 后改用 --sandbox docker；"
                         "② 在 executor/ 下 `go build -o ace-executor.exe .`"
                         "（或 `ace --install-executor`）拿到 Job Object 边界；"
                         "③ 明确接受「无边界」：配置 sandbox.code_execute_host = true。"))

        base = Path(self.sandbox_base) if self.sandbox_base else Path(tempfile.gettempdir())
        sandbox_dir = base / f"agent_sandbox_{uuid.uuid4().hex[:8]}"
        try:
            sandbox_dir.mkdir(parents=True)
        except Exception as e:
            return ExecutionResult(status="error", error_code="500",
                                   message=f"沙箱目录创建失败: {e}")
        tmp_file = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False,
                                             encoding="utf-8", dir=sandbox_dir) as f:
                f.write(code)
                tmp_file = f.name
            # 沙箱 2：最小环境变量（剥离密钥/代理等敏感信息）
            minimal_env = {
                "PATH": os.environ.get("PATH", ""),
                "SystemRoot": os.environ.get("SystemRoot", ""),
                "WINDIR": os.environ.get("WINDIR", ""),
                "TEMP": str(sandbox_dir),
                "TMP": str(sandbox_dir),
                "COMSPEC": os.environ.get("COMSPEC", ""),
                "PYTHONIOENCODING": "utf-8",
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONPATH": "",
            }
            # 沙箱 3：临时工作目录（相对路径写入落在沙箱内）+ 超时
            result = subprocess.run(
                [sys.executable, tmp_file],
                capture_output=True, text=True, timeout=30,
                cwd=sandbox_dir, env=minimal_env, shell=False,
                stdin=subprocess.DEVNULL
            )
            return ExecutionResult(status="success", data={
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "sandbox": {"cwd": str(sandbox_dir), "env_stripped": True, "timeout": 30}
            })
        except subprocess.TimeoutExpired:
            return ExecutionResult(status="error", error_code="504", message="代码执行超时（30 秒）")
        except Exception as e:
            return ExecutionResult(status="error", error_code="500", message=str(e))
        finally:
            if tmp_file:
                try:
                    os.unlink(tmp_file)
                except OSError:
                    pass
            try:
                shutil.rmtree(sandbox_dir, ignore_errors=True)
            except Exception:
                pass

    # ---------- 数学计算与时间工具（联网搜索在 web_tools.py） ----------

    def _exec_math_calc(self, params: Dict) -> ExecutionResult:
        expression = str(params.get("expression", ""))
        denied = self._scan_math_expression(expression)
        if denied:
            return ExecutionResult(status="error", error_code="403", message=denied)
        try:
            result = eval(expression, {"__builtins__": {}}, {})  # nosec B307 —— 上一行 _scan_math_expression 已过 AST 白名单（仅纯算术节点）+ 空内建 + 200 字符上限；三层防线后剩余面是纯算术。
            return ExecutionResult(status="success", data={"result": result, "expression": expression})
        except Exception as e:
            return ExecutionResult(status="error", error_code="400", message=str(e))

    @staticmethod
    def _scan_math_expression(expression: str) -> str:
        """白名单 AST 校验：只允许纯算术表达式，防任意代码执行与指数 DoS"""
        if not expression or len(expression) > 200:
            return "表达式为空或过长（上限 200 字符）"
        try:
            import ast as _ast
            tree = _ast.parse(expression, mode="eval")
        except SyntaxError:
            return ""   # 语法错误交给 eval 返回 400
        ALLOWED_NODES = (_ast.Expression, _ast.Constant)
        # 运算符节点放行（安全性由 BinOp/UnaryOp 级别的特判把关）
        ALLOWED_OPS = (_ast.Add, _ast.Sub, _ast.Mult, _ast.Div,
                       _ast.FloorDiv, _ast.Mod, _ast.Pow, _ast.UAdd, _ast.USub)
        for node in _ast.walk(tree):
            if isinstance(node, ALLOWED_NODES) or isinstance(node, ALLOWED_OPS):
                continue
            if isinstance(node, (_ast.BinOp, _ast.UnaryOp)):
                if isinstance(node, _ast.BinOp) and isinstance(node.op, _ast.Pow):
                    def _small(n):
                        return (isinstance(n, _ast.Constant)
                                and isinstance(n.value, (int, float))
                                and abs(n.value) <= 100)
                    if _small(node.left) and _small(node.right) \
                            and abs(node.right.value) <= 1000:
                        continue
                    return "幂运算仅支持 100^1000 以内的常量运算"
                continue
            return f"math_calc 只允许纯算术表达式，禁止: {type(node).__name__}"
        return ""

    def _exec_datetime_now(self, params: Dict) -> ExecutionResult:
        from datetime import datetime
        fmt = params.get("format", "%Y-%m-%d %H:%M:%S")
        # 支持 prompt 中的 "YYYY-MM-DD HH:mm:ss" 友好格式
        fmt = (str(fmt)
               .replace("YYYY", "%Y").replace("DD", "%d").replace("HH", "%H")
               .replace("MM", "%m").replace("mm", "%M").replace("ss", "%S"))
        try:
            now = datetime.now().strftime(fmt)
        except ValueError as e:
            return ExecutionResult(status="error", error_code="400", message=str(e))
        return ExecutionResult(status="success", data={"datetime": now})

