/**
 * App —— 把 client、状态、界面接起来。
 *
 * 依赖是**注入**的（`client` / `t` / `colorOf`），不是在这里 new 出来的：
 * 这样测试可以塞一个假引擎（一串录好的事件）把界面跑起来断言，
 * 不必真的起 Python、更不必有模型。
 */

import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';

import { ScrollBox } from './tui/scroll-box.js';
import React, { useCallback, useEffect, useReducer, useState } from 'react';

import { Banner } from './components/Banner.js';
import { ChoiceDialog, type ChoiceAnswer } from './components/ChoiceDialog.js';
import { Home } from './components/Home.js';
import { Input } from './components/Input.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { Spinner } from './components/Spinner.js';
import { StatusLine } from './components/StatusLine.js';
import { TaskTree } from './components/TaskTree.js';
import { Transcript } from './components/Transcript.js';
import type {
  AceEvent,
  ConfigData,
  GrantDecision,
  HomeData,
  SessionRow,
  SessionsData,
  TaskNodeData,
  TasksData,
} from './protocol/types.js';
import type { BuildMenuOptions } from './render/menu.js';
import {
  applyChoiceAnswer,
  applyEvent,
  applyPermissionAnswer,
  initialState,
  type Item,
  type State,
} from './state/store.js';

/** App 需要的全部引擎能力。`AceClient` 满足它，测试里的假的也满足它。 */
export interface AceClientLike {
  // 签名故意宽松（与 EventEmitter 同形）：把 `event` 收窄成字面量联合会让
  // 真实的 AceClient 因为逆变检查而**不可赋值** —— 那是类型体操，不是真需求。
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(text: string): Promise<unknown>;
  command(line: string): Promise<unknown>;
  answerPermission(decision: GrantDecision, feedback?: string): Promise<unknown>;
  answerChoice(payload: {
    values?: string[];
    accepted?: boolean;
    text?: string;
    cancelled?: boolean;
  }): Promise<unknown>;
  requestHome(): Promise<HomeData>;
  requestTasks(): Promise<TasksData>;
  requestConfig(): Promise<ConfigData>;
  requestSessions(): Promise<SessionsData>;
  interrupt(): Promise<unknown>;
  shutdown(): Promise<void>;
}

export interface AppProps {
  /** 备用屏全屏：转录走 `<ScrollBox>`（终端没有回滚缓冲）。 */
  fullscreen?: boolean;
  /** 引擎侧 `/fullscreen on|off` 生效时上报（备用屏由 Root 管，App 只管转录形态）。 */
  onFullscreenChange?: (on: boolean) => void;
  client: AceClientLike;
  t: (key: string, params?: Record<string, string | number>) => string;
  colorOf: (token: string) => string | undefined;
  /** 启动即发出的第一句（测试 / 演示用）。 */
  initialMessage?: string;
  /**
   * 补全菜单的候选来源（来自握手的 capabilities）。不给就不启用菜单。
   *
   * `state` 由本组件自己填（它持有当前状态），所以调用方给的这半个不需要带。
   */
  menuOptions?: Omit<BuildMenuOptions, 'state'>;
}

type Action =
  | { type: 'event'; ev: AceEvent }
  | { type: 'answered'; decision: GrantDecision }
  | { type: 'choice_answered' };

function reducer(state: State, action: Action): State {
  if (action.type === 'event') return applyEvent(state, action.ev);
  if (action.type === 'choice_answered') return applyChoiceAnswer(state);
  return applyPermissionAnswer(state, action.decision);
}

