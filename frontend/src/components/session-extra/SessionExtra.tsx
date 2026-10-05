/**
 * 会话扩展族（借鉴 dsh-TUI 的 `JobsPanel` / sessions / `RecapPanel` / `BtwPanel`）：
 * **任务 Jobs / 子 Agents / 摘要 Recap / btw 插话**。它和 ace 的 /tasks、/agents 对应；
 * 数据缺就显示"暂无"的空态，不装好了。
 */

import React from "react";

import { Box, Text, useInput } from "../../../vendor/dsh-ink/kernel.js";
import { displayWidth } from "../../render/text.js";
import { Byline, Divider, StatusIcon, useColumns, type ColorFn } from "../design-system/primitives.js";
import { SESSX_KEYS, type SessXKey } from "./i18n.js";

export interface SessionXJob {
  readonly id: string;
  readonly title: string;
  readonly status: "running" | "ok" | "failed" | "pending";
  readonly startedAt: string;
  readonly currentStep: string;
}

export interface SessionXAgent {
  readonly name: string;
  readonly status: "running" | "ok" | "failed" | "pending";
  readonly under: string;
  readonly turns: number;
}

export interface SessionXPanelsProps {
  readonly jobs: readonly SessionXJob[] | undefined;           // undefined = 现在没拿数
  readonly agents: readonly SessionXAgent[] | undefined;
  readonly t: (key: SessXKey, params?: Record<string, string | number>) => string;
  readonly width?: number;
  readonly color?: ColorFn;
  /** 任选某一项 → 回调 */
  readonly onPick?: (kind: "job" | "agent", id: string) => void;
  readonly onClose: () => void;
}

const STATUS_GLYPH: Record<SessionXJob["status"], Parameters<typeof StatusIcon>[0]["status"]> = {
  running: "pending",
  ok: "ok",
  failed: "failed",
  pending: "pending",
};

function statusOf(job: SessionXJob["status"]) {
  return STATUS_GLYPH[job] ?? "pending";
}

function JobRow({ job, focused, cols, color }: {
  job: SessionXJob; focused: boolean; cols: number; color?: ColorFn;
}) {
  return (
    <Box>
      <StatusIcon status={statusOf(job.status)} color={color} />
      <Text color={color?.(focused ? "accent" : "text")}>
        {"  "}{job.title}
      </Text>
      <Text color={color?.("dim")}>
        {" ".repeat(Math.max(0, cols - displayWidth(`  ${job.title}  ${job.startedAt}  ${job.currentStep}`)))}
        {job.startedAt}{"  "}{job.currentStep}
      </Text>
    </Box>
  );
}

function AgentRow({ agent, focused, cols, color }: {
  agent: SessionXAgent; focused: boolean; cols: number; color?: ColorFn;
}) {
  const label = `${agent.name}（${agent.under}）`;
  return (
    <Box>
      <StatusIcon status={statusOf(agent.status)} color={color} />
      <Text color={color?.(focused ? "accent" : "text")}>{"  "}{label}</Text>
      <Text color={color?.("dim")}>
        {" ".repeat(Math.max(0, cols - displayWidth(`  ${label}  ${agent.turns}`)))}
        {agent.turns}
      </Text>
    </Box>
  );
}

/** 会话扩展主面板：双列 任务 Jobs 左 / 子代理 右。 */
export function SessionExtra({ jobs, agents, t, width, color, onPick, onClose }: SessionXPanelsProps) {
  const cols = useColumns(width);
  const [which, setWhich] = React.useState<"job" | "agent">("job");
  const [jobFocus, setJobFocus] = React.useState(0);
  const [agentFocus, setAgentFocus] = React.useState(0);
  const [tickets, setTickets] = React.useState<string | null>(null);

  const js = jobs ?? [];
  const as = agents ?? [];

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.tab || input === "\t") { setWhich((w) => (w === "job" ? "agent" : "job")); return; }
    if (key.upArrow) { if (which === "job") setJobFocus((f) => Math.max(0, f - 1)); else setAgentFocus((f) => Math.max(0, f - 1)); return; }
    if (key.downArrow) { if (which === "job") setJobFocus((f) => Math.min(js.length - 1, f + 1)); else setAgentFocus((f) => Math.min(as.length - 1, f + 1)); return; }
    if (key.return) {
      const id = which === "job" ? js[jobFocus]?.id : as[agentFocus]?.name;
      if (id) { onPick?.(which, id); setTickets(id); }
    }
  });

  return (
    <Box flexDirection="column" width={cols}>
      <Divider title={t(SESSX_KEYS.title)} width={cols} color={color} />
      <Box flexDirection="row" gap={1}>
        <Box width={Math.floor(cols / 2)} flexDirection="column">
          <Text color={color?.(which === "job" ? "accent" : "dim")}>{t(SESSX_KEYS.jobs)}</Text>
          {jobs === undefined ? (
            <Text color={color?.("dim")}>{t(SESSX_KEYS.loading)}</Text>
          ) : js.length === 0 ? (
            <Text color={color?.("dim")}>{t(SESSX_KEYS.emptyJobs)}</Text>
          ) : js.map((j, i) => (
            <JobRow key={j.id} job={j} focused={which === "job" && i === jobFocus} cols={Math.floor(cols / 2) - 2} color={color} />
          ))}
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <Text color={color?.(which === "agent" ? "accent" : "dim")}>{t(SESSX_KEYS.agents)}</Text>
          {agents === undefined ? (
            <Text color={color?.("dim")}>{t(SESSX_KEYS.loading)}</Text>
          ) : as.length === 0 ? (
            <Text color={color?.("dim")}>{t(SESSX_KEYS.emptyAgents)}</Text>
          ) : as.map((a, i) => (
            <AgentRow key={a.name} agent={a} focused={which === "agent" && i === agentFocus} cols={cols - Math.floor(cols / 2) - 3} color={color} />
          ))}
        </Box>
      </Box>
      {tickets !== null ? <Text color={color?.("accent")}>{t(SESSX_KEYS.picked, { id: tickets })}</Text> : null}
      <Byline parts={[t(SESSX_KEYS.hint), t(SESSX_KEYS.close)]} color={color} />
    </Box>
  );
}

export default SessionExtra;
