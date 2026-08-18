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
        if (item.needBooking) parts.push("⚠️需预约");
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

// CSV 转义：含逗号、引号、换行的字段用双引号包裹
function csvEscape(v: string): string {
  if (/[,"\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// 生成行程 Excel (CSV) 内容：包含行程总览 + 逐日明细 + 开销记录
export function tripToCsv(trip: TripDetail, expenses: ExpenseT[]): string {
  const BOM = "\uFEFF"; // UTF-8 BOM，确保 Excel 正确识别中文
  const start = dayjs(trip.startDate);
  const dayCount = dayjs(trip.endDate).diff(start, "day") + 1;
  const rows: string[] = [];

  // 行程总览
  rows.push("行程总览");
  rows.push(["标题", "目的地", "开始日期", "结束日期", "天数", "预算", "备注"].map(csvEscape).join(","));
  rows.push(
    [
      trip.title,
      trip.destination,
      start.format("YYYY-MM-DD"),
      dayjs(trip.endDate).format("YYYY-MM-DD"),
      String(dayCount),
      trip.budgetTotal != null ? `¥${trip.budgetTotal}` : "",
      trip.notes ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  rows.push("");

  // 逐日行程明细
  rows.push("逐日行程明细");
  rows.push(
    ["天数", "日期", "时间", "标题", "类型", "地点", "地址", "预估费用", "需预约", "备注"]
      .map(csvEscape)
      .join(","),
  );
  for (let d = 0; d < dayCount; d++) {
    const date = start.add(d, "day");
    const items = trip.items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (items.length === 0) {
      rows.push(
        [
          `第${d + 1}天`,
          date.format("YYYY-MM-DD"),
          "",
          "（无安排）",
          "",
          "",
          "",
          "",
          "",
          "",
        ]
          .map(csvEscape)
          .join(","),
      );
    } else {
      for (const item of items) {
        rows.push(
          [
            `第${d + 1}天`,
            date.format("YYYY-MM-DD"),
            item.startTime ? `${item.startTime}${item.endTime ? `-${item.endTime}` : ""}` : "",
            item.title,
            itemTypeMeta(item.type).label,
            item.placeName ?? "",
            item.address ?? "",
            item.estimatedCost != null ? `¥${item.estimatedCost}` : "",
            item.needBooking ? "是" : "",
            item.notes ?? "",
          ]
            .map(csvEscape)
            .join(","),
        );
      }
    }
  }
  rows.push("");

  // 开销记录
  if (expenses.length > 0) {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    rows.push(`开销记录（合计 ¥${total.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}）`);
    rows.push(["日期", "分类", "标题", "金额", "垫付人"].map(csvEscape).join(","));
    for (const e of expenses) {
      rows.push(
        [
          dayjs(e.date).format("YYYY-MM-DD"),
          expenseCategoryMeta(e.category).label,
          e.title,
          `¥${e.amount}`,
          e.payer ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }
    rows.push("");
  }

  rows.push(`由旅行规划工具导出于 ${dayjs().format("YYYY-MM-DD HH:mm")}`);
  return BOM + rows.join("\n");
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

// ---------- 离线 HTML 行程手册（参考行谱扫码分享的自包含手册） ----------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TYPE_ICONS: Record<string, string> = {
  SIGHT: "⛰",
  TRANSPORT: "🚌",
  HOTEL: "🏠",
  FOOD: "🍜",
  SHOPPING: "🛍",
  OTHER: "📌",
};

// 生成自包含的单文件 HTML 手册：逐日时间线 + 导航唤起链接，手机存一份离线可用
export function tripToHtmlGuide(trip: TripDetail): string {
  const start = dayjs(trip.startDate);
  const dayCount = dayjs(trip.endDate).diff(start, "day") + 1;
  const totalCost = trip.items.reduce((s, i) => s + (i.estimatedCost ?? 0), 0);

  const daySections = Array.from({ length: dayCount }, (_, d) => {
    const date = start.add(d, "day");
    const items = trip.items
      .filter((i) => i.dayIndex === d)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const cards = items
      .map((item) => {
        const meta = itemTypeMeta(item.type);
        const icon = TYPE_ICONS[item.type] ?? TYPE_ICONS.OTHER;
        const time = item.startTime
          ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}`
          : "";
        const navBtns =
          item.lng != null && item.lat != null
            ? `<div class="nav">
      <a href="https://uri.amap.com/marker?position=${item.lng},${item.lat}&name=${encodeURIComponent(item.placeName || item.title)}">高德导航</a>
      <a href="https://api.map.baidu.com/marker?location=${item.lat},${item.lng}&title=${encodeURIComponent(item.placeName || item.title)}&content=${encodeURIComponent(trip.title)}&output=html&coord_type=gcj02">百度地图</a>
    </div>`
            : "";
        return `<div class="card">
    <div class="row1"><span class="time">${esc(time)}</span><span class="badge" style="background:${meta.color === "default" ? "#999" : `var(--${meta.color},#0d9488)`}">${icon} ${meta.label}</span></div>
    <div class="title">${esc(item.title)}</div>
    ${item.placeName ? `<div class="meta">📍 ${esc(item.placeName)}${item.address ? ` · ${esc(item.address)}` : ""}</div>` : ""}
    ${item.estimatedCost != null ? `<div class="meta">💰 约 ¥${item.estimatedCost}/人</div>` : ""}
    ${item.needBooking ? `<div class="meta" style="color:#d46b08;font-weight:600">⚠️ 需提前预约</div>` : ""}
    ${item.notes ? `<div class="note">${esc(item.notes)}</div>` : ""}
    ${navBtns}
  </div>`;
      })
      .join("\n");
    return `<section>
  <h2><span class="d">Day ${d + 1}</span> ${date.format("M月D日 dddd")}</h2>
  ${cards || '<p class="empty">当天暂无安排</p>'}
</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(trip.title)} · 行程手册</title>
<style>
:root{--green:#52c41a;--blue:#1677ff;--purple:#722ed1;--orange:#fa8c16;--magenta:#eb2f96;--brand:#0d9488}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6fa;color:#222;line-height:1.5}
.wrap{max-width:560px;margin:0 auto;padding:0 14px 40px}
header{background:linear-gradient(120deg,#0f766e,#0891b2);color:#fff;padding:28px 18px 22px;border-radius:0 0 18px 18px;margin:0 -14px 18px}
header h1{margin:0 0 6px;font-size:22px}
header .sub{opacity:.85;font-size:13px}
.stats{display:flex;gap:18px;margin-top:14px}
.stats b{display:block;font-size:18px}
.stats span{font-size:12px;opacity:.8}
section h2{font-size:16px;margin:22px 0 10px;display:flex;align-items:center;gap:8px}
h2 .d{background:var(--brand);color:#fff;font-size:12px;padding:2px 10px;border-radius:99px}
.card{background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.row1{display:flex;justify-content:space-between;align-items:center;font-size:12px}
.time{color:#888;font-variant-numeric:tabular-nums}
.badge{color:#fff;padding:1px 8px;border-radius:99px;font-size:11px}
.title{font-weight:600;font-size:15px;margin-top:4px}
.meta{font-size:12px;color:#777;margin-top:3px}
.note{font-size:12px;color:#555;background:#f7f7fb;border-radius:8px;padding:6px 9px;margin-top:6px}
.nav{margin-top:8px;display:flex;gap:8px}
.nav a{flex:1;text-align:center;background:var(--brand);color:#fff;text-decoration:none;font-size:13px;padding:7px 0;border-radius:8px}
.nav a:last-child{background:#fff;color:var(--brand);border:1px solid var(--brand)}
.empty{color:#aaa;font-size:13px}
footer{text-align:center;color:#bbb;font-size:11px;margin-top:28px}
@media print{.nav{display:none}header{border-radius:0}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>🧳 ${esc(trip.title)}</h1>
  <div class="sub">${esc(trip.destination)} · ${start.format("YYYY.M.D")} – ${dayjs(trip.endDate).format("M.D")}</div>
  <div class="stats">
    <div><b>${dayCount}</b><span>天数</span></div>
    <div><b>${trip.items.length}</b><span>行程项</span></div>
    ${totalCost > 0 ? `<div><b>¥${totalCost.toLocaleString()}</b><span>预估费用</span></div>` : ""}
    ${trip.budgetTotal != null ? `<div><b>¥${trip.budgetTotal.toLocaleString()}</b><span>预算</span></div>` : ""}
  </div>
</header>
${trip.notes ? `<div class="card"><div class="title">📝 备注</div><div class="note">${esc(trip.notes)}</div></div>` : ""}
${daySections}
<footer>由旅行规划工具导出于 ${dayjs().format("YYYY-MM-DD HH:mm")} · 保存本文件即可离线查看</footer>
</div>
</body>
</html>`;
}
