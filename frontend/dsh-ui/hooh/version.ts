/**
 * **HooH 界面层的单一版本源**。
 *
 * 为什么单独一个文件：装好的 app 右下角铭牌打的是 `HooH v<这里>` ——
 * `entry.tsx` 的快照 → `adapter.launchpadData` 的 `tuiVersion` → `Launchpad`
 * 的双角铭牌。它此前在 `entry.tsx` 和三个 smoke fixture 里各写一份 `'1.1.0'`，
 * 产品升到 1.2.0 后铭牌还停在旧版：用户看到的是一个**过期的版本号**，而且
 * 没有任何门禁会响（界面层不在 tsc 的那棵 include 里）。
 *
 * **这个常量必须等于 `core/version.py` 的 `__version__`**：界面与引擎是同一个
 * 产品版本，不是两个可以各自走的号。`packaging/check_packaging.ps1` 里有一条
 * 机械校验守这个等式；发版时两处一起改（本来就该跟 CHANGELOG 一起动）。
 */
export const HOOH_UI_VERSION = '1.2.0'