export function App({ client, t, colorOf, initialMessage, menuOptions, fullscreen = false,
  onFullscreenChange }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [errors, setErrors] = useState<string[]>([]);
  /** 主页内容（引擎侧 `ace_home.build_home` 算好的结构化分区）。 */
  const [home, setHome] = useState<HomeData | null>(null);
  /** 任务树（`Ctrl+T` 开关）。打开时才去取 —— 它每次都要问引擎，不该常驻拉。 */
  const [taskTree, setTaskTree] = useState<TaskNodeData | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  /**
   * 当前状态（模型/权限/沙箱/强度/联网/语言/vim）。
   *
   * **由引擎说了算** —— `/vim` 这类命令改的是它的 cfg。前端只跟着走。
   * 补全菜单里那行「（当前 xxx）」和 vim 开关都从这里取：与主页分区同一个来源。
   */
  const [config, setConfig] = useState<ConfigData>({});
  const vim = Boolean(config.vim);
  /**
   * 可引用的历史会话（`@session` 菜单的候选）。
   *
   * **挂载时取一次**，不在每次按键时问 —— 菜单是每敲一个字就重建的，而列会话要读盘。
   * 前端又没法在 `useMemo` 里做异步（那正是 `menuWithState` 需要的），
   * 所以用"提前取好、随状态变化重建"这条路。会话列表在一次交互里基本不变。
   */
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns ?? 80);

  // 终端尺寸会变（用户拉窗口）。状态行与卡片都按列宽排版，所以必须跟着变 ——
  // 拿一次初始值就不再更新的话，拉宽窗口后右半边会一直是空的。
  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => setCols(stdout.columns ?? 80);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  // 主页拉一次就够（进入会话后它会被滚上去）。拉不到就**不显示** —— 一个空壳主页
  // （有分区标题没条目）比没有主页更让人困惑。
  useEffect(() => {
    let alive = true;
    client
      .requestHome()
      .then((h) => {
        if (alive && h && Array.isArray(h.sections)) setHome(h);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => [...prev, `主页内容取不到：${msg}`].slice(-5));
      });
    return () => {
      alive = false;
    };
  }, [client]);

  /** 重新问一次当前状态。取不到就保持现状 —— 不该因为读配置失败把界面搞坏。 */
  const refreshConfig = useCallback((): void => {
    client
      .requestConfig()
      .then((c: ConfigData) => {
        if (c && typeof c === 'object') setConfig(c);
      })
      .catch(() => {
        /* 保持现状 */
      });
  }, [client]);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  // `/fullscreen on|off` 是**引擎**改了 cfg，而备用屏只能由外壳进出 ——
  // 所以这里把配置里的值上报给 Root（它持有备用屏开关）。
  useEffect(() => {
    if (typeof config.fullscreen !== 'boolean') return;
    onFullscreenChange?.(config.fullscreen);
  }, [config.fullscreen, onFullscreenChange]);

  useEffect(() => {
    let alive = true;
    client
      .requestSessions()
      .then((d: SessionsData) => {
        if (alive && d && Array.isArray(d.sessions)) setSessions(d.sessions);
      })
      .catch(() => {
        /* 取不到就不给 @session 候选 —— 菜单少一类，比整块崩掉强 */
      });
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    const onEvent = (ev: AceEvent): void => dispatch({ type: 'event', ev });
    client.on('event', onEvent);
    // stderr / 协议违规**不塞进对话流**：它们是诊断信息，混进去会伪装成正常输出。
    // 单独收着，出问题时能看见，平时不占地方。
    client.on('stderr', (chunk: unknown) => {
      const text = String(chunk ?? '').trim();
      if (text) setErrors((e) => [...e, text].slice(-5));
    });
    client.on('protocol-violation', (raw: unknown) => {
      setErrors((e) => [...e, `协议违规（stdout 上出现了非 JSON 行）：${String(raw).slice(0, 120)}`].slice(-5));
    });
    return () => {
      // 组件卸载不等于引擎该关：会话可能还长。关引擎是 index.tsx 的收尾职责。
    };
  }, [client]);

  useInput((input, key) => {
    // Ctrl+C：有空输入先清空、再按才退出 —— 与 Python 侧两段式一致。
    if (key.ctrl && input === 'c') {
      void client.shutdown().finally(() => exit());
      return;
    }
    // Ctrl+T：任务树开关（与 Python 侧键位一致）。**打开时才去取** ——
    // 它每次都要问引擎，常驻拉是白费；关掉时不取，省一次往返。
    if (key.ctrl && input === 't') {
      setShowTasks((on) => {
        const next = !on;
        if (next) {
          client
            .requestTasks()
            .then((d: TasksData) => setTaskTree(d?.tree ?? null))
            .catch((e: unknown) => {
              const msg = e instanceof Error ? e.message : String(e);
              setErrors((prev) => [...prev, `任务树取不到：${msg}`].slice(-5));
            });
        }
        return next;
      });
    }
  });

  const handleSubmit = useCallback(
    (line: string) => {
      dispatch({ type: 'event', ev: { type: 'user_message', ts: Date.now() / 1000, text: line } });
      // 以 `/` 开头的是引擎侧的命令（`_process_line` 表驱动），走 `command.exec`；
      // 其余才是发给模型的话。分错通道的症状是"/model 被当成聊天内容发给了模型"。
      const isCommand = line.startsWith('/');
      const p = isCommand ? client.command(line) : client.send(line);
      if (isCommand) {
        // 命令可能改了界面侧开关（`/vim` 最典型）。执行完重读一次 ——
        // 不重读的话用户敲了 `/vim` 会看到"提示说开了，但按键没变"。
        void p.then(() => refreshConfig()).catch(() => undefined);
      }
      p.catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => [...prev, msg].slice(-5));
        dispatch({
          type: 'event',
          ev: { type: 'notice', ts: Date.now() / 1000, text: `✗ ${msg}` },
        });
      });
      return true;
    },
    [client],
  );

  const handleAnswer = useCallback(
    (decision: GrantDecision, feedback?: string) => {
      dispatch({ type: 'answered', decision });
      client.answerPermission(decision, feedback).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => [...prev, `递审批答案失败：${msg}`].slice(-5));
      });
    },
    [client],
  );

  useEffect(() => {
    if (initialMessage) handleSubmit(initialMessage);
    // 只在挂载时发一次：initialMessage 变化不该重复发（那是演示/测试的入口参数）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChoice = useCallback(
    (answer: ChoiceAnswer) => {
      dispatch({ type: 'choice_answered' });
      client.answerChoice(answer).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setErrors((prev) => [...prev, `递选择答案失败：${msg}`].slice(-5));
      });
    },
    [client],
  );

  // 菜单候选里要带「（当前 xxx）」与 `@session` 的取值，所以它必须跟着 config /
  // sessions 重建 —— 只在挂载时算一次的话，用户切完模型菜单里还显示旧值。
  const menuWithState = React.useMemo(() => {
    if (!menuOptions) return undefined;
    // `@session` 的取值是 `[标签, 插入值]`：菜单显示「1. 缓存穿透 · 2 轮」，
    // 插进输入框的是编号 `1`（引擎按编号解析）。只给标签引擎看不懂，只给编号用户看不懂。
    const sessionValues: Array<[string, string]> = sessions.map((s, i) => [
      `${i + 1}. ${s.label} · ${t('sessions_turns', { n: s.turns })}`,
      String(i + 1),
    ]);
    return {
      ...menuOptions,
      state: config,
      mentionValues: { ...(menuOptions.mentionValues ?? {}), session: sessionValues },
    };
  }, [menuOptions, config, sessions, t]);

  // 视口高度：终端行数减去底部区（状态行 + 输入行 + 对话框/任务树的预留）。
  // 留 10 行是经验值：底部区最少要这么多才不至于把输入行挤没；下限 3 行。
  const bodyHeight = Math.max(3, (stdout?.rows ?? 30) - 10);

  const perm = state.pendingPermission;
  const choice = state.pendingChoice;

  // **定稿的转写交给 `<Static>`**：只写一次、进终端**真实回滚缓冲**，之后永不重画。
  // 一条改动解决三件事：
  //   ① 频闪 —— 长转录时按 `/` 弹菜单会触发整帧重画，重画量是 O(整段转录)（实测投诉）；
  //   ② 往上翻 —— 动态帧里的东西不进回滚缓冲，翻上去只有一屏；
  //   ③ 帧预算 —— 每帧只剩"还会变的那几条 + 底部区"，与转录长度无关。
  //
  // `Static` 的语义是**追加**（内部记着已印到第几项），所以只能放"印完就不会再变"的项。
  // 两个坑：
  //   - 助手消息**正在流**时必须留在动态帧，否则会被印死、后续增量全丢；
  //   - **工具卡片是原地变状态的**（`running` → `ok`/`fail`，权限项 `answered` 同理），
  //     刚 push 就冻住的话卡片会永远停在"运行中"—— 第一版就是这么错的，套件当场抓了出来。
  // 因此按**后缀**切：冻结"全部不会再变"的最长前缀，其余留在动态帧 —— 顺序自然不会乱。
  const mutable = (it: Item): boolean =>
    (it.kind === 'assistant' && it.streaming)
    || (it.kind === 'tool' && it.status === 'running')
    || (it.kind === 'permission' && it.answered === undefined);
  let cut = state.items.length;
  while (cut > 0 && mutable(state.items[cut - 1]!)) cut--;
  const frozen = state.items.slice(0, cut);
  const live = state.items.slice(cut);

  return (
    <Box flexDirection="column">
      {/* 首屏：横幅（logo + 身份）→ 主页分区。**只在还没有消息时出现** ——
          打字之后整块自然滚上去，与"聊天记录是主线、首屏只是开场"一致。
          原来的常驻头部（`ACE /path`）去掉了：那些信息现在分别在
          横幅（首屏）和状态行（常驻）里，各出现一次就够。 */}
      {state.items.length === 0 ? (
        <Banner
          version={config.version}
          model={config.model}
          permission={config.permission}
          folder={config.folder}
          color={colorOf}
          width={cols}
        />
      ) : null}

      {state.items.length === 0 && home ? (
        <Home home={home} t={t} color={colorOf} width={cols} />
      ) : null}

      {/* 定稿转录：
          主屏 → `<Static>` 写完就不再重画（进终端**真实回滚缓冲**，往上翻靠终端）；
          备用屏 → 终端没有回滚，交给 `<ScrollBox>`（PgUp/PgDn/↑↓/g/G 翻，滚动条自动）。 */}
      {fullscreen ? (
        <ScrollBox
          items={frozen}
          height={bodyHeight}
          active={!perm && !choice}
          color={colorOf}
          hint={t('scroll_hint')}
          renderItem={(it) => <Transcript key={it.id} items={[it]} t={t} color={colorOf} />}
        />
      ) : (
        <Static items={frozen}>
          {(it) => <Transcript key={it.id} items={[it]} t={t} color={colorOf} />}
        </Static>
      )}

      {/* 动态帧：只会是在流的那一条 + 底部区（对话框/任务树/状态行/输入框） */}
      <Transcript items={live} t={t} color={colorOf} />

      {perm ? (
        <Box marginBottom={1}>
          <PermissionDialog
            tool={perm.tool}
            reason={perm.reason}
            t={t}
            color={colorOf}
            onAnswer={handleAnswer}
            disabled={state.meta.ended}
          />
        </Box>
      ) : null}

      {showTasks ? (
        <Box marginBottom={1}>
          <TaskTree tree={taskTree} t={t} color={colorOf} />
        </Box>
      ) : null}

      {choice ? (
        <Box marginBottom={1}>
          <ChoiceDialog
            kind={choice.kind}
            title={choice.title}
            options={choice.options}
            defaultValue={choice.defaultValue}
            secret={choice.secret}
            t={t}
            color={colorOf}
            onAnswer={handleChoice}
            disabled={state.meta.ended}
          />
        </Box>
      ) : null}

      {errors.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          {errors.map((e, i) => (
            <Text key={i} color={colorOf('warn')}>
              {'  '}▏ {e}
            </Text>
          ))}
        </Box>
      ) : null}

      {/* 等待指示器：只在"确实在跑、且没有弹框占着屏幕"时出现。
          有授权框时不该再转 —— 那会让人以为"它还在自己干"，而事实是**它在等你**。 */}
      {state.busy && !perm ? (
        <Box marginBottom={1}>
          <Spinner
            phase={state.meta.phase || 'reasoning'}
            t={t}
            color={colorOf}
            reducedMotion={process.env.ACE_REDUCE_MOTION === '1'}
            lastOutputAt={state.meta.lastOutputAt}
          />
        </Box>
      ) : null}

      <StatusLine meta={state.meta} busy={state.busy} color={colorOf} width={cols} t={t} />

      <Input
        t={t}
        color={colorOf}
        busy={state.busy}
        disabled={Boolean(perm) || Boolean(choice) || state.meta.ended}
        onSubmit={handleSubmit}
        width={cols}
        vim={vim}
        {...(menuWithState ? { menuOptions: menuWithState } : {})}
        onInterrupt={() => {
          client.interrupt().catch(() => {
            /* 中断失败无所谓：下一轮照常 */
          });
        }}
      />
    </Box>
  );
}
