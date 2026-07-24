// 行程相关的共享校验与工具（route 文件不允许导出非 HTTP 方法，故独立成模块）

export function dayCountOf(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

export function parseTripBody(body: Record<string, unknown> | null):
  | { error: string }
  | {
      data: {
        title: string;
        destination: string;
        startDate: Date;
        endDate: Date;
        budgetTotal: number | null;
        notes: string | null;
      };
    } {
  if (!body) return { error: "请求体格式错误" };
  const { title, destination, startDate, endDate, budgetTotal, notes } = body;
  if (typeof title !== "string" || !title.trim()) return { error: "行程标题不能为空" };
  if (typeof destination !== "string" || !destination.trim()) return { error: "目的地不能为空" };
  const start = new Date(String(startDate));
  const end = new Date(String(endDate));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "日期格式不合法" };
  }
  if (end.getTime() < start.getTime()) return { error: "结束日期不能早于开始日期" };
  return {
    data: {
      title: title.trim(),
      destination: destination.trim(),
      startDate: start,
      endDate: end,
      budgetTotal: typeof budgetTotal === "number" && budgetTotal >= 0 ? budgetTotal : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    },
  };
}
