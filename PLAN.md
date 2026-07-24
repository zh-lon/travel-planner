# 旅行规划软件 · 开发方案

> 快速浏览可看表格总览版：[PLAN_TABLE.md](PLAN_TABLE.md)
>
> **进度（2026-07-23）：全部完成 ✅** 阶段 0（脚手架/设置）、阶段 1（行程与日程编排）、阶段 2（地图集成）、阶段 3（开销与分摊）、阶段 4（AI 生成与调整）以及三期增强（行前清单、导出/导入/打印、和风天气）均已实现并通过冒烟测试。

## 一、需求确认

| 决策点 | 结论 |
|---|---|
| 产品形态 | Web 网页应用，本地运行（localhost），无需部署服务器 |
| 使用对象 | 自己/亲友，无需注册登录体系 |
| 核心功能 | AI 智能生成行程、手动行程编排、地图路线可视化、预算与开销管理 |
| 目的地范围 | 仅国内行程，不考虑海外 |
| AI 接入 | 用户自配服务地址 + API Key + 模型名，应用内设置页随时修改 |
| 技术栈 | 无偏好，按主流、单人易维护方案选型 |

## 二、技术选型

一套 TypeScript 全栈方案，单项目、一条命令启动：

| 层面 | 选型 | 理由 |
|---|---|---|
| 应用框架 | Next.js（App Router）+ React + TypeScript | 前后端一体，`npm run dev` 一条命令跑起来；API Routes 直接充当本地后端 |
| UI 组件 | Ant Design 5 | 表单、日期区间选择、表格、时间轴等旅行类界面组件开箱即用 |
| 拖拽 | dnd-kit | 行程项拖拽排序、跨天移动 |
| 地图 | 高德地图 JS API 2.0 | 仅做国内行程，高德 POI 数据最全，个人开发者免费配额充足 |
| 图表 | ECharts | 开销分类统计、预算对比 |
| 数据库 | SQLite + Prisma ORM | 单文件数据库零安装，备份 = 复制一个文件 |
| AI 客户端 | 自实现轻量客户端 | 兼容 OpenAI Chat Completions 协议（DeepSeek、Kimi、通义、one-api/new-api 自建网关等主流自定义服务通用），可选 Anthropic Messages 协议 |

不选前后端分离双工程（Vite + FastAPI 等）的原因：本地自用场景下单进程更省事，少一半的工程和启动命令，且 TS 一门语言贯通。

## 三、总体架构

```
浏览器 (React UI + 高德 JS 地图)
   │  fetch
   ▼
Next.js API Routes（本地 3000 端口）
   ├── /api/trips…        行程 / 日程项 / 开销 CRUD ──► SQLite (data/app.db)
   ├── /api/ai/generate   AI 行程生成：服务端代理转发到用户配置的 AI 服务
   ├── /api/geo/…         地点搜索 / 地理编码（代理高德 Web 服务 API）
   └── /api/settings      AI / 地图 Key 等配置读写
```

要点：

- **所有第三方调用走本地服务端代理**：规避浏览器 CORS 限制（自定义 AI 服务地址千差万别，直连浏览器大概率被 CORS 挡住），API Key 只存本地、不进前端代码。
- 高德 JS API（地图渲染部分）在前端加载，使用 JS API 类型的 Key。
- 亲友使用：同一局域网内访问 `http://你的电脑IP:3000` 即可，无需任何部署。

## 四、功能规划（分三期）

### 第 1 期 · MVP：手动规划闭环

1. **行程管理**：创建/编辑/删除旅行计划（标题、目的地、日期范围、总预算、备注）
2. **日程编排**：按天分栏；行程项分类型（景点/交通/住宿/餐饮/购物/其他）增删改；起止时间；拖拽排序、跨天移动
3. **地图联动**：地图搜索 POI 直接加入行程；按天用不同颜色标注地点并连线展示动线；点击行程项地图定位；一眼看出路线绕不绕
4. **开销记录**：按分类记账（可关联行程项）；预算 vs 实际；分类统计图表
5. **设置页**：AI 服务配置（Base URL / API Key / 模型名 / 协议类型）+ 高德 Key 配置，附「测试连通性」按钮

### 第 2 期 · AI 智能生成

