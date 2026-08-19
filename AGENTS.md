# AGENTS.md

This file provides guidance to AI agents working with code in this repository.

## 项目概述

旅行规划 Travel Planner — 本地运行的一站式旅行规划工具。基于 **Next.js 15 (App Router) + Prisma ORM + Ant Design 5** 构建，AI 生成行程、按天日程看板（拖拽编排）、高德地图路线、开销记账与多人分摊、行前清单、导出打印。数据全部保存在本机 SQLite 单文件 `data/app.db`。

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

## 核心模块边界

### `src/app/api/` — API 路由层

| 路由前缀 | 职责 |
|---|---|
| `/api/ai/*` | AI 生成、调整、共同创作、意图识别、攻略导入、对话、推荐、行程体检 |
| `/api/trips/*` | 行程/日程项/开销/清单 CRUD |
| `/api/geo/*` | 地点搜索、地理编码、逆地理编码（代理高德 Web 服务 API） |
| `/api/auth/*` | 登录、TOTP 验证、用户管理 |
| `/api/admin/*` | 管理员用户与行程管理 |
| `/api/settings` | AI/地图/天气 Key 等配置读写 |
| `/api/weather/*` | 天气查询 |
| `/api/import` | 数据导入 |
| `/api/config/public` | 公开配置（无需认证） |
| `/api/public/guide/[token]` | 随身行程手册公开访问 |

**约束**：API 路由文件不允许导出非 HTTP 方法（GET/POST/PUT/DELETE/PATCH），共享逻辑必须提取到 `src/lib/`。

### `src/lib/` — 共享服务层

| 子模块 | 职责 |
|---|---|
| `lib/ai/` | AI 客户端、协议适配、Prompt 构建、工作流编排、JSON 解析修复、坐标验证 |
| `lib/map/` | 高德地图 JS API 前端加载器 |
| `lib/auth.ts` | 令牌签名/验证（纯 Web Crypto，edge 兼容，**严禁引入 prisma**） |
| `lib/session.ts` | 服务端鉴权（Node 运行时，可查库核验用户状态、权限） |
| `lib/db.ts` | Prisma 客户端单例 |
| `lib/geo.ts` | 地理编码、POI 搜索、坐标落地（多级兜底策略） |
| `lib/trips.ts` | 行程业务逻辑 |
| `lib/settings.ts` | 设置读写（`aiConfigFromSettings()` 构建 `AiConfig`） |
| `lib/weather.ts` | 天气查询 |
| `lib/sse-client.ts` | 前端 SSE 流式消费（`postSse()`） |
| `lib/export.ts` | 行程导出打印 |
| `lib/websearch.ts` | 联网搜索（博查 API） |
| `lib/password.ts` | 密码哈希 |
| `lib/totp.ts` | TOTP 两步验证 |
| `lib/dayjs-init.ts` | dayjs 插件初始化 |
| `lib/header-context.tsx` | 页面 Header 上下文 |
| `lib/use-is-mobile.ts` | 移动端检测 Hook |

### `src/components/` — UI 组件层

页面级组件与可复用业务组件：

| 组件 | 职责 |
|---|---|
| `AppShell.tsx` | 应用外壳布局（Header + 导航 + 内容区） |
| `ItineraryBoard.tsx` | 按天日程看板（dnd-kit 拖拽编排） |
| `MapPanel.tsx` | 地图面板（高德 JS API 渲染） |
| `AiAssistantPanel.tsx` | AI 助手对话面板（意图分流：ADJUST/CHAT） |
| `AiPlanWizard.tsx` | AI 规划向导（一键生成行程） |
| `AiDiffPreview.tsx` | AI 调整方案与现有行程的逐项对比 |
| `AiAdjustModal.tsx` | AI 调整弹窗 |
| `AiPlanPreview.tsx` | AI 生成方案预览 |
| `CoplanDrawer.tsx` | 共同创作抽屉（聊天式逐天规划） |
| `ExpensesPanel.tsx` | 开销记账面板（多人分摊） |
| `ChecklistPanel.tsx` | 行前清单面板 |
| `PoiExplorerPanel.tsx` | POI 探索器面板 |
| `ResearchPanel.tsx` | 研究面板（联网搜索） |
| `PoiDetailDrawer.tsx` | POI 详情抽屉 |
| `TripInspectDrawer.tsx` | 行程体检抽屉 |
| `WorkflowSteps.tsx` | 工作流步骤条（竖向） |
| `ExpenseFormModal.tsx` | 开销表单弹窗 |
| `ItemFormModal.tsx` | 日程项表单弹窗 |
| `TripFormModal.tsx` | 行程表单弹窗 |
| `MapPickerModal.tsx` | 地图选点弹窗 |
| `GuideImportModal.tsx` | 攻略导入弹窗 |
| `GuideShareModal.tsx` | 攻略分享弹窗 |
| `ShareModal.tsx` | 行程分享弹窗 |
| `SecurityModal.tsx` | 安全设置弹窗 |
| `EChart.tsx` | ECharts 图表封装 |
| `mobile/` | 手机版专属组件（`MobileHome`、`MobileTripDetail`） |

