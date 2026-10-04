/**
 * 假引擎 —— 界面测试与 `tools/preview.ts` **共用同一个**。
 *
 * 为什么必须共用：这个类刻意镜像真 `AceClient` 的两条语义（首个订阅者到来前先缓冲
 * 事件、审批是双向的）。各写一份的话，`preview` 看到的东西会慢慢与测试里跑的东西
 * 不是一回事 —— 而 preview 存在的意义恰恰是"让人看到界面真的长什么样"。
 *
 * **刻意镜像真 `AceClient` 的缓冲语义**：首个 `event` 订阅者到来之前先攒着，
 * 订阅时按原顺序补发。不镜像的话，测试会默认"事件推出去就有人收"，
 * 而真实情形是界面挂载晚于引擎启动 —— 于是测试全绿、线上丢事件。
 */

import type {
  AceEvent,
  ConfigData,
  GrantDecision,
  HomeData,
  SessionsData,
  TasksData,
} from '../src/protocol/types.js';
import type { AceClientLike } from '../src/App.js';

export class FakeClient implements AceClientLike {
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private buffer: AceEvent[] = [];
  private buffering = true;

  on(event: string, listener: (...args: any[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    if (event === 'event' && this.buffering) {
      this.buffering = false;
      const pending = this.buffer;
      this.buffer = [];
      for (const ev of pending) this.deliver(ev);
    }
    return this;
  }

  /** 测试侧推一条事件。没人订阅时先攒着（与真客户端同）。 */
  push(ev: AceEvent): void {
    if (this.buffering) {
      this.buffer.push(ev);
      return;
    }
    this.deliver(ev);
  }

  private deliver(ev: AceEvent): void {
    for (const fn of this.listeners.get('event') ?? []) fn(ev);
  }

  /** 模拟引擎进程结束（`client.ts` 会转发成 `exit` 事件）。 */
  emitExit(code = 0, signal: string | null = null): void {
    for (const fn of this.listeners.get('exit') ?? []) fn(code, signal);
  }

  async send(text: string): Promise<unknown> {
    this.calls.push({ method: 'send', args: [text] });
    return {};
  }
  /** `command.exec` 的回执；用例可以覆盖成 `{ keep_going: false }` 模拟 `/exit`。 */
  commandReply: Record<string, unknown> = { ok: true, keep_going: true };
  async command(line: string): Promise<unknown> {
    this.calls.push({ method: 'command', args: [line] });
    return this.commandReply;
  }
  async answerPermission(decision: GrantDecision, feedback?: string): Promise<unknown> {
    this.calls.push({ method: 'answerPermission', args: [decision, feedback] });
    return {};
  }
  async answerChoice(payload: {
    values?: string[];
    accepted?: boolean;
    text?: string;
    cancelled?: boolean;
  }): Promise<unknown> {
    this.calls.push({ method: 'answerChoice', args: [payload] });
    return {};
  }
  /** 主页内容（默认给一份最小可用结构；用例可以覆盖它）。 */
  home: HomeData = {
    title: { version: '3.41.0', model: 'deepseek', permission: 'readonly' },
    sections: [
      {
        key: 'resume',
        title_key: 'home_sec_resume',
        items: [
          {
            action: 'resume_last',
            label_key: 'home_resume_last',
            value: '',
            hint_key: 'home_resume_last_hint',
            enabled: true,
          },
        ],
      },
    ],
  };
  async requestHome(): Promise<HomeData> {
    this.calls.push({ method: 'requestHome', args: [] });
    return this.home;
  }
  /** 任务树（默认给一棵两层的树；用例可以覆盖）。 */
  tasks: TasksData = {
    tree: {
      text: '目标 [R1/3] 把前端做完',
      status: 'in_progress',
      note: '',
      children: [
        { text: '#1 补全菜单', status: 'done', note: '', children: [] },
        { text: '#2 任务树', status: 'in_progress', note: '', children: [] },
      ],
    },
  };
  async requestTasks(): Promise<TasksData> {
    this.calls.push({ method: 'requestTasks', args: [] });
    return this.tasks;
  }
  /** 界面侧开关（默认 vim 关；用例可以覆盖 `config.vim`）。 */
  config: ConfigData = { vim: false, lang: 'zh', permission: 'readonly' };
  async requestConfig(): Promise<ConfigData> {
    this.calls.push({ method: 'requestConfig', args: [] });
    return this.config;
  }
  /** 可引用的历史会话（`@session` 候选）。 */
  sessions: SessionsData = {
    sessions: [
      { path: '/x/1000.jsonl', when: '昨天 14:20', turns: 3, label: '缓存穿透那次' },
      { path: '/x/0900.jsonl', when: '前天 09:10', turns: 8, label: '重构执行层' },
    ],
  };
  async requestSessions(): Promise<SessionsData> {
    this.calls.push({ method: 'requestSessions', args: [] });
    return this.sessions;
  }
  async interrupt(): Promise<unknown> {
    this.calls.push({ method: 'interrupt', args: [] });
    return {};
  }
  async shutdown(): Promise<void> {
    this.calls.push({ method: 'shutdown', args: [] });
  }
}

/** 等一拍，让 Ink 把重渲染冲刷到 `lastFrame`。 */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
