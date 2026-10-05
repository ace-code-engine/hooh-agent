/**
 * 三向导组（迁移/初始化/自检）。借鉴 dsh-TUI `MigratePicker` 的"多步向导"框架协议，
 * 但**不装戏**：每条不支持的路径都明说"暂不支持"而不是假成功。
 */

import { Box, Text } from "../../../vendor/dsh-ink/kernel.js";
import { displayWidth } from "../../render/text.js";
import { Byline, Divider, StatusIcon, useColumns, type ColorFn } from "../design-system/primitives.js";

export interface DoctorRow {
  readonly status: "ok" | "warn" | "err";
  readonly label: string;
  readonly note?: string;
}

/** `/doctor` 的行级输出：每行一个状态图标 + 中文描述 + 可选说明，严格列宽管理。 */
export function DoctorPanel({ rows, t, width, color }: {
  rows: readonly DoctorRow[];
  t: (k: string) => string;
  width?: number;
  color?: ColorFn;
}) {
  const cols = useColumns(width);
  const statusMark = (s: DoctorRow["status"]) => (s === "ok" ? "ok" : s === "warn" ? "warn" : "err");
  return (
    <Box flexDirection="column" width={cols}>
      <Divider title={t("wiz_doctor_title")} width={cols} color={color} />
      {rows.map((r, i) => {
        const head = `  ${r.label}`;
        return (
          <Box key={i}>
            <StatusIcon status={statusMark(r.status)} color={color} />
            <Text color={color?.("text")}>{head}</Text>
            {r.note ? (
              <Text color={color?.("dim")}>
                {" ".repeat(Math.max(0, cols - displayWidth(head) - displayWidth(r.note) - 4))}
                {r.note}
              </Text>
            ) : null}
          </Box>
        );
      })}
      <Byline parts={[t("wiz_doctor_hint")]} color={color} />
    </Box>
  );
}

export const WIZARD_KEYS = {
  doctorTitle: "wiz_doctor_title",
  doctorHint: "wiz_doctor_hint",
  migrateTitle: "wiz_migrate_title",
  migrateStep1: "wiz_migrate_step1",
  migrateStep2: "wiz_migrate_step2",
  migrateStep3: "wiz_migrate_step3",
  migrateFinish: "wiz_migrate_finish",
  migrateNone: "wiz_migrate_none",
  close: "wiz_close",
} as const;

export const WIZARD_LOCALES: Record<"zh" | "en" | "ja", Record<string, string>> = {
  zh: {
    wiz_doctor_title: "环境自检",
    wiz_doctor_hint: "Esc 关闭",
    wiz_migrate_title: "导入历史会话",
    wiz_migrate_step1: "选来源",
    wiz_migrate_step2: "预览条目",
    wiz_migrate_step3: "确认导入",
    wiz_migrate_finish: "完成",
    wiz_migrate_none: "暂不支持",
    wiz_close: "Esc 取消 / Enter 下一步",
  },
  en: {
    wiz_doctor_title: "Environment check",
    wiz_doctor_hint: "Esc to close",
    wiz_migrate_title: "Import past sessions",
    wiz_migrate_step1: "Choose source",
    wiz_migrate_step2: "Preview items",
    wiz_migrate_step3: "Confirm import",
    wiz_migrate_finish: "Done",
    wiz_migrate_none: "Not supported yet",
    wiz_close: "Esc cancel / Enter next",
  },
  ja: {
    wiz_doctor_title: "環境チェック",
    wiz_doctor_hint: "Esc で閉じる",
    wiz_migrate_title: "セッションの移行",
    wiz_migrate_step1: "移行元を選ぶ",
    wiz_migrate_step2: "プレビュー",
    wiz_migrate_step3: "インポートを確定",
    wiz_migrate_finish: "完了",
    wiz_migrate_none: "未対応",
    wiz_close: "Esc でやめる / Enter で進む",
  },
};
