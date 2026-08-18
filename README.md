# xCloud · 个人云盘 + 应用面板

苹果风简约设计的个人云盘与 NAS 服务聚合面板。一个页面内流转：**主页（时钟/天气/应用）↔ 文件（网盘）**，并内置 OnlyOffice 在线编辑 Word/PPT/Excel。

## 功能

- **主页**：实时时钟 + 天气（Open-Meteo 免 Key）+ 自定义应用图标（内网/外网双地址一键切换）。
- **网盘**：文件浏览（面包屑导航）、上传（含拖拽）、下载、新建文件夹、重命名、删除；iCloud 网页端风格。
- **在线编辑**：集成 OnlyOffice Document Server，可直接编辑并回存 Word / PPT / Excel。
- **登录保护**：首次启动引导创建管理员账户，scrypt 哈希 + HttpOnly 会话；可改头像/名称/密码。
- **IE 兼容**：自动识别 IE 内核（Trident/MSIE），切换到精简版网盘页，支持登录 / 浏览 / 上传 / 下载（ES5 + 传统表单，无需现代浏览器）。
- **Docker 部署**：一条 `docker compose up` 启动面板 + OnlyOffice 双服务。

## 目录结构

```
├── server.js              # 后端（认证/应用/天气/网盘文件系统/OnlyOffice 集成）
├── package.json           # 依赖：busboy（multipart 上传）
├── Dockerfile             # 面板镜像
├── docker-compose.yml     # 面板 + OnlyOffice 双服务
├── deploy/                # 部署辅助（Nginx 反代性能优化配置等）
├── .github/workflows/     # 自动构建镜像推送到 GHCR
├── public/
│   ├── index.html         # 现代单页应用（主页 + 文件）
│   ├── styles.css         # 苹果「液态玻璃」样式
│   ├── app.js             # 前端逻辑
│   ├── edit.html / edit.js  # OnlyOffice 在线编辑器页
│   └── classic.html / classic.js / classic.css  # IE 兼容精简页
└── data/                  # 运行时数据（用户/应用/会话 + 网盘文件 files/）
```

## 快速开始（本地）

```bash
npm install
node server.js
```

打开 `http://localhost:3000`，首次运行创建管理员账户。

> 本地没有 OnlyOffice 时，网盘照常可用；点击可编辑文件会提示「未配置 OnlyOffice」。

## Docker 部署（推荐，含 OnlyOffice）

```bash
# 1. 修改 docker-compose.yml 里的 ONLYOFFICE_URL 为你的服务器 IP / 域名
#    （例如 http://192.168.1.10:8080），并修改 JWT_SECRET 为随机长字符串

# 2. 一键启动
docker compose up -d

# 3. 首次启动会自动拉取 onlyoffice/documentserver 镜像（约 2-4GB，请耐心等待）
```

启动后：

- 面板：`http://服务器IP:3000`
- OnlyOffice：`http://服务器IP:8080`

首次运行 OnlyOffice 需要约 1-2 分钟初始化，期间在线编辑可能不可用，稍后再试即可。

### 关键环境变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `PORT` | 面板端口 | `3000` |
| `ONLYOFFICE_URL` | **浏览器**访问 OnlyOffice 的地址 | `http://192.168.1.10:8080` |
| `ONLYOFFICE_INTERNAL_URL` | **面板(容器)**访问 OnlyOffice 的地址 | `http://onlyoffice` |
| `PANEL_URL` | **OnlyOffice(容器)**访问面板的地址（下载/回调） | `http://xcloud:3000` |
| `JWT_SECRET` | 保护文档下载与保存回调的密钥，务必修改 | 随机长字符串 |
| `ONLYOFFICE_MEM_LIMIT` | OnlyOffice 容器内存上限（4G 机器建议 `2560m`） | `2560m` |
| `JAVA_OPTS` | OnlyOffice JVM 堆参数（小内存机器调低） | `-Xms512m -Xmx1024m` |

## 性能优化（加载慢时）

服务器负载不高但打开文档慢，瓶颈通常不在 CPU/内存，而是**前端静态资源传输**。OnlyOffice 编辑器首次加载需下载几十 MB 的 JS/CSS，以下优化可显著提速：

1. **Nginx 反代开启 gzip + 静态缓存（收益最大，减少 70-80% 传输量）**
   项目提供现成配置：`deploy/nginx-onlyoffice.conf`，包含 gzip 压缩、版本化资源 30 天长缓存（二次打开秒开）、HTTP/2、WebSocket 转发。将其中 `server_name` 改为你的域名后放入 `/etc/nginx/conf.d/` 并 `nginx -s reload`。

2. **前端并行预加载（已内置）**
   面板在编辑页 HTML 中注入 OnlyOffice 地址，页面加载时立即并行预下载 `api.js` 并建立 `preconnect`，不再等待 config 接口返回后才开始下载，减少 1-2 个网络往返。

3. **限制容器内存防 swap 抖动（已内置）**
   `docker-compose.yml` 已为 onlyoffice 服务添加 `mem_limit`（默认 2.5G，可用 `ONLYOFFICE_MEM_LIMIT` 覆盖）和 `JAVA_OPTS`（默认堆上限 1G），避免 4G 内存机器上内存溢出触发 swap 导致卡顿。

4. **检查网络链路**
   - 公网访问带宽较小（如家宽上行 10-30Mbps）时，gzip 压缩收益尤其明显。
   - 确认浏览器 DevTools → Network 中 `web-apps` 资源返回 `Content-Encoding: gzip` 且命中缓存（`200 (from disk cache)`）。

### 直接使用镜像（GitHub Actions 已构建到 GHCR）

```bash
docker run -d --name xcloud \
  -p 3000:3000 \
  -v /你的路径/data:/app/data \
  -e ONLYOFFICE_URL=http://192.168.1.10:8080 \
  -e PANEL_URL=http://192.168.1.10:3000 \
  ghcr.io/gaoab1/xcloud:latest
```

## 安全建议

- 对外访问务必通过反向代理（Nginx/Caddy/Traefik）配 **HTTPS**。
- 网盘里的「内网地址」等属于隐私信息，登录保护可防止未授权访问。
- `JWT_SECRET` 生产环境务必改为随机长字符串。

## 说明

- 天气数据由 [Open-Meteo](https://open-meteo.com) 免费提供，服务端代理并缓存 10 分钟。
- 重置：停止服务后删除 `data/` 目录，重新启动即可再次引导。
- 不要删除项目根目录的 `.workbuddy` 文件夹（工作区自身数据，与运行数据无关）。
