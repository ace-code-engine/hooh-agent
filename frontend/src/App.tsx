/**
 * App —— 把 client、状态、界面接起来。
 *
 * 依赖是**注入**的（`client` / `t` / `colorOf`），不是在这里 new 出来的：
 * 这样测试可以塞一个假引擎（一串录好的事件）把界面跑起来断言，
 * 不必真的起 Python、更不必有模型。
 */

import {
  Box,
  TerminalSizeContext,
  Text,
  useApp,
  useInput,
} from '../vendor/dsh-ink/kernel.js';

import { ScrollBox } from './tui/scroll-box.js';
import React, { useCallback, useEffect, useReducer, useState } from 'react';

import { Banner } from './components/Banner.js';
import { ChoiceDialog, type ChoiceAnswer } from './components/ChoiceDialog.js';
import { Home } from './components/Home.js';
import { Input } from './components/Input.js';
import { PAGE_INSET, PageMargin, Rule, contentColumns } from './components/layout/PageMargin.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { Spinner } from './components/Spinner.js';
import { StatusLine } from './components/StatusLine.js';
import { TaskTree } from './components/TaskTree.js';
import { Transcript } from './components/Transcript.js';
import type {
  AceEvent,
  CommandResult,
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
  command(line: string): Promise<CommandResult | unknown>;
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
  /**
   * 转录状态**由外层托管**（`Root` 持有，见下面 `App` 里那段注释）。
   * 不给就组件自己管 —— 单独用 `<App>`（测试 / preview）时接口不变。
   */
  state?: State;
  dispatch?: React.Dispatch<Action>;
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

export type Action =
  | { type: 'event'; ev: AceEvent }
  | { type: 'answered'; decision: GrantDecision }
  | { type: 'choice_answered' };

export function reducer(state: State, action: Action): State {
  if (action.type === 'event') return applyEvent(state, action.ev);
  if (action.type === 'choice_answered') return applyChoiceAnswer(state);
  return applyPermissionAnswer(state, action.decision);
}

export function App({ client, t, colorOf, initialMessage, menuOptions, fullscreen = false,
  onFullscreenChange, state: givenState, dispatch: givenDispatch }: AppProps): React.ReactElement {
  // 转录状态**优先由外层给**（`Root` 把它挂在自己身上）。
  //
  // 为什么状态不能只住在这里：内核的 `<AlternateScreen>` 只有"挂载即进入、卸载即退出"语义，
  // **没有 `enabled`**（`vendor/dsh-ink/.../components/alternatescreen.js` 只吃 `mouseTracking`）。
  // 于是 `Root` 把备用屏开关从 true 翻到 false 时换掉的是**元素类型** ⇒ 本组件整个卸载重挂
  // —— `useReducer` 里那本转录会当场清空（`/fullscreen off` 丢历史，S3 记的回归）。
  // 状态住在 `Root`（那层不重挂）就原样带过；单独用 `<App>`（测试 / preview）时退回自己这份，
  // 接口不变。**不能**用 `key` 之类的把戏去逼重渲染，那同样是重挂。
  const [ownState, ownDispatch] = useReducer(reducer, undefined, initialState);
  const state = givenState ?? ownState;
  const dispatch = givenDispatch ?? ownDispatch;
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
  // 宽度/高度走**接口 B**：新内核没有 `useStdout()`
  // （`hooks/use-stdout.*` 整块删除），终端尺寸只有一个来源 —— 内核 `<App>` 在根部提供的
  // `TerminalSizeContext`，value 形状 `{columns, rows}`，窗口拉伸时它自己更新
  // （所以这里**不需要**再监听 `stdout.on('resize')`，旧的 8 行监听整块删掉）。
  //
  // 用 `useContext` 而不是 `useTerminalSize()`：后者在 Provider 外**当场抛错**，
  // 而 `renderToScreen()` 不提供任何 context，抛出的错会被 React 吞掉、只留下一张**空屏**
  // （S1 实测）。直接读 context 拿不到就退回 80×30 —— 真机上一定有 Provider
  // （`components/app.js` 的 `TerminalSizeContext.Provider`），退回值只服务于测试/非 TTY。
  //
  // ⚠️ Context 身份：`TerminalSizeContext` 必须从 `kernel.js` 取（它转口的是内核内部
  // 同一条 `./components/TerminalSizeContext.js` 路径），自己另开一条路径会拿到**另一个**
  // context 对象，Provider 就白包了。
  const size = React.useContext(TerminalSizeContext);
  const cols = size?.columns ?? 80;
  const rows = size?.rows ?? 30;
  // 内容列宽 —— **必须**与 `PageMargin` 下发进内层的那个数同源（同一条 `contentColumns`）。
  // 吃 `width` prop 的那几个（横幅 / 主页 / 状态行 / 输入行）拿到的是内容宽，
  // 不会宽出页边距、把长行挤折；不传 prop 的那些（转录/卡片里的 Markdown）走
  // `useColumns()`，读到的已经是 `PageMargin` 覆盖过的内容区尺寸。
  const content = contentColumns(cols);

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
    // **引擎进程结束了**（正常收工或崩了）→ 界面也得退。不监听它的后果与 `/exit`
    // 空转是同一类：窗口还开着、输入没反应，用户只能 Ctrl+C（实测投诉）。
    // 退出去不丢东西：转录是**主屏 inline** 渲染的，内核把滚出视口的行推进终端原生
    // 回滚缓冲，退出后照样往上翻（换内核前这条走的是 `<Static>`，机制不同、效果一致）。
    client.on('exit', (code: unknown, signal: unknown) => {
      const why = signal ? `signal ${String(signal)}` : `code ${String(code ?? 0)}`;
      setErrors((e) => [...e, `engine exited (${why})`].slice(-5));
      exit();
    });
    // `error` 事件没人接会让 EventEmitter 直接抛（崩在没人看得见的地方）
    client.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => [...e, msg].slice(-5));
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
        void p
          .then((res: unknown) => {
            // 命令可能改了界面侧开关（`/vim` 最典型）。执行完重读一次 ——
            // 不重读的话用户敲了 `/vim` 会看到「提示说开了，但按键没变」。
            refreshConfig();
            // **`keep_going: false` = 引擎说「这一行之后我就结束了」**（`/exit` 就是）。
            // 不消费它的后果：输入框被禁用、窗口还在，用户只能 Ctrl+C 才退得出去
            // （实测投诉）。只有**显式 false** 才退 —— 老引擎不带该字段时不许误退。
            const keep = (res as { keep_going?: boolean } | null)?.keep_going;
            if (keep === false) exit();
          })
          .catch(() => undefined);
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

  // 视口高度（只给**全屏**那条路的 `<ScrollBox>` 用）：终端行数减去页边距（上下各
  // `PAGE_INSET.y`，那两行 `PageMargin` 已经占掉了）再减去底部区
  // （状态行 + 输入行 + 版面级细线 + 对话框/任务树的预留）。留 10 行是经验值：
  // 底部区最少要这么多才不至于把输入行挤没；下限 3 行。
  const bodyHeight = Math.max(3, rows - 2 * PAGE_INSET.y - 10);

  const perm = state.pendingPermission;
  const choice = state.pendingChoice;

  // **主屏（非全屏）不需要任何切分**：新内核删掉了 `<Static>`（"写一次就不再重画"的机制
  // 不存在了），它自己走的是**主屏 inline + 终端原生 scrollback** —— 全部条目一次渲染进
  // 主屏，帧引擎把**滚出视口的行**当作真实输出推进终端回滚缓冲
  // （`log-update.js` 的 growth 分支靠 CR+LF 让旧行滚上去，此后跳过这些行的 diff），
  // 往上翻仍然是终端自己的事。于是原来为 `<Static>` 服务的"冻结/动态切分"在主屏**整块不用**：
  //   - 历史照样进得了真实回滚缓冲（属性①，这条是专门修过的 bug）；
  //   - 工具卡（`running`→`ok`）/权限项（未答→已答）这类**原地变状态**的项，只要还在视口里
  //     就跟着重画 —— 第一版按前缀把它们冻死，卡片永远停在"运行中"（属性②，别重蹈）。
  //
  // ⚠️ 已知代价（内核这条路本身的口径，不是本文件的取巧）：每帧要对**整段转录**跑一次布局，
  // 帧预算不再与转录长度无关 —— 内核用 node-cache 缓存在树里没变的节点的测量值来兜。
  // 长会话若真卡，先看内核的 `Slow render` 调试日志，再谈是不是要另想办法。
  //
  // 切分只剩下**全屏（备用屏）**一个用处：备用屏里终端没有回滚，历史只能自己管，
  // 所以定型的前缀进 `<ScrollBox>`，**仍在变的尾部钉在它下面**（这样用户往上翻历史时，
  // 正在流的那条 / 正在跑的工具卡依然看得见）。全屏那条路与滚动视口的去重归 **S3**。
  const mutable = (it: Item): boolean =>
    (it.kind === 'assistant' && it.streaming)
    || (it.kind === 'tool' && it.status === 'running')
    || (it.kind === 'permission' && it.answered === undefined);
  let cut = state.items.length;
  while (cut > 0 && mutable(state.items[cut - 1]!)) cut--;
  const frozen = state.items.slice(0, cut);
  const live = state.items.slice(cut);

  return (
    // 版式几何：整棵界面走**同一套**页边距（内容内缩 2 列 / 1 行），转录与底部区
    // 因此共用一个内容列宽。`width={cols}` 传的是**终端**列数 —— `PageMargin`
    // 自己扣掉内缩再往下发（测试里没有 Provider 时它落到 80，与 `cols` 同一档兜底）。
    <PageMargin width={cols}>
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
            width={content}
          />
        ) : null}

        {state.items.length === 0 && home ? (
          <Home home={home} t={t} color={colorOf} width={content} />
        ) : null}

        {/* 转录 —— 两条路：
            主屏（默认）：**全部条目 inline 一次渲染**，滚出视口的行由内核帧引擎推进终端
              **真实回滚缓冲**（往上翻靠终端），只有还在视口里的那几行参与 diff/重画；
            备用屏（全屏）：终端没有回滚缓冲，交给我们自己的 `<ScrollBox>`
              （PgUp/PgDn/↑↓/g/G 翻，滚动条自动），仍会变的那几条钉在它下面。 */}
        {fullscreen ? (
          <ScrollBox
            items={frozen}
            height={bodyHeight}
            active={!perm && !choice}
            color={colorOf}
            hint={t('scroll_hint')}
            renderItem={(it) => <Transcript key={it.id} items={[it]} t={t} color={colorOf} />}
          />
        ) : null}

        {/* 动态帧：主屏是**整段转录**（历史由终端回滚缓冲接住）；全屏只剩"仍在变的尾部"
            + 底部区（对话框/任务树/状态行/输入框）。 */}
        <Transcript items={fullscreen ? live : state.items} t={t} color={colorOf} />

        {/* 转录与底部区之间的**版面级**结构线：出血直通终端左右边缘（正文仍留在
            内容列里）。转录**内部**那条轮次线不出血 —— 见 `Transcript.tsx` 的说明。 */}
        <Rule color={colorOf} />

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

        <StatusLine meta={state.meta} busy={state.busy} color={colorOf} width={content} t={t} />

        <Input
          t={t}
          color={colorOf}
          busy={state.busy}
          disabled={Boolean(perm) || Boolean(choice) || state.meta.ended}
          onSubmit={handleSubmit}
          width={content}
          vim={vim}
          {...(menuWithState ? { menuOptions: menuWithState } : {})}
          onInterrupt={() => {
            client.interrupt().catch(() => {
              /* 中断失败无所谓：下一轮照常 */
            });
          }}
        />
      </Box>
    </PageMargin>
  );
}