### `src/types/` — 类型与常量

- `types/index.ts` — 共享 TypeScript 类型定义（日期传输层使用 ISO 字符串）
- `types/constants.ts` — 枚举替代常量（SQLite 不支持枚举，`type`/`category` 取值定义在此）
- `types/global.d.ts` — 全局类型声明

### `prisma/` — 数据模型

核心表：`User`、`Trip`、`ItineraryItem`、`Expense`、`ChecklistItem`、`Setting`、`TripShare`、`PoiExplorerCache`。详见 `prisma/schema.prisma`。

## 关键架构决策

### 1. AI 接口全部流式化

所有 AI 调用统一采用 SSE 流式输出（`chatStream` + `ReadableStream` 服务端模式），客户端通过 `postSse()` 接收事件流。**非流式 `chat()` 仅用于秒级小输出场景**（意图识别 `maxTokens=8`、连通性测试 `maxTokens=256`）。长耗时大输出（方案生成、方案自检、AI 推荐）必须走流式，超时 300 秒。

### 2. SSE 心跳保活

所有 SSE 流式接口必须配置 **15 秒心跳**（`: heartbeat\n\n`），覆盖首 token 前（TTFT）、地理编码等无数据阶段，防止被反向代理（Nginx）中断。部署时 `proxy_read_timeout` 和 `proxy_send_timeout` 至少设为 300 秒。注意 Cloudflare 免费版有 100 秒边缘超时限制。

### 3. JSON 截断修复

所有 AI 结构化输出解析统一走 `lib/ai/schema.ts` 的 `parseJsonLoose(raw)`：先用 `isTruncatedJson` 检测输出是否被截断（模型/代理输出长度上限导致尾部括号缺失），完整输出走 `extractJson` + `JSON.parse`，截断输出走 `repairTruncatedJson` 修复——带状态的括号栈扫描（区分键/值/字符串内外），闭合未结束的字符串、丢弃悬空键名与半截字面量、补齐右括号。接入点覆盖全链路：`parsePlan`（生成/调整/自检）、`parse-intent`、`recommend`、`coplan`、`poiguide`、`inspect`。解析失败时服务端记录目的地、模型、`rawLength`、`rawPreview` 前 500 字符等调试信息。

### 4. 第三方 API 服务端代理

所有第三方调用（AI、高德地图、和风天气、博查搜索）一律走本地服务端代理转发，API Key 只存本地不进前端，规避浏览器 CORS 限制。所有业务配置（AI Key、地图 Key、天气 Key）不在环境变量中，而是通过应用内设置页写入 `Setting` 表。

### 5. 认证三层架构

| 层 | 文件 | 运行时 | 职责 |
|---|---|---|---|
| 网关层 | `middleware.ts` | Edge | 仅校验令牌签名与有效期，不查库。`/login`、`/api/auth/*`、`/api/public/*` 放行。API 返回 401 JSON，页面重定向 `/login` |
| 工具层 | `lib/auth.ts` | Edge/Node | 令牌格式 `userId.过期时间戳.HMAC签名`，Web Crypto 实现。**严禁引入 prisma** |
| 鉴权层 | `lib/session.ts` | Node | `requireUser`/`requireAdmin`/`tripAccess`，可查库核验用户状态（disabled、totpEnabled 等） |

两步验证：密码校验通过后签发 5 分钟有效的 `preAuthToken`（`2fa.userId.exp.sig`），验证通过后签发正式 `lxgh_session`。首次访问自动引导创建管理员账号；不开放注册，管理员在「管理」页创建其他用户。

### 6. 工作流失败即终止 + 断点续跑