1. 生成向导：输入目的地、天数或日期、人数、预算档位、偏好（亲子/美食/暴走/休闲…）、必去地点
2. 服务端组装 Prompt，要求模型按约定 JSON Schema 输出行程（每天主题、行程项、预估费用、推荐理由）
3. 流式展示生成过程；JSON 校验失败自动携带错误信息重试（上限 2 次）
4. **坐标落地**：AI 只会输出地名，批量调用高德 POI 搜索匹配坐标；匹配失败的地点高亮出来，由用户手动搜索纠正
5. 一键导入为可编辑行程（与手动编排共用同一套数据结构）；后续可做「AI 调整」——对已有行程提优化建议、重排某一天

### 第 3 期 · 体验增强（按需挑选）

- 多人分摊记账（谁垫付的、平摊、结算建议）
- 行程导出：Markdown / 打印友好页面（浏览器另存 PDF）/ JSON 备份与导入
- 天气预报（和风天气免费 API，展示行程日期逐日天气）
- 行前清单（打包/待办 checklist）

## 五、数据模型草案

核心四张表：

```
Trip           id, title, destination, startDate, endDate,
               budgetTotal, notes, createdAt

ItineraryItem  id, tripId, dayIndex, sortOrder,
               type(景点|交通|住宿|餐饮|购物|其他),
               title, startTime?, endTime?,
               placeName?, lng?, lat?, address?,
               estimatedCost?, notes?, aiGenerated

Expense        id, tripId, date, category, title,
               amount, itemId?, notes

Setting        key, value
               // ai.baseUrl / ai.apiKey / ai.model / ai.protocol
               // amap.jsKey / amap.webKey
```

## 六、AI 集成设计（重点）

- 设置页四要素：**Base URL、API Key、模型名、协议类型**。默认按 OpenAI 兼容协议（`/v1/chat/completions`）调用，覆盖绝大多数自定义服务与网关；另留 Anthropic 协议选项
- Key 仅保存在本地 SQLite（`data/` 目录列入 .gitignore），由本地服务端转发请求，前端不接触 Key
- 输出可靠性：System Prompt 内嵌 JSON Schema 与示例；服务端用 zod 校验，不合法自动重试修复
- 长行程（如 10 天以上）可按天分批生成，避免单次输出过长被截断

## 七、项目结构

```
lxgh/
├── prisma/schema.prisma          # 数据模型
├── data/app.db                   # SQLite 数据文件（.gitignore）
├── src/
│   ├── app/
│   │   ├── page.tsx              # 行程列表首页
│   │   ├── trips/[id]/page.tsx   # 行程详情（日程 / 地图 / 预算三视图）
│   │   ├── settings/page.tsx     # 设置页
│   │   └── api/                  # trips / items / expenses / ai / geo / settings
│   ├── components/               # 日程卡片、地图容器、开销表、AI 生成向导…
│   ├── lib/
│   │   ├── db.ts                 # Prisma 客户端
│   │   ├── ai/                   # openai-compat.ts / anthropic.ts / prompt.ts / schema.ts
│   │   └── map/                  # 高德地图加载与封装
│   └── types/
└── package.json                  # npm run dev 一键启动
```

## 八、开发顺序与工作量预估

| 阶段 | 内容 | 预估净开发时间* |
|---|---|---|
| 0 | 脚手架：Next.js + Prisma + AntD 初始化、整体布局、设置页 | 0.5–1 天 |
| 1 | 行程 CRUD + 日程编排（含拖拽） | 1–2 天 |
| 2 | 地图集成（POI 搜索、标注、每日动线） | 1–2 天 |
| 3 | 开销记录与统计图表 | 1 天 |
| 4 | AI 生成（协议客户端、Prompt、JSON 校验、坐标落地、导入） | 1–2 天 |
| 5 | 第三期增强项 | 按需 |

\* 指在 Claude Code 协助下的粗略估计，仅供排期参考。

## 九、风险与注意事项

1. **高德 Key**：需在高德开放平台注册个人开发者（免费）；JS API 与 Web 服务 API 是两种不同的 Key，都要申请；个人免费配额对自用绰绰有余
2. **AI 输出不稳定**是最大不确定点：已设计 Schema 校验 + 自动重试兜底；所配模型能力弱时生成质量下降属预期，换模型即可
3. **数据备份**：定期复制 `data/app.db` 即可；配合 JSON 导出双保险
4. **局域网访问无鉴权**：仅限家庭等可信网络使用

## 十、下一步

按阶段 0 → 4 顺序开发，每阶段结束都有可运行、可试用的版本。
