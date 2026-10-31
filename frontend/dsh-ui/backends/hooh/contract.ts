/**
 * Hooh 内核的版本与身份常量：单一事实源，manifest 与 backend.ts 都从这里取。
 */

export const HOOH_BACKEND_ID = 'hooh'
export const HOOH_BACKEND_LABEL = 'HooH'

/** 仓库根（`frontend/dsh-ui/backends/hooh` → 上三级）。 */
export function hoohRepoRoot(): string {
  const here = new URL('.', import.meta.url)
  return decodeURIComponent(new URL('../../../../', here).pathname)
    .replace(/^\/([A-Za-z]:)/, '$1')
    .replace(/\\/g, '/')
}
