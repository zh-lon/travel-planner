# AGENTS.md

This file provides guidance to Lingma (lingma.aliyun.com) when working with code in this repository.

## 项目概述

旅行规划 Travel Planner — 本地运行的一站式旅行规划工具。AI 生成行程、按天日程看板（拖拽编排）、高德地图路线、开销记账与多人分摊、行前清单、导出打印。数据全部保存在本机 SQLite 单文件 `data/app.db`。

## 常用命令

```bash
npm run dev              # 启动开发服务器（http://localhost:3000）
npm run dev:lan          # 局域网可访问（-H 0.0.0.0）
npm run build            # 生产构建（含 TypeScript 类型检查）
npm run start            # 启动生产服务器
npm run db:push          # 同步 Prisma schema 到 SQLite（首次运行、schema 变更后执行）
npx prisma db push       # 同上（等价）
node scripts/smoke-all.mjs       # 接口冒烟测试（需先启动服务，可通过 BASE_URL 环境变量覆盖）
node scripts/smoke-phase1.mjs    # 阶段 1 冒烟测试
node scripts/query-trip.mjs      # 查询行程数据
```

`npm install` 后会自动执行 `prisma generate`（`postinstall` 脚本）。

## 技术栈

| 层面 | 选型 |
|---|---|
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript（strict） |
| UI | Ant Design 5 · dnd-kit（拖拽）· ECharts（图表） |
| 数据 | SQLite + Prisma ORM（单文件 `data/app.db`） |
| 地图 | 高德 JS API 2.0（前端渲染）+ 高德 Web 服务 API（服务端代理） |
| AI | 自实现双协议客户端（OpenAI 兼容 / Anthropic），SSE 流式 |
| 认证 | Web Crypto HMAC 令牌 + TOTP 两步验证 |

## 架构要点

### 总体架构

浏览器（React + 高德 JS 地图）→ Next.js API Routes（本地 3000 端口）→ SQLite（`data/app.db`）

- `/api/trips/*` — 行程/日程项/开销 CRUD
- `/api/ai/*` — AI 生成、调整、共同创作、攻略导入、对话
- `/api/geo/*` — 地点搜索、地理编码（代理高德 Web 服务 API）
- `/api/settings` — AI/地图/天气 Key 等配置读写
- `/api/auth/*` — 登录、TOTP 验证、用户管理
- `/api/admin/*` — 管理员用户与行程管理

**所有第三方调用一律走本地服务端代理转发**：规避浏览器 CORS 限制，API Key 只存本地不进前端。

### 认证与会话

- **middleware.ts**（edge 运行时）：全局拦截，仅校验令牌签名与有效期（不查库）。`/login`、`/api/auth/*`、`/api/public/*` 放行。API 路由返回 401 JSON，页面重定向到 `/login`。
- **auth.ts**：令牌格式 `userId.过期时间戳.HMAC签名`，Web Crypto 实现，edge 与 Node 通用。**不得引入 prisma**。
- **session.ts**（Node 运行时）：`requireUser`/`requireAdmin`/`tripAccess` 等服务端鉴权，可查库核验用户状态（disabled、totpEnabled 等）。
- **两步验证**：密码校验通过后签发 5 分钟有效的 `preAuthToken`（`2fa.userId.exp.sig`），验证通过后签发正式 `lxgh_session`。
- 首次访问自动引导创建管理员账号；不开放注册，管理员在「管理」页创建其他用户。

### 行程访问权限

`tripAccess()` 返回 `{ trip, role }`，role 为 `"owner"` | `"edit"` | `"read"`：
- 管理员或 `trip.ownerId === user.id` → owner
- 被共享且 `canEdit` → edit，否则 → read
- `trip.ownerId === null` 的历史数据 → owner（首次初始化管理员时认领）

`requireTripEditByChild()` 用于 `[id]` 直达路由（行程项/开销/清单）的鉴权，返回 `NextResponse | null`。

### AI 集成

**`src/lib/ai/` 目录结构：**

