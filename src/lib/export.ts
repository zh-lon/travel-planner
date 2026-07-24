// 客户端导出工具：Markdown 生成与文件下载
import dayjs from "dayjs";
import { expenseCategoryMeta, itemTypeMeta } from "@/types/constants";
import type { ExpenseT, TripDetail } from "@/types";

export function tripToMarkdown(trip: TripDetail, expenses: ExpenseT[]): string {
  const start = dayjs(trip.startDate);
  const end = dayjs(trip.endDate);
  const dayCount = end.diff(start, "day") + 1;
  const lines: string[] = [];

  lines.push(`# ${trip.title}`);
  lines.push("");
  lines.push(`- 目的地：${trip.destination}`);
  lines.push(`- 日期：${start.format("YYYY年M月D日")} - ${end.format("M月D日")}（共 ${dayCount} 天）`);
  if (trip.budgetTotal != null) lines.push(`- 预算：¥${trip.budgetTotal.toLocaleString()}`);
  if (trip.notes) lines.push(`- 备注：${trip.notes}`);
  lines.push("");

  for (let d = 0; d < dayCount; d++) {
    const date = start.add(d, "day");
    lines.push(`## 第 ${d + 1} 天 · ${date.format("M月D日 dddd")}`);
    lines.push("");
    const items = trip.items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (items.length === 0) {
      lines.push("（无安排）");
    } else {
      for (const item of items) {
        const parts: string[] = [];
        if (item.startTime) parts.push(`${item.startTime}${item.endTime ? `-${item.endTime}` : ""}`);
        parts.push(`**${item.title}**`);
        parts.push(`\`${itemTypeMeta(item.type).label}\``);
        if (item.placeName) parts.push(`📍${item.placeName}`);
        if (item.estimatedCost != null) parts.push(`约 ¥${item.estimatedCost}`);
        lines.push(`- ${parts.join(" ")}`);
        if (item.notes) lines.push(`  - ${item.notes}`);
      }
    }
    lines.push("");
  }

  if (expenses.length > 0) {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    lines.push(`## 开销记录（合计 ¥${total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}）`);
    lines.push("");
    lines.push("| 日期 | 分类 | 标题 | 金额 | 垫付人 |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const e of expenses) {
      lines.push(
        `| ${dayjs(e.date).format("M/D")} | ${expenseCategoryMeta(e.category).label} | ${e.title} | ¥${e.amount} | ${e.payer ?? "-"} |`,
      );
    }
    lines.push("");
  }

  lines.push(`> 由旅行规划工具导出于 ${dayjs().format("YYYY-MM-DD HH:mm")}`);
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
