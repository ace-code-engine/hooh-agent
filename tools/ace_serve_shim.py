#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ace_serve_shim —— 引擎服务进程的**监督垫片**（WP-DSH-SHELL）。

为什么存在：dsh 壳（node）直接 spawn 引擎时，引擎会在启动后 ~400ms 被外部
TerminateProcess（code=null，faulthandler 静默 = 非 Python 崩溃），而同样的
引擎在 python 父进程下全程存活。把父子关系改成 node → 本垫片 → 引擎，
隔离这一未知杀手；本垫片只做三件事：

1. 用**当前解释器**再拉起 `ai_code.py --serve ...`（stdio 三根管道直通）；
2. 双向转发 stdin/stdout（文本模式，逐行 flush）；
3. **跟随生死**：垫片退出（正常/被杀）时终止引擎；引擎先死时垫片随即退出——
   壳那侧的「引擎已退出」诊断语义保持不变。

零依赖（纯 stdlib）；本文件必须保持极简，它跑在每一个会话的旁边。
"""
import os
import subprocess
import sys
import threading


def main() -> int:
    # argv: shim.py <engine_script> <cwd> [engine args...]
    engine_script = sys.argv[1]
    cwd = sys.argv[2]
    engine_args = sys.argv[3:]
    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    proc = subprocess.Popen(
        [sys.executable, engine_script] + engine_args,
        cwd=cwd, env=env,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1,
    )

    def pump_stderr() -> None:
        try:
            for line in proc.stderr:
                sys.stderr.write(line)
                sys.stderr.flush()
        except Exception:
            pass

    def follow_exit() -> None:
        try:
            proc.wait()
        except Exception:
            pass
        # 引擎先死：垫片随即退出（壳的 CHILD_EXIT/STDOUT_CLOSE 语义照常触发）
        sys.exit(proc.returncode or 0)

    threading.Thread(target=pump_stderr, daemon=True).start()
    threading.Thread(target=follow_exit, daemon=True).start()

    def pump_in() -> None:
        try:
            for line in sys.stdin:
                try:
                    proc.stdin.write(line)
                    proc.stdin.flush()
                except Exception:
                    return
        except Exception:
            pass

    threading.Thread(target=pump_in, daemon=True).start()
    try:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
    finally:
        try:
            proc.kill()
        except Exception:
            pass
    return proc.returncode or 0


if __name__ == "__main__":
    raise SystemExit(main())
