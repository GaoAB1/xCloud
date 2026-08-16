'use strict';

/**
 * xCloud · 个人云盘 + 应用面板
 * - 零/极少依赖 Node 后端（busboy 用于 multipart 上传）
 * - 首次启动引导创建管理员账户；scrypt 密码哈希 + 会话 Cookie
 * - 应用管理（内网/外网双地址）、头像上传、Open-Meteo 天气代理
 * - 网盘文件系统（浏览/上传/下载/建夹/重命名/移动/删除）
 * - OnlyOffice 在线编辑（JWT 签名 + callback 保存）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
let Busboy = null;
try { Busboy = require('busboy'); } catch { /* multipart 上传将不可用 */ }

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILES_DIR = path.join(DATA_DIR, 'files'); // 网盘根目录

// OnlyOffice / 部署配置
const ONLYOFFICE_URL = (process.env.ONLYOFFICE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const ONLYOFFICE_INTERNAL_URL = (process.env.ONLYOFFICE_INTERNAL_URL || '').replace(/\/+$/, '');
const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/+$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'xcloud-change-me-please';

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const APPS_FILE = path.join(DATA_DIR, 'apps.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const MAX_BODY = 8 * 1024 * 1024; // JSON 请求体上限（头像/回调等）
const MAX_UPLOAD = 10 * 1024 * 1024 * 1024; // 单文件上传上限 10GB
const WEATHER_CACHE_MS = 10 * 60 * 1000;

// ── 目录与数据初始化 ─────────────────────────────────────────────
for (const d of [DATA_DIR, UPLOAD_DIR, FILES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

let users = readJSON(USERS_FILE, { users: [] });
let apps = readJSON(APPS_FILE, { apps: [] });
let settings = Object.assign(
  { location: '北京', lat: 39.9042, lon: 116.4074, weatherUnit: 'c' },
  readJSON(SETTINGS_FILE, {})
);

// 会话：内存 Map + 落盘，重启不丢登录
const sessions = new Map();
(function loadSessions() {
  const data = readJSON(SESSIONS_FILE, { sessions: [] });
  const now = Date.now();
  for (const s of data.sessions || []) {
    if (s && s.token && s.expiresAt > now) sessions.set(s.token, s);
  }
})();
function persistSessions() {
  writeJSON(SESSIONS_FILE, { sessions: Array.from(sessions.values()) });
}

// ── 密码与安全工具 ────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}
function uid() { return crypto.randomBytes(8).toString('hex'); }
function token() { return crypto.randomBytes(32).toString('hex'); }

// ── 会话管理 ──────────────────────────────────────────────────────
function createSession(userId) {
  const t = token();
  sessions.set(t, { token: t, userId, expiresAt: Date.now() + SESSION_TTL_MS });
  persistSessions();
  return t;
}
function getSession(req) {
  const cookie = parseCookies(req.headers.cookie || '');
  const t = cookie.sid;
  if (!t) return null;
  const s = sessions.get(t);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(t); persistSessions(); return null; }
  const user = users.users.find((u) => u.id === s.userId) || null;
  return user ? { user, token: t } : null;
}
function destroySession(req) {
  const cookie = parseCookies(req.headers.cookie || '');
  if (cookie.sid && sessions.has(cookie.sid)) { sessions.delete(cookie.sid); persistSessions(); }
}
function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ── 响应工具 ──────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function sendError(res, status, message) { sendJSON(res, status, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── 天气（Open-Meteo，服务端代理 + 缓存）──────────────────────────
const weatherCache = { data: null, key: '', at: 0 };
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'xCloud/1.0' } });
    if (!res.ok) throw new Error('upstream ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
async function geocode(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
  const data = await fetchWithTimeout(url);
  const r = data && data.results && data.results[0];
  if (!r) return null;
  return { location: r.name || city, lat: r.latitude, lon: r.longitude, country: r.country };
}
async function getWeather() {
  const key = `${settings.lat},${settings.lon},${settings.weatherUnit}`;
  if (weatherCache.data && weatherCache.key === key && Date.now() - weatherCache.at < WEATHER_CACHE_MS) return weatherCache.data;
  const units = settings.weatherUnit === 'f' ? 'fahrenheit' : 'celsius';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}&longitude=${settings.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6` +
    `&temperature_unit=${units}&wind_speed_unit=kmh`;
  const data = await fetchWithTimeout(url);
  const result = { location: settings.location, unit: settings.weatherUnit, current: data.current, daily: data.daily };
  weatherCache.data = result; weatherCache.key = key; weatherCache.at = Date.now();
  return result;
}

// ── 头像/图标上传（dataURL → 文件）───────────────────────────────
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
function saveDataURL(dataUrl, prefix) {
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { error: '无效的图片数据' };
  const mime = m[1];
  const ext = MIME_EXT[mime];
  if (!ext) return { error: '不支持的图片格式' };
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return { error: '图片解码失败' }; }
  if (buf.length > 3 * 1024 * 1024) return { error: '图片过大（≤3MB）' };
  const name = `${prefix}-${Date.now()}-${uid()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { name };
}
function deleteUpload(name) {
  if (!name || typeof name !== 'string') return;
  const p = path.join(UPLOAD_DIR, path.basename(name));
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* 忽略 */ }
}

// ── 认证守卫 ──────────────────────────────────────────────────────
function requireAuth(req, res) {
  const s = getSession(req);
  if (!s) { sendError(res, 401, '未登录'); return null; }
  return s;
}
const failedLogins = new Map();
function loginDelay(key) { return Math.min((failedLogins.get(key) || 0) * 400, 2000); }

// ════════════════════════════════════════════════════════════════
//  网盘文件系统
// ════════════════════════════════════════════════════════════════
const FILE_MIME = {
  'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
  'svg': 'image/svg+xml', 'bmp': 'image/bmp', 'ico': 'image/x-icon',
  'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'webm': 'video/webm',
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac', 'aac': 'audio/aac', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4',
  'zip': 'application/zip', 'rar': 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
  'tar': 'application/x-tar', 'gz': 'application/gzip',
  'js': 'application/javascript', 'css': 'text/css', 'html': 'text/html', 'json': 'application/json', 'xml': 'application/xml',
  'apk': 'application/vnd.android.package-archive', 'exe': 'application/x-msdownload', 'iso': 'application/x-iso9660-image',
};
// 可被 OnlyOffice 编辑的扩展名 → 文档类型
const EDITABLE = {
  'docx': 'word', 'doc': 'word', 'odt': 'word', 'rtf': 'word', 'txt': 'word',
  'xlsx': 'cell', 'xls': 'cell', 'ods': 'cell', 'csv': 'cell',
  'pptx': 'slide', 'ppt': 'slide', 'odp': 'slide',
};

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > -1 ? name.slice(i + 1).toLowerCase() : '';
}
function mimeOf(name) {
  return FILE_MIME[extOf(name)] || 'application/octet-stream';
}

// 解析相对路径并防止路径穿越，返回磁盘绝对路径；越界返回 null
function resolveFilePath(rel) {
  const base = path.resolve(FILES_DIR);
  const p = path.resolve(base, '.' + path.normalize('/' + String(rel || '').replace(/\\/g, '/')));
  const rel2 = path.relative(base, p);
  if (rel2 === '') return base;
  if (rel2.startsWith('..') || path.isAbsolute(rel2)) return null;
  return p;
}
function uniqueFilePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  let i = 1;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}
function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function listDir(rel) {
  const dir = resolveFilePath(rel);
  if (!dir) return { error: '路径无效' };
  if (!fs.existsSync(dir)) return { error: '目录不存在' };
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return { error: '不是目录' };
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let s;
    try { s = fs.statSync(full); } catch { continue; }
    const isDir = s.isDirectory();
    items.push({
      name,
      type: isDir ? 'dir' : 'file',
      size: isDir ? 0 : s.size,
      sizeText: isDir ? '—' : formatSize(s.size),
      mtime: s.mtimeMs,
      ext: isDir ? '' : extOf(name),
      editable: isDir ? false : !!EDITABLE[extOf(name)],
      documentType: EDITABLE[extOf(name)] || null,
    });
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1));
  const parent = parentPath(rel);
  return { path: rel || '/', parent, items };
}

