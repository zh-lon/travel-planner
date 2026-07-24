# 部署指南

把旅行规划工具部署到自己的服务器（Linux VPS / 家用 NAS 均可），并启用访问密码。

## 登录认证说明

- 认证由环境变量 **`AUTH_PASSWORD`** 控制：设置后全站（页面 + API）需要登录，密码正确后发放 30 天有效的 HttpOnly Cookie
- **不设置该变量则完全免登录**（适合本机/可信内网使用），本地开发体验不受影响
- 修改密码：改环境变量并重启服务即可，所有旧登录状态自动失效（Cookie 签名密钥由密码派生）
- 登录接口带失败限速（单 IP 连续错 5 次锁 60 秒）

## 方式一：Docker Compose（推荐）

前置：服务器已安装 Docker（含 compose 插件）。

```bash
git clone https://github.com/zh-lon/travel-planner.git
cd travel-planner
cp .env.example .env
vi .env                      # 把 AUTH_PASSWORD 改成强密码
docker compose up -d --build # 首次构建约几分钟
```

访问 `http://服务器IP:3000`，输入访问密码登录，然后到「设置」页配置 AI 服务与高德 Key。

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
npm ci
npm run build
npx prisma db push
npm i -g pm2
AUTH_PASSWORD=你的强密码 pm2 start npm --name travel-planner -- start
pm2 save && pm2 startup      # 开机自启
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
    }
}
```

```bash
sudo certbot --nginx -d travel.example.com   # 自动配置 HTTPS
```

配好后建议用防火墙/安全组关闭 3000 端口的公网访问，只保留 80/443。

## 注意事项

1. **域名白名单**：公网部署后，建议到高德控制台给「Web端(JS API)」Key 绑定你的域名白名单，防止 Key 被盗用
2. **配额**：高德个人版 POI 搜索约 100 次/天；AI 生成消耗你模型服务的 token——密码保护就是为了防陌生人消耗你的配额
3. **备份**：所有数据（含各类 Key 配置）都在 `data/app.db` 一个文件里，定期备份它即可；应用内也可按行程导出 JSON
4. **备案**：使用国内服务器 + 域名对外提供 Web 服务需要 ICP 备案；仅 IP 访问或使用境外服务器则不需要
