// 阶段 1 接口冒烟测试：node scripts/smoke-phase1.mjs（需先启动服务，BASE_URL 可覆盖）
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const JSON_HEADERS = { "content-type": "application/json" };

let failed = false;
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failed = true;
}

// 1. 创建行程（3 天）
const trip = await fetch(`${BASE}/api/trips`, {
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify({
    title: "冒烟测试行程",
    destination: "成都",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    budgetTotal: 3000,
    notes: "smoke",
  }),
}).then((r) => r.json());
check(!!trip.id, "创建行程");

// 2. 列表包含新行程
const list = await fetch(`${BASE}/api/trips`).then((r) => r.json());
check(Array.isArray(list) && list.some((t) => t.id === trip.id), "列表包含新行程");

// 3. 添加行程项
const addItem = (dayIndex, title, type = "SIGHT") =>
  fetch(`${BASE}/api/trips/${trip.id}/items`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ dayIndex, type, title, startTime: "09:00", endTime: "11:00", estimatedCost: 100 }),
  }).then((r) => r.json());

const a = await addItem(0, "宽窄巷子");
const b = await addItem(0, "锦里小吃", "FOOD");
const c = await addItem(1, "大熊猫基地");
check(!!a.id && !!b.id && !!c.id, "添加 3 个行程项");
check(a.sortOrder === 0 && b.sortOrder === 1, "同日 sortOrder 自动递增");

// 4. 越界天数应被拒绝
const bad = await fetch(`${BASE}/api/trips/${trip.id}/items`, {
  method: "POST",
  headers: JSON_HEADERS,
  body: JSON.stringify({ dayIndex: 9, type: "SIGHT", title: "越界" }),
});
check(bad.status === 400, "越界 dayIndex 返回 400");

// 5. 批量排序：把「锦里小吃」移到第 3 天
await fetch(`${BASE}/api/trips/${trip.id}/reorder`, {
  method: "PUT",
  headers: JSON_HEADERS,
  body: JSON.stringify({
    items: [
      { id: a.id, dayIndex: 0, sortOrder: 0 },
      { id: c.id, dayIndex: 1, sortOrder: 0 },
      { id: b.id, dayIndex: 2, sortOrder: 0 },
    ],
  }),
});
let detail = await fetch(`${BASE}/api/trips/${trip.id}`).then((r) => r.json());
check(detail.items.find((i) => i.id === b.id)?.dayIndex === 2, "跨天移动已持久化");

// 6. 更新行程项
const updated = await fetch(`${BASE}/api/items/${a.id}`, {
  method: "PUT",
  headers: JSON_HEADERS,
  body: JSON.stringify({ title: "宽窄巷子（改）", estimatedCost: 50, startTime: "" }),
}).then((r) => r.json());
check(updated.title === "宽窄巷子（改）" && updated.estimatedCost === 50 && updated.startTime === null, "更新行程项字段");

// 7. 删除行程项
const delItem = await fetch(`${BASE}/api/items/${c.id}`, { method: "DELETE" });
check(delItem.ok, "删除行程项");

// 8. 缩短行程日期 → 越界项收敛到最后一天
await fetch(`${BASE}/api/trips/${trip.id}`, {
  method: "PUT",
  headers: JSON_HEADERS,
  body: JSON.stringify({
    title: "冒烟测试行程",
    destination: "成都",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    budgetTotal: 3000,
    notes: "",
  }),
});
detail = await fetch(`${BASE}/api/trips/${trip.id}`).then((r) => r.json());
check(detail.items.find((i) => i.id === b.id)?.dayIndex === 1, "缩短日期后越界项收敛到最后一天");

// 9. 删除行程（级联）
await fetch(`${BASE}/api/trips/${trip.id}`, { method: "DELETE" });
const gone = await fetch(`${BASE}/api/trips/${trip.id}`);
check(gone.status === 404, "删除行程后详情返回 404");

console.log(failed ? "\n存在失败项 ❌" : "\n全部通过 ✅");
process.exit(failed ? 1 : 0);
