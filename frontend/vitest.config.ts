import { defineConfig } from 'vitest/config'

// 只跑我们自己的测试（frontend/test/）。`dsh-ui/cli/test`、`tui-profile/conformance`
// 是上游包自带的测试（假设"已安装包"的布局与依赖），不是 HooH 的门禁——
// re-vendor 时随树搬进来，不删（跟随上游），但也不让它们把我们的测试运行拖红。
export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
  },
})
