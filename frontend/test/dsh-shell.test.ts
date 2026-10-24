/**
 * 迁入壳（dsh-ui/hooh）的纯逻辑：行投影（流式/工具配对）与审批选项表。
 *
 * 背景（2026-10-24 切默认入口）：壳要当日常驱动，三根线补齐——流式、
 * 命令路由、审批。这里钉住**投影语义**（App 的渲染只是消费它）。
 */

import { describe, expect, it } from 'vitest';

import {
  choiceAnswerPayload,
  rowsFromEvents,
  type AceEvent,
} from '../dsh-ui/hooh/engine.js';
import { shellPermissionOptions } from '../dsh-ui/hooh/PermissionDialog.js';

describe('rowsFromEvents：流式（model_delta → 流式助手行 → final 定格）', () => {
  it('增量接进同一行，final 就地定格（不另起一行）', () => {
    const rows = rowsFromEvents([
      { type: 'user_message', text: '你好' },
      { type: 'model_delta', text: '你' },
      { type: 'model_delta', text: '好' },
      { type: 'final', text: '你好呀' },
    ] as AceEvent[]);
    const assistant = rows.filter((r) => r.kind === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.text).toBe('你好呀');
    expect(assistant[0]!.streaming).toBe(false);
  });

  it('无流式握手的老引擎：final 照旧单独成行（向后兼容）', () => {
    const rows = rowsFromEvents([{ type: 'final', text: '答案' }] as AceEvent[]);
    expect(rows.filter((r) => r.kind === 'assistant')).toHaveLength(1);
  });

  it('流式行在工具卡之后重新起行（delta 不粘到工具结果上）', () => {
    const rows = rowsFromEvents([
      { type: 'tool_call', tool: 'file_read', params: { path: 'a' } },
      { type: 'tool_result', tool: 'file_read', status: 'SUCCESS', message: 'x' },
      { type: 'model_delta', text: '结论' },
    ] as AceEvent[]);
    const last = rows[rows.length - 1]!;
    expect(last.kind).toBe('assistant');
    expect(last.text).toBe('结论');
  });
});

describe('rowsFromEvents：工具配对与通知（既有语义不回归）', () => {
  it('tool_call → tool_result 按名字配对并定格状态', () => {
    const rows = rowsFromEvents([
      { type: 'tool_call', tool: 'terminal_exec', params: { command: 'git status' } },
      { type: 'tool_result', tool: 'terminal_exec', status: 'SUCCESS', message: 'ok', elapsed: 0.12 },
    ] as AceEvent[]);
    const tool = rows.find((r) => r.kind === 'tool')!;
    expect(tool.tool?.status).toBe('ok');
    expect(tool.tool?.durationMs).toBe(120);
  });

  it('notice 独立成行', () => {
    const rows = rowsFromEvents([{ type: 'notice', text: '提示' }] as AceEvent[]);
    expect(rows[0]!.kind).toBe('notice');
  });
});

describe('审批选项表：persistOk 语义与 ace 前端同契约', () => {
  it('persistOk=false → 隐藏「记住」项（3 条，无 persist）', () => {
    const opts = shellPermissionOptions(false);
    expect(opts).toHaveLength(3);
    expect(opts.some((o) => o.persist)).toBe(false);
  });

  it('缺省/true → 4 条（含记住）', () => {
    expect(shellPermissionOptions(undefined)).toHaveLength(4);
    expect(shellPermissionOptions(true)).toHaveLength(4);
  });
});

describe('choice.answer 载荷投影（协议口径在 core/ace_serve 的三个 _ask）', () => {
  it('choose：选中 → {values:[文本]}；取消 → 空（values 缺失 = None）', () => {
    expect(choiceAnswerPayload('choose', { type: 'pick', value: 'deepseek-v4' }))
      .toEqual({ values: ['deepseek-v4'] });
    expect(choiceAnswerPayload('choose', { type: 'cancel' })).toEqual({});
  });

  it('confirm：accepted 只在「接受」时为真（默认否）', () => {
    expect(choiceAnswerPayload('confirm', { type: 'accept' })).toEqual({ accepted: true });
    expect(choiceAnswerPayload('confirm', { type: 'deny' })).toEqual({ accepted: false });
  });

  it('text：空串发 null（引擎落回默认值/取消）；secret 路径同一条', () => {
    expect(choiceAnswerPayload('text', { type: 'text', text: 'sk-abc' }))
      .toEqual({ text: 'sk-abc' });
    expect(choiceAnswerPayload('text', { type: 'text', text: '' })).toEqual({ text: null });
    expect(choiceAnswerPayload('text', { type: 'text', text: null })).toEqual({ text: null });
  });
});