行程生成编排 `runPlanGeneration()` 标准流程：生成（最多 3 次重试）→ 方案自检（顺路/时段审查）→ 坐标落地（高德 POI 搜索）→ AI 坐标验证。任一步骤失败即终止，前端可从失败步骤续跑（`resume` 参数支持 `selfcheck` 或 `coords`）。中间状态内存缓存 30 分钟 TTL。SSE 事件类型：`step`（工作流步骤）、`status`（进度文本）、`delta`（流式文本）、`result`（最终方案）、`error`（错误）。

### 7. 行程访问权限三级控制

`tripAccess()` 返回 `{ trip, role }`，role 为 `"owner"` | `"edit"` | `"read"`：
- 管理员或 `trip.ownerId === user.id` → owner
- 被共享且 `canEdit` → edit，否则 → read
- `trip.ownerId === null` 的历史数据 → owner（首次初始化管理员时认领）

## 编码约定

### 统一 UI 视觉规范

- 使用 CSS 变量管理主题色、圆角、阴影
- 卡片统一 **12px 圆角**和微阴影，滚动条为细窄半透明风格
- 关键元素使用渐变背景和 hover 动效
- **尺寸规范**：
  - 行程详情页 header 高度 **56px**，其他页面 **48px**
  - 行程标题字号 **17px**，最大宽度 260px；日期信息字号 **13px**
  - 操作按钮统一使用 **`middle`** 尺寸
  - Logo 图标 32×32，圆角 7px，内部文字 18px
  - 用户头像 30×30，圆角 7px，内部文字 12px，按钮高度 36px
- 导航菜单结构与行为保持一致，日导航栏滚动固定

### React Portal 弹层事件冒泡处理

Ant Design 的 `Popconfirm`、`Popover`、`Modal` 等基于 React Portal 渲染的弹出层，其内部点击事件会沿 **React 组件树**（而非 DOM 树）冒泡到触发器的祖先元素。若触发器位于可点击的卡片/行容器内（容器 `onClick` 用于打开详情等），点气泡内按钮会误触发容器 `onClick`。

**正确做法**：在触发组件外包裹一层带 `onClick` + `e.stopPropagation()` 的元素拦截冒泡。仅对触发按钮本身 `stopPropagation` 无法拦截弹层内部的点击。

### 路径与模块边界

- 路径别名 `@/*` 映射到 `./src/*`
- API 路由文件不允许导出非 HTTP 方法（GET/POST/PUT/DELETE/PATCH），共享逻辑提取到 `src/lib/`
- `auth.ts` 不得引入 prisma（middleware edge 运行时无法访问数据库），所有数据库操作在 `session.ts` 中进行
- 日期传输层使用 ISO 字符串（`src/types/index.ts` 中的类型），服务端逻辑使用 dayjs 处理
- 前端第三方 Key 不进入前端代码，一律由服务端代理转发

### 数据模型约定

- SQLite 不支持枚举，`type`/`category` 用字符串常量，取值定义在 `src/types/constants.ts`
- `Setting` 表存所有业务配置（AI、高德、和风天气、搜索），`SETTING_KEYS` 数组定义合法 key
- `PoiExplorerCache` 按 `tripId + userId` 唯一，存 POI 探索器缓存

### 其他约定

- 列表项之间插入功能使用悬停热区交互模式（而非始终可见的按钮）
- 使用 `useRef` 避免闭包状态延迟问题
- 手机版通过 `src/app/trips/[id]/` 下的 `page.tsx` 与 `src/components/mobile/` 实现设备路由
- 所有搜索功能均为手动触发，不自动执行

## 变更验证步骤

每次代码变更后，按以下顺序验证：

1. **TypeScript 类型检查 + 构建**：
   ```bash
   npm run build
   ```
   含 TypeScript 类型检查，必须零错误通过。

2. **接口冒烟测试**：
   ```bash
   npm run dev          # 先启动开发服务器
   node scripts/smoke-all.mjs   # 另开终端执行（可通过 BASE_URL 覆盖目标地址）
   ```
   验证所有核心 API 接口可用性。

3. **阶段测试**（可选）：
   ```bash
   node scripts/smoke-phase1.mjs
   ```
   验证阶段 1 核心接口。

4. **手动验证**：在浏览器中验证关键交互流程——AI 生成行程、日程看板拖拽编排、地图显示、开销记账、清单管理、行程导出打印。