// 全量接口冒烟测试：node scripts/smoke-all.mjs（需先启动服务，BASE_URL 可覆盖）
// 注意：不会真实调用 AI 生成（只测参数校验路径）；会用已配置的高德 Key 做一次 POI 搜索
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const H = { "content-type": "application/json" };

let failed = false;
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failed = true;
}
function info(msg) {
  console.log(`INFO: ${msg}`);
}

// ---------- 行程与行程项（回归） ----------
const trip = await fetch(`${BASE}/api/trips`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    title: "全量冒烟行程",
    destination: "成都",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    budgetTotal: 5000,
  }),
}).then((r) => r.json());
check(!!trip.id, "创建行程");

const itemA = await fetch(`${BASE}/api/trips/${trip.id}/items`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ dayIndex: 0, type: "SIGHT", title: "宽窄巷子", estimatedCost: 0, lng: 104.05, lat: 30.66, address: "青羊区" }),
}).then((r) => r.json());
check(!!itemA.id && itemA.lng === 104.05, "创建行程项（含坐标）");

const modeUpd = await fetch(`${BASE}/api/items/${itemA.id}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ transportMode: "walking" }),
}).then((r) => r.json());
check(modeUpd.transportMode === "walking", "设置分段交通方式");

// ---------- 开销 ----------
const exp1 = await fetch(`${BASE}/api/trips/${trip.id}/expenses`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    date: "2026-09-01",
    category: "FOOD",
    title: "火锅",
    amount: 300,
    payer: "张三",
    participants: ["张三", "李四", "王五"],
    itemId: itemA.id,
  }),
}).then((r) => r.json());
check(!!exp1.id && Array.isArray(exp1.participants) && exp1.participants.length === 3, "记账（含分摊）");

const exp2 = await fetch(`${BASE}/api/trips/${trip.id}/expenses`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ date: "2026-09-02", category: "TICKET", title: "门票", amount: 120 }),
}).then((r) => r.json());
check(!!exp2.id, "记账（不分摊）");

let expList = await fetch(`${BASE}/api/trips/${trip.id}/expenses`).then((r) => r.json());
check(Array.isArray(expList) && expList.length === 2, "开销列表");

const expUpd = await fetch(`${BASE}/api/expenses/${exp2.id}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ amount: 150, payer: "李四", participants: ["张三", "李四"] }),
}).then((r) => r.json());
check(expUpd.amount === 150 && expUpd.participants.length === 2, "更新开销");

// ---------- 清单 ----------
const created = await fetch(`${BASE}/api/trips/${trip.id}/checklist`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ texts: ["身份证", "充电器", "身份证"] }),
}).then((r) => r.json());
check(Array.isArray(created) && created.length === 2, "批量添加清单（去重）");

