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