| 文件 | 职责 |
|---|---|
| `client.ts` | 双协议客户端（OpenAI 兼容 / Anthropic），非流式 `chat()` + 流式 `chatStream()` |
| `schema.ts` | JSON 解析、截断修复 `repairTruncatedJson()`、宽松校验 `parsePlan()` |
| `generate.ts` | 行程生成 Prompt 构建、坐标落地 `matchPlanCoords()`、方案自检、SSE 流式响应 |
| `workflow.ts` | 工作流中间状态内存缓存（30 分钟 TTL），支持失败后从断点续跑 |
| `coplan.ts` | 共同创作（聊天式逐天规划），含概览模式 |
| `diff.ts` | AI 调整方案与现有行程的逐项对比（新增/修改/删除/不变），支持勾选后仅应用选中的变更 |
| `inspect.ts` | 行程体检（顺路检查、时段合理性） |
| `poiguide.ts` | 单地点 AI 攻略生成 |
| `geo-verify.ts` | AI 验证与修正坐标落地结果 |

**AI 配置存储**：用户通过设置页配置 Base URL / API Key / 模型名 / 协议类型，保存在 `Setting` 表（key-value），由 `settings.ts` 读写。`aiConfigFromSettings()` 从 settings map 构建 `AiConfig`。

**工作流**：`runPlanGeneration()` 编排标准流程：生成（最多 3 次重试）→ 方案自检（顺路/时段审查）→ 坐标落地（高德 POI 搜索）→ AI 坐标验证。`resume` 参数支持从 `selfcheck` 或 `coords` 续跑。

**SSE 事件类型**：`step`（工作流步骤）、`status`（进度文本）、`delta`（流式文本）、`result`（最终方案）、`error`（错误）。客户端通过 `postSse()` 消费。

### 地图集成

- **前端**：`src/lib/map/amap.ts` — 高德 JS API 2.0 单例加载器，2021-12 后创建的 Key 必须配套安全密钥（`_AMapSecurityConfig`）。
- **服务端**：`src/lib/geo.ts` — POI 搜索、地理编码、逆地理编码、坐标落地。多级兜底策略：已知 POI 坐标表 → 城市内严格搜索 → 全国宽松搜索 → 地理编码 → 已知城市中心坐标。内置 200+ 热门 POI 和 100+ 城市中心坐标。

### 数据模型

核心表：`User`、`Trip`、`ItineraryItem`、`Expense`、`ChecklistItem`、`Setting`、`TripShare`、`PoiExplorerCache`。详见 `prisma/schema.prisma`。

- SQLite 不支持枚举，`type`/`category` 用字符串常量，取值定义在 `src/types/constants.ts`。
- `Setting` 表存所有 Key 配置（AI、高德、和风天气、搜索），`SETTING_KEYS` 数组定义合法 key。
- `PoiExplorerCache` 按 `tripId + userId` 唯一，存 POI 探索器缓存。

### 环境变量

`.env` 文件（从 `.env.example` 复制）：

| 变量 | 说明 |
|---|---|
| `AUTH_SECRET` | 会话签名密钥，部署时必须改为随机长字符串 |
| `DATABASE_URL` | SQLite 路径，默认为 `file:../data/app.db` |

所有业务配置（AI Key、地图 Key、天气 Key）不在环境变量中，而是通过应用内设置页写入 `Setting` 表。

## 代码约定

- 路径别名 `@/*` 映射到 `./src/*`
- API 路由文件不允许导出非 HTTP 方法（GET/POST/PUT/DELETE/PATCH），共享逻辑提取到 `src/lib/`。
- `auth.ts` 不得引入 prisma（middleware edge 运行时无法访问数据库），所有数据库操作在 `session.ts` 中进行。
- 日期传输层使用 ISO 字符串（`src/types/index.ts` 中的类型），服务端逻辑使用 dayjs 处理。
- AI 输出解析使用宽松策略：`parseJsonLoose()` 先尝试完整解析，截断时用 `repairTruncatedJson()` 修复后再解析。
- 前端第三方 Key 不进入前端代码，一律由服务端代理转发。