const toggled = await fetch(`${BASE}/api/checklist/${created[0].id}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ checked: true }),
}).then((r) => r.json());
check(toggled.checked === true, "勾选清单项");

// ---------- 导出 / 导入 ----------
const exportRes = await fetch(`${BASE}/api/trips/${trip.id}/export`);
const backup = await exportRes.json();
check(
  backup.app === "lxgh" && backup.items.length === 1 && backup.expenses.length === 2 && backup.checklist.length === 2,
  "导出 JSON 备份（含全部数据）",
);

const imported = await fetch(`${BASE}/api/import`, {
  method: "POST",
  headers: H,
  body: JSON.stringify(backup),
}).then((r) => r.json());
check(!!imported.id && imported.id !== trip.id, "导入备份为新行程");

const importedDetail = await fetch(`${BASE}/api/trips/${imported.id}`).then((r) => r.json());
const importedExpenses = await fetch(`${BASE}/api/trips/${imported.id}/expenses`).then((r) => r.json());
check(importedDetail.items.length === 1, "导入后行程项数量一致");
check(
  importedExpenses.length === 2 &&
    importedExpenses.some((e) => e.itemId === importedDetail.items[0].id),
  "导入后开销与行程项的关联已重新映射",
);

// ---------- AI 接口（仅校验路径，不真实调用模型） ----------
const aiBad = await fetch(`${BASE}/api/ai/generate`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ days: 3, startDate: "2026-09-01" }),
});
check(aiBad.status === 400, "AI 生成缺目的地返回 400");

const adjBad = await fetch(`${BASE}/api/ai/adjust`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ tripId: "nonexistent", instruction: "x" }),
});
check(adjBad.status === 404, "AI 调整无效行程返回 404");

const guideLink = await fetch(`${BASE}/api/ai/parse-guide`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    content: "http://xhslink.com/abcdef12345678901234",
    destination: "成都",
    startDate: "2026-09-01",
  }),
});
check(guideLink.status === 400, "攻略解析传纯链接返回 400（提示粘贴正文）");

const replBad = await fetch(`${BASE}/api/trips/${trip.id}/apply-items`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ items: "nope" }),
});
check(replBad.status === 400, "逐项应用非法数据返回 400");

// 逐项应用：更新 itemA（保留 id）+ 新增一项，验证增删改与关联保留
const applyRes = await fetch(`${BASE}/api/trips/${trip.id}/apply-items`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    items: [
      {
        id: itemA.id,
        dayIndex: 0,
        sortOrder: 0,
        type: "FOOD",
        title: "宽窄巷子小吃",
        startTime: "11:00",
        endTime: "12:00",
        placeName: "宽窄巷子",
        lng: 104.05,
        lat: 30.66,
        address: "青羊区",
        estimatedCost: 80,
        notes: "",
        aiGenerated: true,
      },
      {
        dayIndex: 1,
        sortOrder: 0,
        type: "SIGHT",
        title: "新增景点",
        startTime: null,
        endTime: null,
        placeName: null,
        lng: null,
        lat: null,
        address: null,
        estimatedCost: null,
        notes: null,
        aiGenerated: true,
      },
    ],
  }),
}).then((r) => r.json());
check(applyRes.ok === true, "逐项应用提交成功");
const afterApply = await fetch(`${BASE}/api/trips/${trip.id}`).then((r) => r.json());
const keptA = afterApply.items.find((i) => i.id === itemA.id);
check(
  afterApply.items.length === 2 && !!keptA && keptA.type === "FOOD" && keptA.title === "宽窄巷子小吃",
  "逐项应用：原项保留 id 并更新字段，新增项已创建",
);
check(keptA?.transportMode === "walking", "逐项应用后分段交通方式保留");
const expAfterApply = await fetch(`${BASE}/api/trips/${trip.id}/expenses`).then((r) => r.json());
check(
  expAfterApply.some((e) => e.itemId === itemA.id),
  "逐项应用后开销与行程项的关联未断",
);

// ---------- 地图搜索（真实调用一次，验证 Key 配置） ----------
const geo = await fetch(`${BASE}/api/geo/search?keywords=${encodeURIComponent("天安门")}`).then((r) => r.json());
if (geo.ok && geo.pois?.length > 0) {
  check(typeof geo.pois[0].lng === "number", `POI 搜索可用（示例：${geo.pois[0].name}）`);
} else {
  info(`POI 搜索未通过（${geo.error ?? "无结果"}）——请检查设置页的高德 Web 服务 Key`);
}

// ---------- 天气（未配置时应优雅降级） ----------
const wx = await fetch(`${BASE}/api/weather?city=${encodeURIComponent("成都")}`).then((r) => r.json());
if (wx.ok) info(`天气接口可用（${wx.daily?.[0]?.text ?? "?"}）`);
else if (wx.disabled) info("天气未配置（可选功能，已优雅跳过）");
else info(`天气接口返回错误：${wx.error}`);
check(typeof wx.ok === "boolean", "天气接口响应结构正确");

// ---------- 清理 ----------
await fetch(`${BASE}/api/trips/${trip.id}`, { method: "DELETE" });
await fetch(`${BASE}/api/trips/${imported.id}`, { method: "DELETE" });
const gone = await fetch(`${BASE}/api/trips/${trip.id}`);
check(gone.status === 404, "清理测试数据");

console.log(failed ? "\n存在失败项 ❌" : "\n全部通过 ✅");
process.exit(failed ? 1 : 0);
