// 全量接口冒烟测试（多用户版）：node scripts/smoke-all.mjs
// 需先启动服务（BASE_URL 可覆盖）。若系统未初始化会用 SMOKE_USER/SMOKE_PASS 创建管理员；
// 已初始化的系统需通过 SMOKE_USER/SMOKE_PASS 提供有效管理员账号。
// 注意：不会真实调用 AI 生成（只测参数校验路径）；会用已配置的高德 Key 做一次 POI 搜索。
import { createHmac } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const SMOKE_USER = process.env.SMOKE_USER ?? "smokeadmin";
const SMOKE_PASS = process.env.SMOKE_PASS ?? "smoke123456";

// 本地 TOTP 实现（与服务端一致：SHA1/6位/30秒），用于 2FA 端到端验证
function totpCode(secretBase32, offsetSteps = 0) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of secretBase32.toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = digest[digest.length - 1] & 0xf;
  const code =
    (((digest[off] & 0x7f) << 24) | (digest[off + 1] << 16) | (digest[off + 2] << 8) | digest[off + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

let failed = false;
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failed = true;
}
function info(msg) {
  console.log(`INFO: ${msg}`);
}

// 带 Cookie 的客户端（每个用户一个）
function makeClient() {
  let cookie = "";
  return async function api(path, opts = {}) {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? {}),
        ...(cookie ? { cookie } : {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  };
}

const admin = makeClient();

// ---------- 认证 ----------
const unauth = await fetch(`${BASE}/api/trips`);
check(unauth.status === 401, "未登录访问接口返回 401");

const status = await admin("/api/auth/status").then((r) => r.json());
if (status.needSetup) {
  const res = await admin("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username: SMOKE_USER, password: SMOKE_PASS }),
  });
  check(res.ok, "首次初始化管理员并自动登录");
} else {
  const res = await admin("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: SMOKE_USER, password: SMOKE_PASS }),
  });
  if (!res.ok) {
    console.error("FAIL: 登录失败——请通过 SMOKE_USER/SMOKE_PASS 提供有效的管理员账号");
    process.exit(1);
  }
  check(true, "管理员登录");
}
const badLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: SMOKE_USER, password: "wrong-password" }),
});
check(badLogin.status === 401, "错误密码返回 401");

// ---------- 行程与行程项 ----------
const trip = await admin("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    title: "全量冒烟行程",
    destination: "成都",
    startDate: "2026-09-01",
    endDate: "2026-09-03",
    budgetTotal: 5000,
  }),
}).then((r) => r.json());
check(!!trip.id, "创建行程");

const list = await admin("/api/trips").then((r) => r.json());
check(Array.isArray(list) && list.some((t) => t.id === trip.id && t.access?.role === "owner"), "列表包含新行程（owner 角色）");

const itemA = await admin(`/api/trips/${trip.id}/items`, {
  method: "POST",
  body: JSON.stringify({
    dayIndex: 0,
    type: "SIGHT",
    title: "宽窄巷子",
    estimatedCost: 0,
    lng: 104.05,
    lat: 30.66,
    address: "青羊区",
  }),
}).then((r) => r.json());
check(!!itemA.id && itemA.lng === 104.05, "创建行程项（含坐标）");

const modeUpd = await admin(`/api/items/${itemA.id}`, {
  method: "PUT",
  body: JSON.stringify({ transportMode: "walking" }),
}).then((r) => r.json());
check(modeUpd.transportMode === "walking", "设置分段交通方式");

