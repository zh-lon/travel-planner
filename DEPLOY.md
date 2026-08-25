# 部署指南

把旅行规划工具部署到自己的服务器（Linux VPS / 家用 NAS 均可）。

## 多用户与登录说明

- **首次访问**会引导创建**管理员账号**（数据库中已有的历史行程会自动归属给它）
- 系统**不开放注册**：其他用户由管理员在「管理」页创建，账号密码线下告知
- 每个用户只能看到自己的行程和别人共享给自己的行程；共享分**只读**和**可编辑**两档
- **两步验证（可选）**：用户可在右上角「安全设置」中用验证器 App 扫码开启 TOTP；验证器丢失时管理员可在「管理」页解除
- 管理员额外拥有：「设置」页（AI/地图/天气 Key，全局共用）、「管理」页（用户与全部行程管理）
- 环境变量 **`AUTH_SECRET`**：会话签名密钥，部署时必须设置为随机长字符串（`openssl rand -hex 32`）；更换它会使所有登录状态失效
- 登录接口带失败限速（单 IP 连续错 5 次锁 60 秒）

## 方式一：Docker Compose（推荐）

前置：服务器已安装 Docker（含 compose 插件）。

```bash
git clone https://github.com/zh-lon/travel-planner.git
cd travel-planner
cp .env.example .env
vi .env                      # 把 AUTH_SECRET 改成随机长字符串
docker compose up -d --build # 首次构建约几分钟
```

访问 `http://服务器IP:3000` → 创建管理员账号 → 「设置」页配置 AI 服务与高德 Key → 「管理」页给亲友创建账号。

常用操作：

```bash
docker compose logs -f                     # 看日志
git pull && docker compose up -d --build   # 更新到最新代码
docker compose down                        # 停止
cp data/app.db backup/app-$(date +%F).db   # 备份数据（所有数据都在 data/app.db）
```

> 数据库挂载在宿主机 `./data` 目录，重建容器数据不丢。
> 海外服务器构建时可换回官方源：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org`

## 方式二：PM2（不使用 Docker）

前置：Node.js 20+。

```bash
git clone https://github.com/zh-lon/travel-planner.git
cd travel-planner
cp .env.example .env && vi .env    # 设置 AUTH_SECRET
npm ci
npm run build
npx prisma db push
npm i -g pm2
pm2 start npm --name travel-planner -- start
pm2 save && pm2 startup            # 开机自启
```

更新：`git pull && npm ci && npm run build && npx prisma db push && pm2 restart travel-planner`

## HTTPS 反向代理（强烈建议公网部署时配置）

用 nginx + certbot 免费证书：

```nginx
server {
    listen 80;
    server_name travel.example.com;   # 换成你的域名
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_buffering off;          # AI 流式输出需要关闭缓冲
        # AI 流式调用为空闲超时（默认 10 分钟无数据才中断），心跳 15 秒保活；Nginx 默认 60 秒会返回 504
        proxy_connect_timeout 30s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

> **重要**：`proxy_read_timeout` 必须设得足够大，否则 AI 生成行程等耗时操作会触发 504 网关超时。流式接口自带 15 秒心跳保活，空闲超时最长 10 分钟，建议 `proxy_read_timeout`/`proxy_send_timeout` 设为 600 秒以上。如果使用 Cloudflare 免费版，其边缘超时为 100 秒，需将 AI 服务尽量选响应快的模型，或升级到 Pro 版（支持 300 秒）。

```bash
sudo certbot --nginx -d travel.example.com   # 自动配置 HTTPS
```

配好后建议用防火墙/安全组关闭 3000 端口的公网访问，只保留 80/443。

## 注意事项

1. **域名白名单**：公网部署后，建议到高德控制台给「Web端(JS API)」Key 绑定你的域名白名单，防止 Key 被盗用
2. **配额**：AI/地图 Key 是全局共用的（管理员在设置页配置），所有用户的 AI 生成都消耗同一份 token、地图搜索共享同一份配额——只给信任的人创建账号
3. **备份**：所有数据（用户、行程、Key 配置）都在 `data/app.db` 一个文件里，定期备份它即可；应用内也可按行程导出 JSON
4. **备案**：使用国内服务器 + 域名对外提供 Web 服务需要 ICP 备案；仅 IP 访问或使用境外服务器则不需要
