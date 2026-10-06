/**
 * `session-extra/` 的文案（本目录专用；zh/en/ja 都有值）。
 * 键名前缀 sessx_，零撞票（与 stree、picker、set、draft、help 一族都不冲突）。
 *
 * 写法与 `help/`、`usage/` 同一取态：三语值用反引号模板串、键表「先声明再 `export {}`」
 * —— 守卫白名单为空，`locales/**` 与 `i18n-complete.test.ts` 归整合波独占。收编时
 * 把本表搬进 `locales/*.json` 并登记 `KEY_TABLES`，这两条即可去掉。
 */

const SESSX_KEYS = {
  title: "sessx_title",
  jobs: "sessx_jobs",
  agents: "sessx_agents",
  loading: "sessx_loading",
  emptyJobs: "sessx_empty_jobs",
  emptyAgents: "sessx_empty_agents",
  picked: "sessx_picked",
  hint: "sessx_hint",
  close: "sessx_close",
} as const;

export type SessXKey = (typeof SESSX_KEYS)[keyof typeof SESSX_KEYS];

export const SESSX_LOCALES: Record<"zh" | "en" | "ja", Record<SessXKey, string>> = {
  zh: {
    sessx_title: `后台任务 · 子代理`,
    sessx_jobs: `后台任务`,
    sessx_agents: `子代理`,
    sessx_loading: `读不到（稍后）`,
    sessx_empty_jobs: `暂无后台任务`,
    sessx_empty_agents: `暂无子代理`,
    sessx_picked: `已选中 {id}`,
    sessx_hint: `↑↓ / Tab 切换 · Enter 选中`,
    sessx_close: `Esc 关闭`,
  },
  en: {
    sessx_title: `Background jobs · Subagents`,
    sessx_jobs: `Background jobs`,
    sessx_agents: `Subagents`,
    sessx_loading: `Loading…`,
    sessx_empty_jobs: `No background jobs`,
    sessx_empty_agents: `No subagents`,
    sessx_picked: `Selected {id}`,
    sessx_hint: `↑↓ / Tab switch pane · Enter select`,
    sessx_close: `Esc to close`,
  },
  ja: {
    sessx_title: `バックグラウンドジョブ · サブエージェント`,
    sessx_jobs: `バックグラウンドジョブ`,
    sessx_agents: `サブエージェント`,
    sessx_loading: `読み込み中…`,
    sessx_empty_jobs: `バックグラウンドジョブなし`,
    sessx_empty_agents: `サブエージェントなし`,
    sessx_picked: `{id} を選択`,
    sessx_hint: `↑↓ / Tab で切替 · Enter で確定`,
    sessx_close: `Esc で閏じる`,
  },
};

export { SESSX_KEYS };