function parentPath(rel) {
  const clean = ('/' + String(rel || '').replace(/\\/g, '/')).replace(/\/+/g, '/');
  if (clean === '' || clean === '/') return '';
  const idx = clean.lastIndexOf('/');
  return idx <= 0 ? '/' : clean.slice(0, idx);
}

// multipart 上传（busboy）
function handleUpload(req) {
  return new Promise((resolve) => {
    if (!Busboy) return resolve({ error: '服务器未安装 busboy，无法上传' });
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD } });
    let targetDir = '';
    let finalPath = null;
    let error = null;
    let settled = false;
    let sawFile = false;

    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    bb.on('field', (name, val) => { if (name === 'path') targetDir = String(val || ''); });

    bb.on('file', (name, file, info) => {
      sawFile = true;
      const dir = resolveFilePath(targetDir);
      const fname = path.basename(String(info.filename || ''));
      if (!dir || !fname) { file.resume(); error = '路径无效或文件名为空'; return; }
      finalPath = uniqueFilePath(path.join(dir, fname));
      const ws = fs.createWriteStream(finalPath);
      ws.on('error', () => { error = '写入失败'; done({ error }); });
      ws.on('finish', () => {
        let size = 0; try { size = fs.statSync(finalPath).size; } catch { /* ignore */ }
        done({ name: path.basename(finalPath), size });
      });
      file.on('error', () => { error = '上传中断'; });
      file.pipe(ws);
    });

    bb.on('error', () => { error = error || '上传失败'; done({ error }); });

    bb.on('close', () => {
      if (!sawFile || !finalPath) {
        if (finalPath) { try { fs.unlinkSync(finalPath); } catch { /* ignore */ } }
        done({ error: error || '未收到文件' });
      } else if (!settled) {
        // 罕见：ws.finish 尚未触发，稍后读文件大小兜底
        setTimeout(() => {
          if (!settled) {
            try { done({ name: path.basename(finalPath), size: fs.statSync(finalPath).size }); }
            catch { done({ error: '上传失败' }); }
          }
        }, 100);
      }
    });

    req.pipe(bb);
  });
}

