/**
 * 选择器一族（本目录独占）—— 目前只有一个外壳 `Picker`，三种用法都走它：
 * 命令选择（有分组）/ 文件选择（有说明行）/ 多选确认（`multi`）。
 *
 * 不给每种用途各造一个组件：它们的差别只在 `items` 的字段和 `multi` 开关上，
 * 分成三个组件会把"窗口怎么滚、回车回传什么"这套口径抄三遍（一抄就漂）。
 */

export {
  Picker,
  PICKER_KEYS,
  type PickerItem,
  type PickerProps,
  type PickerResult,
  type Translate,
} from './Picker.js';
export {
  clampFocus,
  isGroupStart,
  listWindow,
  moveFocus,
  pickerWindow,
  toggleKey,
  type PickerRow,
  type PickerWindow,
} from './window.js';