// ---------- 开销 ----------
const exp1 = await admin(`/api/trips/${trip.id}/expenses`, {
  method: "POST",
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
check(!!exp1.id && exp1.participants.length === 3, "记账（含分摊）");

const exp2 = await admin(`/api/trips/${trip.id}/expenses`, {
  method: "POST",
  body: JSON.stringify({ date: "2026-09-02", category: "TICKET", title: "门票", amount: 120 }),
}).then((r) => r.json());
check(!!exp2.id, "记账（不分摊）");

const expUpd = await admin(`/api/expenses/${exp2.id}`, {
  method: "PUT",
  body: JSON.stringify({ amount: 150, payer: "李四", participants: ["张三", "李四"] }),
}).then((r) => r.json());
check(expUpd.amount === 150 && expUpd.participants.length === 2, "更新开销");

// ---------- 清单 ----------
const created = await admin(`/api/trips/${trip.id}/checklist`, {
  method: "POST",
  body: JSON.stringify({ texts: ["身份证", "充电器", "身份证"] }),
}).then((r) => r.json());
check(Array.isArray(created) && created.length === 2, "批量添加清单（去重）");

const toggled = await admin(`/api/checklist/${created[0].id}`, {
  method: "PUT",
  body: JSON.stringify({ checked: true }),
}).then((r) => r.json());
check(toggled.checked === true, "勾选清单项");

// ---------- 导出 / 导入 ----------
const backup = await admin(`/api/trips/${trip.id}/export`).then((r) => r.json());
check(
  backup.app === "lxgh" && backup.items.length === 1 && backup.expenses.length === 2 && backup.checklist.length === 2,
  "导出 JSON 备份（含全部数据）",
);

const imported = await admin("/api/import", {
  method: "POST",
  body: JSON.stringify(backup),
}).then((r) => r.json());
check(!!imported.id && imported.id !== trip.id, "导入备份为新行程");

const importedDetail = await admin(`/api/trips/${imported.id}`).then((r) => r.json());
const importedExpenses = await admin(`/api/trips/${imported.id}/expenses`).then((r) => r.json());
check(importedDetail.items.length === 1, "导入后行程项数量一致");
check(
  importedExpenses.length === 2 && importedExpenses.some((e) => e.itemId === importedDetail.items[0].id),
  "导入后开销与行程项的关联已重新映射",
);

// ---------- AI 接口（仅校验路径，不真实调用模型） ----------
const aiBad = await admin("/api/ai/generate", {
  method: "POST",
  body: JSON.stringify({ days: 3, startDate: "2026-09-01" }),
});
check(aiBad.status === 400, "AI 生成缺目的地返回 400");

const adjBad = await admin("/api/ai/adjust", {
  method: "POST",
  body: JSON.stringify({ tripId: "nonexistent", instruction: "x" }),
});
check(adjBad.status === 403 || adjBad.status === 404, "AI 调整无效行程被拒绝");

const guideLink = await admin("/api/ai/parse-guide", {
  method: "POST",
  body: JSON.stringify({
    content: "http://xhslink.com/abcdef12345678901234",
    destination: "成都",
    startDate: "2026-09-01",
  }),
});
check(guideLink.status === 400, "攻略解析传纯链接返回 400（提示粘贴正文）");

// ---------- 联网研究（仅在未配置搜索服务时测校验路径，避免消耗真实配额） ----------
const settingsNow = await admin("/api/settings").then((r) => r.json());
if (!settingsNow["search.apiKey"]) {
  const researchNoCfg = await admin(`/api/trips/${trip.id}/research`, {
    method: "POST",
    body: "{}",
  });
  check(researchNoCfg.status === 400, "未配置搜索服务时联网研究返回 400");
  const searchTest = await admin("/api/search/test", {
    method: "POST",
    body: JSON.stringify({}),
  }).then((r) => r.json());
  check(searchTest.ok === false, "搜索测试未配置 Key 时返回失败提示");
} else {
  info("已配置联网搜索服务，跳过未配置路径检查");
}
const researchDel = await admin(`/api/trips/${trip.id}/research`, { method: "DELETE" });
check(researchDel.ok, "删除研究结果接口可用");

// ---------- 逐项应用 ----------
const replBad = await admin(`/api/trips/${trip.id}/apply-items`, {
  method: "POST",
  body: JSON.stringify({ items: "nope" }),
});
check(replBad.status === 400, "逐项应用非法数据返回 400");

const applyRes = await admin(`/api/trips/${trip.id}/apply-items`, {
  method: "POST",
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
let afterApply = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
const keptA = afterApply.items.find((i) => i.id === itemA.id);
check(
  afterApply.items.length === 2 && !!keptA && keptA.type === "FOOD" && keptA.title === "宽窄巷子小吃",
  "逐项应用：原项保留 id 并更新字段，新增项已创建",
);
check(keptA?.transportMode === "walking", "逐项应用后分段交通方式保留");
const expAfterApply = await admin(`/api/trips/${trip.id}/expenses`).then((r) => r.json());
check(expAfterApply.some((e) => e.itemId === itemA.id), "逐项应用后开销与行程项的关联未断");

// ---------- 天数操作 ----------
const daysOf = (t) => Math.round((new Date(t.endDate) - new Date(t.startDate)) / 86400000) + 1;
await admin(`/api/trips/${trip.id}/days`, {
  method: "POST",
  body: JSON.stringify({ action: "insert", dayIndex: 1 }),
});
let afterDays = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
check(
  daysOf(afterDays) === 4 && afterDays.items.find((i) => i.title === "新增景点")?.dayIndex === 2,
  "中间插入一天：天数 +1 且后续安排顺延",
);
await admin(`/api/trips/${trip.id}/days`, {
  method: "POST",
  body: JSON.stringify({ action: "remove", dayIndex: 2 }),
});
afterDays = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
check(
  daysOf(afterDays) === 3 && afterDays.items.find((i) => i.title === "新增景点")?.dayIndex === 1,
  "删除某天：安排并入前一天且天数 -1",
);
// 开头插入：出发日期提前一天，原有日期不变
const dateStr = (v) => new Date(v).toISOString().slice(0, 10);
await admin(`/api/trips/${trip.id}/days`, {
  method: "POST",
  body: JSON.stringify({ action: "insert", dayIndex: 0 }),
});
afterDays = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
check(
  daysOf(afterDays) === 4 &&
    dateStr(afterDays.startDate) === "2026-08-31" &&
    dateStr(afterDays.endDate) === "2026-09-03" &&
    afterDays.items.find((i) => i.id === itemA.id)?.dayIndex === 1,
  "开头插入一天：出发日期提前、结束日期与原安排日期不变",
);
// 删除第 1 天：出发日期推迟回去
await admin(`/api/trips/${trip.id}/days`, {
  method: "POST",
  body: JSON.stringify({ action: "remove", dayIndex: 0 }),
});
afterDays = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
check(
  daysOf(afterDays) === 3 &&
    dateStr(afterDays.startDate) === "2026-09-01" &&
    afterDays.items.find((i) => i.id === itemA.id)?.dayIndex === 0,
  "删除第 1 天：出发日期推迟一天、其余日期不变",
);
await admin(`/api/trips/${trip.id}/apply-items`, {
  method: "POST",
  body: JSON.stringify({ items: afterDays.items.map((i) => ({ ...i })), days: 4 }),
});
afterDays = await admin(`/api/trips/${trip.id}`).then((r) => r.json());
check(daysOf(afterDays) === 4, "逐项应用携带 days 可扩展行程天数");

// ---------- 多用户：隔离 / 共享 / 权限 ----------
const guestUser = await admin("/api/admin/users", {
  method: "POST",
  body: JSON.stringify({ username: "smokeguest", password: "guest123456", displayName: "访客" }),
}).then((r) => r.json());
check(!!guestUser.id && guestUser.isAdmin === false, "管理员创建普通用户");

const guest = makeClient();
const guestLogin = await guest("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "smokeguest", password: "guest123456" }),
});
check(guestLogin.ok, "普通用户登录");

const guestList0 = await guest("/api/trips").then((r) => r.json());
check(!guestList0.some((t) => t.id === trip.id), "数据隔离：他人行程不出现在列表");
const guestDirect = await guest(`/api/trips/${trip.id}`);
check(guestDirect.status === 404, "数据隔离：直接访问他人行程被拒绝");
const guestAdmin = await guest("/api/admin/users");
check(guestAdmin.status === 403, "普通用户访问管理接口返回 403");
const guestSettings = await guest("/api/settings");
check(guestSettings.status === 403, "普通用户访问全局设置返回 403");

// 只读共享
await admin(`/api/trips/${trip.id}/shares`, {
  method: "POST",
  body: JSON.stringify({ userId: guestUser.id, canEdit: false }),
});
const guestList1 = await guest("/api/trips").then((r) => r.json());
check(
  guestList1.some((t) => t.id === trip.id && t.access?.role === "read"),
  "只读共享后出现在对方列表（read 角色）",
);
const guestDetail = await guest(`/api/trips/${trip.id}`).then((r) => r.json());
check(guestDetail.access?.role === "read" && guestDetail.items.length > 0, "只读共享可查看详情");
const guestEditDenied = await guest(`/api/items/${itemA.id}`, {
  method: "PUT",
  body: JSON.stringify({ title: "越权修改" }),
});
check(guestEditDenied.status === 403, "只读共享修改行程项返回 403");

// 升级为可编辑
await admin(`/api/trips/${trip.id}/shares`, {
  method: "POST",
  body: JSON.stringify({ userId: guestUser.id, canEdit: true }),
});
const guestEditOk = await guest(`/api/items/${itemA.id}`, {
  method: "PUT",
  body: JSON.stringify({ title: "共享者修改" }),
}).then((r) => r.json());
check(guestEditOk.title === "共享者修改", "可编辑共享可以修改行程项");
const guestDeleteTrip = await guest(`/api/trips/${trip.id}`, { method: "DELETE" });
check(guestDeleteTrip.status === 403, "可编辑共享仍不能删除行程");

// 取消共享
await admin(`/api/trips/${trip.id}/shares`, {
  method: "POST",
  body: JSON.stringify({ userId: guestUser.id, canEdit: null }),
});
const guestAfterUnshare = await guest(`/api/trips/${trip.id}`);
check(guestAfterUnshare.status === 404, "取消共享后无法再访问");

// ---------- 两步验证（2FA） ----------
const totpSetup = await guest("/api/auth/totp/setup", { method: "POST" }).then((r) => r.json());
check(!!totpSetup.secret && String(totpSetup.uri).startsWith("otpauth://totp/"), "生成 2FA 绑定密钥与扫码链接");

const enableBad = await guest("/api/auth/totp/enable", {
  method: "POST",
  body: JSON.stringify({ code: String((Number(totpCode(totpSetup.secret)) + 1) % 1000000).padStart(6, "0") }),
});
check(enableBad.status === 400, "错误动态码无法开启 2FA");

const enableOk = await guest("/api/auth/totp/enable", {
  method: "POST",
  body: JSON.stringify({ code: totpCode(totpSetup.secret) }),
});
check(enableOk.ok, "验证动态码正式开启 2FA");

// 开启后重新登录需要两步
const guest2 = makeClient();
const step1 = await guest2("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "smokeguest", password: "guest123456" }),
}).then((r) => r.json());
check(step1.need2fa === true && !!step1.preToken, "开启 2FA 后登录进入第二步（不发会话）");

const bad2fa = await guest2("/api/auth/login-2fa", {
  method: "POST",
  body: JSON.stringify({
    preToken: step1.preToken,
    code: String((Number(totpCode(totpSetup.secret)) + 1) % 1000000).padStart(6, "0"),
  }),
});
check(bad2fa.status === 401, "错误动态码无法完成两步登录");

const ok2fa = await guest2("/api/auth/login-2fa", {
  method: "POST",
  body: JSON.stringify({ preToken: step1.preToken, code: totpCode(totpSetup.secret) }),
});
check(ok2fa.ok, "正确动态码完成两步登录");
const st2fa = await guest2("/api/auth/status").then((r) => r.json());
check(st2fa.authed === true && st2fa.user?.totpEnabled === true, "两步登录后会话有效且状态标记 2FA");

// 管理员救援：解除用户 2FA 后可直接密码登录
await admin(`/api/admin/users/${guestUser.id}`, {
  method: "PUT",
  body: JSON.stringify({ clearTotp: true }),
});
const guest3 = makeClient();
const directLogin = await guest3("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "smokeguest", password: "guest123456" }),
}).then((r) => r.json());
check(directLogin.ok === true && !directLogin.need2fa, "管理员解除 2FA 后可直接密码登录");

// ---------- 地图搜索（真实调用一次，验证 Key 配置） ----------
const geo = await admin(`/api/geo/search?keywords=${encodeURIComponent("天安门")}`).then((r) => r.json());
if (geo.ok && geo.pois?.length > 0) {
  check(typeof geo.pois[0].lng === "number", `POI 搜索可用（示例：${geo.pois[0].name}）`);
} else {
  info(`POI 搜索未通过（${geo.error ?? "无结果"}）——未配置高德 Key 时属预期`);
}

// ---------- 天气（未配置时应优雅降级） ----------
const wx = await admin(`/api/weather?city=${encodeURIComponent("成都")}`).then((r) => r.json());
if (wx.ok) info(`天气接口可用（${wx.daily?.[0]?.text ?? "?"}）`);
else if (wx.disabled) info("天气未配置（可选功能，已优雅跳过）");
else info(`天气接口返回错误：${wx.error}`);
check(typeof wx.ok === "boolean", "天气接口响应结构正确");

// ---------- 清理 ----------
await admin(`/api/admin/users/${guestUser.id}`, { method: "DELETE" });
await admin(`/api/trips/${trip.id}`, { method: "DELETE" });
await admin(`/api/trips/${imported.id}`, { method: "DELETE" });
const gone = await admin(`/api/trips/${trip.id}`);
check(gone.status === 404, "清理测试数据");

console.log(failed ? "\n存在失败项 ❌" : "\n全部通过 ✅");
process.exit(failed ? 1 : 0);