// ── JWT（HMAC-SHA256，OnlyOffice 签名）──────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signJWT(payload) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${sig}`;
}
function verifyJWT(t) {
  if (!t || typeof t !== 'string') return null;
  const parts = t.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (expected !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function panelBaseUrl(req) {
  if (PANEL_URL) return PANEL_URL;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// 从 OnlyOffice 下载已保存的文档（回调 url）
async function downloadFromOnlyOffice(url) {
  let target = url;
  if (ONLYOFFICE_INTERNAL_URL) {
    try {
      const u = new URL(url);
      const internal = new URL(ONLYOFFICE_INTERNAL_URL);
      if (u.host !== internal.host) { u.protocol = internal.protocol; u.host = internal.host; target = u.toString(); }
    } catch { /* keep original */ }
  }
  const res = await fetch(target, { headers: { 'User-Agent': 'xCloud/1.0' } });
  if (!res.ok) throw new Error('download ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// ── 文件相关路由（公开区：raw / callback 用 token 校验）──────────
function handleRaw(req, res, url) {
  const rel = url.searchParams.get('path') || '';
  const payload = verifyJWT(url.searchParams.get('token'));
  if (!payload || payload.path !== rel) return sendError(res, 401, 'token 无效');
  const full = resolveFilePath(rel);
  if (!full || !fs.existsSync(full)) return sendError(res, 404, '文件不存在');
  const st = fs.statSync(full);
  if (st.isDirectory()) return sendError(res, 400, '是目录');
  const name = path.basename(full);
  res.writeHead(200, {
    'Content-Type': mimeOf(name),
    'Content-Length': st.size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  fs.createReadStream(full).pipe(res);
}

async function handleCallback(req, res, url) {
  const rel = url.searchParams.get('path') || '';
  const payload = verifyJWT(url.searchParams.get('token'));
  if (!payload || payload.path !== rel) return sendError(res, 401, 'token 无效');
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { body = {}; }
  if (body.status === 2 || body.status === 6) {
    const full = resolveFilePath(rel);
    if (full && body.url) {
      try {
        const data = await downloadFromOnlyOffice(body.url);
        fs.writeFileSync(full, data);
        console.log('[onlyoffice] 已保存:', rel);
      } catch (e) {
        console.error('[onlyoffice] 保存失败:', e.message);
        return sendJSON(res, 200, { error: 1, message: 'save failed' });
      }
    }
  }
  return sendJSON(res, 200, { error: 0 });
}

// ── API 路由处理 ──────────────────────────────────────────────────
async function handleAPI(req, res, pathname, url) {
  // 认证状态（公开）
  if (pathname === '/api/status' && req.method === 'GET') {
    const s = getSession(req);
    return sendJSON(res, 200, {
      initialized: users.users.length > 0,
      authenticated: !!s,
      onlyoffice: !!ONLYOFFICE_URL,
      user: s ? { id: s.user.id, username: s.user.username, name: s.user.name, avatar: s.user.avatar } : null,
    });
  }

  // 首次设置管理员
  if (pathname === '/api/setup' && req.method === 'POST') {
    if (users.users.length > 0) return sendError(res, 409, '系统已完成初始化');
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const username = String(body.username || '').trim();
    const name = String(body.name || '').trim() || username;
    const password = String(body.password || '');
    if (!/^[a-zA-Z0-9_.@-]{2,32}$/.test(username)) return sendError(res, 400, '用户名需为 2–32 位字母/数字/下划线');
    if (password.length < 6) return sendError(res, 400, '密码至少 6 位');
    const user = { id: uid(), username, name, avatar: '', passwordHash: hashPassword(password), createdAt: Date.now() };
    users.users.push(user);
    writeJSON(USERS_FILE, users);
    const t = createSession(user.id);
    setCookie(res, t);
    return sendJSON(res, 200, publicUser(user));
  }

  // 登录
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const key = username.toLowerCase();
    await sleep(loginDelay(key));
    const user = users.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      failedLogins.set(key, (failedLogins.get(key) || 0) + 1);
      return sendError(res, 401, '用户名或密码错误');
    }
    failedLogins.delete(key);
    const t = createSession(user.id);
    setCookie(res, t);
    return sendJSON(res, 200, publicUser(user));
  }

  // 退出登录
  if (pathname === '/api/logout' && req.method === 'POST') {
    destroySession(req);
    setCookie(res, '', 0);
    return sendJSON(res, 200, { ok: true });
  }

  // OnlyOffice 公开接口（token 校验）
  if (pathname === '/api/files/raw' && req.method === 'GET') return handleRaw(req, res, url);
  if (pathname === '/api/onlyoffice/callback' && req.method === 'POST') return handleCallback(req, res, url);

  // ── 以下均需登录 ──
  const s = requireAuth(req, res);
  if (!s) return;
  const me = s.user;

  // 修改资料（名称 / 头像）
  if (pathname === '/api/profile' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const stored = users.users.find((u) => u.id === me.id);
    if (body.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 32) return sendError(res, 400, '名称需为 1–32 个字符');
      stored.name = name;
    }
    if (body.avatar !== undefined) {
      if (body.avatar === null || body.avatar === '') { deleteUpload(stored.avatar); stored.avatar = ''; }
      else {
        const r = saveDataURL(body.avatar, 'avatar');
        if (r.error) return sendError(res, 400, r.error);
        deleteUpload(stored.avatar);
        stored.avatar = r.name;
      }
    }
    writeJSON(USERS_FILE, users);
    return sendJSON(res, 200, publicUser(stored));
  }

  // 修改密码
  if (pathname === '/api/password' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const stored = users.users.find((u) => u.id === me.id);
    const cur = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (!verifyPassword(cur, stored.passwordHash)) return sendError(res, 400, '当前密码不正确');
    if (next.length < 6) return sendError(res, 400, '新密码至少 6 位');
    stored.passwordHash = hashPassword(next);
    writeJSON(USERS_FILE, users);
    for (const [tk, sess] of sessions) { if (sess.userId === me.id && tk !== s.token) sessions.delete(tk); }
    persistSessions();
    return sendJSON(res, 200, { ok: true });
  }

  // 应用列表
  if (pathname === '/api/apps' && req.method === 'GET') {
    return sendJSON(res, 200, { apps: apps.apps.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)) });
  }
  if (pathname === '/api/apps' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const app = validateApp(body);
    if (app.error) return sendError(res, 400, app.error);
    const next = {
      id: uid(), name: app.name, url_internal: app.url_internal, url_external: app.url_external,
      icon_type: app.icon_type, icon_value: app.icon_value, color: app.color, sort: apps.apps.length,
    };
    apps.apps.push(next);
    writeJSON(APPS_FILE, apps);
    return sendJSON(res, 200, next);
  }
  const appMatch = pathname.match(/^\/api\/apps\/([a-f0-9]+)$/);
  if (appMatch && req.method === 'PUT') {
    const id = appMatch[1];
    const idx = apps.apps.findIndex((a) => a.id === id);
    if (idx === -1) return sendError(res, 404, '应用不存在');
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const app = validateApp(body);
    if (app.error) return sendError(res, 400, app.error);
    const old = apps.apps[idx];
    apps.apps[idx] = Object.assign({}, old, {
      name: app.name, url_internal: app.url_internal, url_external: app.url_external,
      icon_type: app.icon_type, icon_value: app.icon_value, color: app.color,
    });
    if (old.icon_type === 'image' && old.icon_value && old.icon_value !== apps.apps[idx].icon_value) deleteUpload(old.icon_value);
    writeJSON(APPS_FILE, apps);
    return sendJSON(res, 200, apps.apps[idx]);
  }
  if (appMatch && req.method === 'DELETE') {
    const id = appMatch[1];
    const idx = apps.apps.findIndex((a) => a.id === id);
    if (idx === -1) return sendError(res, 404, '应用不存在');
    const [removed] = apps.apps.splice(idx, 1);
    if (removed.icon_type === 'image') deleteUpload(removed.icon_value);
    writeJSON(APPS_FILE, apps);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/apps/order' && req.method === 'PUT') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const map = new Map(apps.apps.map((a) => [a.id, a]));
    ids.forEach((id, i) => { if (map.has(id)) map.get(id).sort = i; });
    writeJSON(APPS_FILE, apps);
    return sendJSON(res, 200, { ok: true });
  }

  // 设置（位置 / 天气单位）
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJSON(res, 200, { location: settings.location, weatherUnit: settings.weatherUnit });
  }
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (body.weatherUnit && !['c', 'f'].includes(body.weatherUnit)) return sendError(res, 400, '温度单位无效');
    if (body.weatherUnit) settings.weatherUnit = body.weatherUnit;
    if (body.location !== undefined) {
      const loc = String(body.location || '').trim();
      if (!loc) return sendError(res, 400, '位置不能为空');
      if (typeof body.lat === 'number' && typeof body.lon === 'number') {
        settings.location = loc; settings.lat = body.lat; settings.lon = body.lon;
      } else if (loc !== settings.location) {
        const geo = await geocode(loc);
        if (!geo) return sendError(res, 400, '未找到该位置，请尝试城市名');
        settings.location = geo.location; settings.lat = geo.lat; settings.lon = geo.lon;
      }
      weatherCache.at = 0;
    }
    writeJSON(SETTINGS_FILE, settings);
    return sendJSON(res, 200, { location: settings.location, weatherUnit: settings.weatherUnit });
  }

  // 天气
  if (pathname === '/api/weather' && req.method === 'GET') {
    try { return sendJSON(res, 200, await getWeather()); }
    catch { return sendError(res, 502, '天气服务暂时不可用'); }
  }

  // ═══ 网盘文件 API ═══
  if (pathname === '/api/files' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    const r = listDir(rel);
    if (r.error) return sendError(res, 400, r.error);
    return sendJSON(res, 200, r);
  }
  if (pathname === '/api/files/upload' && req.method === 'POST') {
    const r = await handleUpload(req);
    if (r.error) return sendError(res, 400, r.error);
    return sendJSON(res, 200, r);
  }
  if (pathname === '/api/files/download' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    const full = resolveFilePath(rel);
    if (!full || !fs.existsSync(full)) return sendError(res, 404, '文件不存在');
    const st = fs.statSync(full);
    if (st.isDirectory()) return sendError(res, 400, '是目录');
    const name = path.basename(full);
    res.writeHead(200, {
      'Content-Type': mimeOf(name),
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    return fs.createReadStream(full).pipe(res);
  }
  if (pathname === '/api/files/mkdir' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const parent = resolveFilePath(body.path || '');
    const name = String(body.name || '').trim();
    if (!parent || !fs.existsSync(parent)) return sendError(res, 400, '目录不存在');
    if (!name || /[\\/]/.test(name)) return sendError(res, 400, '名称无效');
    const target = path.join(parent, name);
    if (fs.existsSync(target)) return sendError(res, 409, '已存在同名文件夹');
    fs.mkdirSync(target);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/files/rename' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const full = resolveFilePath(body.path || '');
    const name = String(body.name || '').trim();
    if (!full || full === resolveFilePath('/') || !fs.existsSync(full)) return sendError(res, 400, '目标不存在');
    if (!name || /[\\/]/.test(name)) return sendError(res, 400, '名称无效');
    const target = path.join(path.dirname(full), name);
    if (target === full) return sendJSON(res, 200, { ok: true });
    if (fs.existsSync(target)) return sendError(res, 409, '已存在同名文件');
    fs.renameSync(full, target);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/files/move' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const from = resolveFilePath(body.from || '');
    const toDir = resolveFilePath(body.to || '');
    if (!from || !toDir || !fs.existsSync(from)) return sendError(res, 400, '路径无效');
    if (!fs.existsSync(toDir) || !fs.statSync(toDir).isDirectory()) return sendError(res, 400, '目标目录无效');
    if (path.dirname(from) === toDir) return sendJSON(res, 200, { ok: true });
    let target = path.join(toDir, path.basename(from));
    if (target === from) return sendJSON(res, 200, { ok: true });
    if (fs.existsSync(target)) target = uniqueFilePath(target);
    fs.renameSync(from, target);
    return sendJSON(res, 200, { ok: true });
  }
  if (pathname === '/api/files/delete' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const full = resolveFilePath(body.path || '');
    if (!full || full === resolveFilePath('/') || !fs.existsSync(full)) return sendError(res, 400, '目标不存在');
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {
      // 某些环境（如带回收站 shim）删除可能抛错，若文件已不存在则视为成功
      if (fs.existsSync(full)) return sendError(res, 500, '删除失败');
    }
    return sendJSON(res, 200, { ok: true });
  }

  // ═══ OnlyOffice config ═══
  if (pathname === '/api/onlyoffice/config' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const rel = String(body.path || '');
    const full = resolveFilePath(rel);
    if (!full || !fs.existsSync(full)) return sendError(res, 404, '文件不存在');
    const st = fs.statSync(full);
    const name = path.basename(full);
    const ext = extOf(name);
    const docType = EDITABLE[ext];
    if (!docType) return sendError(res, 400, '该文件类型不支持在线编辑');
    const base = panelBaseUrl(req);
    const key = crypto.createHash('md5').update(rel + ':' + st.mtimeMs).digest('hex');
    const rawToken = signJWT({ path: rel, exp: Date.now() + 3600 * 1000 });
    const cbToken = signJWT({ path: rel, exp: Date.now() + 24 * 3600 * 1000 });
    const config = {
      documentType: docType,
      document: {
        fileType: ext,
        key,
        title: name,
        url: `${base}/api/files/raw?path=${encodeURIComponent(rel)}&token=${rawToken}`,
      },
      editorConfig: {
        lang: 'zh-CN',
        mode: 'edit',
        callbackUrl: `${base}/api/onlyoffice/callback?path=${encodeURIComponent(rel)}&token=${cbToken}`,
        user: { id: me.id, name: me.name || me.username },
        customization: { autosave: true, compactHeader: true, forcesave: false },
      },
    };
    config.token = signJWT(config);
    return sendJSON(res, 200, { onlyofficeUrl: ONLYOFFICE_URL, config });
  }

  return sendError(res, 404, '接口不存在');
}

function validateApp(body) {
  const name = String(body.name || '').trim();
  if (!name || name.length > 32) return { error: '名称需为 1–32 个字符' };
  const url_internal = cleanURL(body.url_internal);
  const url_external = cleanURL(body.url_external);
  if (!url_internal && !url_external) return { error: '请至少填写一个地址' };
  let icon_type = ['letter', 'emoji', 'image', 'url'].includes(body.icon_type) ? body.icon_type : 'letter';
  let icon_value = String(body.icon_value || '');
  if (icon_type === 'emoji') { icon_value = icon_value.trim(); if (!icon_value) icon_type = 'letter'; }
  if (icon_type === 'image') {
    if (/^data:image\//.test(icon_value)) {
      const r = saveDataURL(icon_value, 'icon');
      if (r.error) return { error: r.error };
      icon_value = r.name;
    } else if (!icon_value || /^https?:\/\//i.test(icon_value)) { icon_type = 'letter'; icon_value = ''; }
  }
  if (icon_type === 'url') { icon_value = cleanURL(icon_value); if (!icon_value) return { error: '图标 URL 无效' }; }
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#0071e3';
  return { name, url_internal, url_external, icon_type, icon_value, color };
}
function cleanURL(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}
function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, avatar: u.avatar };
}
function setCookie(res, value, maxAge = SESSION_TTL_MS / 1000) {
  const attrs = [`sid=${value || ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', maxAge ? `Max-Age=${maxAge}` : 'Max-Age=0'];
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── 静态文件服务 ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname.startsWith('/uploads/')) {
    filePath = path.join(UPLOAD_DIR, path.basename(pathname));
  } else {
    if (pathname === '/' || pathname === '/index.html') {
      // IE 兼容：Trident/MSIE 内核自动切换精简页
      const ua = req.headers['user-agent'] || '';
      const isIE = /Trident|MSIE/i.test(ua) && !/Edge\//i.test(ua);
      pathname = isIE ? '/classic.html' : '/index.html';
    }
    filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  }
  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(UPLOAD_DIR)) return sendError(res, 403, '禁止访问');
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, '未找到');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  });
}

// ── 服务器 ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/api/')) await handleAPI(req, res, pathname, url);
    else serveStatic(req, res, pathname);
  } catch (e) {
    if (e && e.message === '请求体过大') return sendError(res, 413, '请求体过大');
    if (e instanceof SyntaxError) return sendError(res, 400, '请求格式错误');
    console.error('[error]', e);
    if (!res.headersSent) sendError(res, 500, '服务器内部错误');
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log('\n  ┌──────────────────────────────────────────┐');
  console.log('  │            xCloud · 个人云盘面板          │');
  console.log('  └──────────────────────────────────────────┘');
  console.log('');
  console.log(`  本机访问:  http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const info of nets[name] || []) {
      if (info && info.family === 'IPv4' && !info.internal) console.log(`  局域网访问: http://${info.address}:${PORT}`);
    }
  }
  console.log('');
  if (users.users.length === 0) console.log('  首次运行：请在浏览器打开后创建管理员账户。');
  else console.log(`  已配置账户：${users.users[0].username}`);
  if (ONLYOFFICE_URL) console.log(`  OnlyOffice: ${ONLYOFFICE_URL}`);
  console.log('');
});
