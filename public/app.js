'use strict';

/* ════════════════════════════════════════════════════════════════
   个人管理面板 · 前端逻辑
   ════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentUser = null;
let currentApps = [];
let networkMode = localStorage.getItem('panel_network') || 'internal';
let editingAppId = null;
let appImageDataURL = null; // 应用图标新上传的 dataURL
let weatherUnit = 'c';

const PALETTE = ['#0071e3', '#5e5ce6', '#0a84ff', '#30d158', '#34c759', '#ff9500', '#ff3b30', '#ff2d55', '#af52de', '#5856d6', '#64d2ff', '#a2845e'];

/* ── 基础工具 ──────────────────────────────────────────────────── */
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/api/status') {
    showView('login');
    throw new Error('未登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function showView(name) {
  $('#view-setup').hidden = name !== 'setup';
  $('#view-login').hidden = name !== 'login';
  const authed = name === 'home' || name === 'files' || name === 'mail';
  $('#navbar').hidden = !authed;
  $('#view-dashboard').hidden = name !== 'home';
  $('#view-files').hidden = name !== 'files';
  $('#view-mail').hidden = name !== 'mail';
}

function setSegActive(seg, activeBtn) {
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === activeBtn));
}

/* ── 头像渲染 ──────────────────────────────────────────────────── */
function avatarHTML(user, cls = 'avatar') {
  if (user && user.avatar) {
    return `<span class="${cls}"><img src="/uploads/${escapeHTML(user.avatar)}" alt=""></span>`;
  }
  const letter = (user && (user.name || user.username || '?'))[0] || '?';
  return `<span class="${cls}">${escapeHTML(letter.toUpperCase())}</span>`;
}

function renderAvatars() {
  $('#nav-avatar').innerHTML = currentUser && currentUser.avatar
    ? `<img src="/uploads/${escapeHTML(currentUser.avatar)}" alt="">`
    : escapeHTML(((currentUser && currentUser.name) || '?')[0].toUpperCase());
  $('#profile-avatar').innerHTML = currentUser && currentUser.avatar
    ? `<img src="/uploads/${escapeHTML(currentUser.avatar)}" alt="">`
    : escapeHTML(((currentUser && currentUser.name) || '?')[0].toUpperCase());
}

/* ── 时钟 ──────────────────────────────────────────────────────── */
function startClock() {
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const update = () => {
    const now = new Date();
    $('#clock-time').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('#clock-seconds').textContent = `:${String(now.getSeconds()).padStart(2, '0')}`;
    $('#clock-date').textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${week[now.getDay()]}`;
  };
  update();
  setInterval(update, 1000);
}

/* ── 天气 ──────────────────────────────────────────────────────── */
const WMO = {
  0: { l: '晴', e: '☀️' }, 1: { l: '大部晴朗', e: '🌤️' }, 2: { l: '多云', e: '⛅' }, 3: { l: '阴', e: '☁️' },
  45: { l: '雾', e: '🌫️' }, 48: { l: '雾凇', e: '🌫️' },
  51: { l: '毛毛雨', e: '🌦️' }, 53: { l: '毛毛雨', e: '🌦️' }, 55: { l: '毛毛雨', e: '🌦️' },
  56: { l: '冻毛毛雨', e: '🌧️' }, 57: { l: '冻毛毛雨', e: '🌧️' },
  61: { l: '小雨', e: '🌧️' }, 63: { l: '中雨', e: '🌧️' }, 65: { l: '大雨', e: '🌧️' },
  66: { l: '冻雨', e: '🌧️' }, 67: { l: '冻雨', e: '🌧️' },
  71: { l: '小雪', e: '🌨️' }, 73: { l: '中雪', e: '🌨️' }, 75: { l: '大雪', e: '❄️' }, 77: { l: '雪粒', e: '❄️' },
  80: { l: '阵雨', e: '🌦️' }, 81: { l: '阵雨', e: '🌦️' }, 82: { l: '强阵雨', e: '🌧️' },
  85: { l: '阵雪', e: '🌨️' }, 86: { l: '阵雪', e: '🌨️' },
  95: { l: '雷暴', e: '⛈️' }, 96: { l: '雷暴伴冰雹', e: '⛈️' }, 99: { l: '雷暴伴冰雹', e: '⛈️' },
};
function weatherInfo(code, isDay) {
  const w = WMO[code] || { l: '未知', e: '🌡️' };
  if (isDay === 0 && (code === 0 || code === 1)) w.e = code === 0 ? '🌙' : '☁️';
  return w;
}
function deg(t) { return Math.round(t); }
function renderWeather(w) {
  const cur = w.current || {};
  const info = weatherInfo(cur.weather_code, cur.is_day);
  const unit = w.unit === 'f' ? '°F' : '°C';
  let forecastHTML = '';
  const daily = w.daily || {};
  const days = daily.time || [];
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  days.slice(0, 6).forEach((t, i) => {
    const d = new Date(t + 'T00:00:00');
    const fc = weatherInfo(daily.weather_code && daily.weather_code[i], 1);
    forecastHTML += `
      <div class="forecast-day">
        <div class="d">${i === 0 ? '今天' : '周' + week[d.getDay()]}</div>
        <div class="ic">${fc.e}</div>
        <div class="t">${deg(daily.temperature_2m_max[i])}° <span>${deg(daily.temperature_2m_min[i])}°</span></div>
      </div>`;
  });
  $('#weather-panel').innerHTML = `
    <div class="weather-top">
      <div class="weather-icon">${info.e}</div>
      <div>
        <div class="weather-temp">${deg(cur.temperature_2m)}<sup>${unit}</sup></div>
        <div class="weather-cond">${info.l}</div>
        <div class="weather-loc">${escapeHTML(w.location || '')}</div>
      </div>
    </div>
    <div class="weather-meta">
      <span class="m">体感 <b>${deg(cur.apparent_temperature)}°</b></span>
      <span class="m">湿度 <b>${cur.relative_humidity_2m}%</b></span>
      <span class="m">风速 <b>${cur.wind_speed_10m} km/h</b></span>
    </div>
    <div class="weather-forecast">${forecastHTML}</div>`;
}

async function loadWeather() {
  try {
    const w = await api('/api/weather');
    renderWeather(w);
  } catch (e) {
    $('#weather-panel').innerHTML = '<div class="weather-loading">天气暂时不可用</div>';
  }
}

/* ── 应用网格 ──────────────────────────────────────────────────── */
function appIconHTML(app, sizeClass) {
  const cls = sizeClass ? `app-icon ${sizeClass}` : 'app-icon';
  if (app.icon_type === 'emoji') {
    return `<div class="${cls}" style="background:var(--hover); box-shadow:none">${escapeHTML(app.icon_value)}</div>`;
  }
  if (app.icon_type === 'image') {
    return `<div class="${cls}"><img src="/uploads/${escapeHTML(app.icon_value)}" alt=""></div>`;
  }
  if (app.icon_type === 'url') {
    return `<div class="${cls}"><img src="${escapeHTML(app.icon_value)}" alt="" loading="lazy"></div>`;
  }
  const letter = (app.name || '?')[0];
  return `<div class="${cls}" style="background:${escapeHTML(app.color || '#0071e3')}">${escapeHTML(letter.toUpperCase())}</div>`;
}

function renderApps() {
  const grid = $('#apps-grid');
  grid.innerHTML = '';
  currentApps.forEach((app) => {
    const url = networkMode === 'internal' ? app.url_internal : app.url_external;
    const tag = url ? 'a' : 'div';
    const tile = document.createElement(tag);
    tile.className = 'app-tile' + (url ? '' : ' muted');
    if (url) {
      tile.href = url; tile.target = '_blank'; tile.rel = 'noopener noreferrer';
      tile.title = `${app.name}\n${url}`;
    } else {
      tile.title = `${app.name}：未配置${networkMode === 'internal' ? '内网' : '外网'}地址`;
    }
    tile.innerHTML = `${appIconHTML(app)}<span class="app-name">${escapeHTML(app.name)}</span>`;
    if (!url) {
      const b = document.createElement('span');
      b.className = 'badge'; b.textContent = '未配置';
      tile.appendChild(b);
    }
    grid.appendChild(tile);
  });
  $('#apps-empty').hidden = currentApps.length > 0;
}

async function loadApps() {
  const data = await api('/api/apps');
  currentApps = data.apps;
  renderApps();
}

/* ── 用户下拉菜单 ──────────────────────────────────────────────── */
function togglePopover() {
  const pop = $('#user-popover');
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = `
    <div class="pop-user">
      ${avatarHTML(currentUser)}
      <div>
        <div class="pop-name">${escapeHTML(currentUser.name || currentUser.username)}</div>
        <div class="pop-sub">@${escapeHTML(currentUser.username)}</div>
      </div>
    </div>
    <button class="pop-item" data-act="settings">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      账户设置
    </button>
    <button class="pop-item danger" data-act="logout">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      退出登录
    </button>`;
  pop.hidden = false;
  const rect = $('#user-chip').getBoundingClientRect();
  pop.style.top = `${rect.bottom + 8}px`;
  pop.style.right = `${window.innerWidth - rect.right}px`;
}

/* ── 弹层 ──────────────────────────────────────────────────────── */
let activeSheet = null;
function openSheet(el) {
  el.hidden = false;
  $('#scrim').hidden = false;
  activeSheet = el;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  if (activeSheet) activeSheet.hidden = true;
  activeSheet = null;
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
}
$$('.close-btn, [data-close]').forEach((b) => b.addEventListener('click', closeSheet));
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); $('#user-popover').hidden = true; } });

/* ── 应用编辑表单 ──────────────────────────────────────────────── */
function buildSwatches() {
  const wrap = $('#color-swatches');
  wrap.innerHTML = '';
  PALETTE.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'swatch' + (i === 0 ? ' active' : '');
    s.style.background = c;
    s.dataset.color = c;
    s.addEventListener('click', () => {
      $$('#color-swatches .swatch').forEach((x) => x.classList.remove('active'));
      s.classList.add('active');
      updateIconPreview();
    });
    wrap.appendChild(s);
  });
}

function selectedColor() {
  const s = $('#color-swatches .swatch.active');
  return s ? s.dataset.color : PALETTE[0];
}

function updateIconPreview() {
  const type = $$('input[name="icon_type"]').find((r) => r.checked).value;
  const name = $('#app-name').value.trim() || '?';
  const preview = $('#icon-preview');
  if (type === 'emoji') {
    preview.innerHTML = escapeHTML($('#app-emoji').value.trim() || '😀');
    preview.style.background = 'var(--hover)';
  } else if (type === 'image') {
    preview.innerHTML = appImageDataURL ? `<img src="${appImageDataURL}" alt="">` : '<span style="opacity:.5;font-size:16px">图</span>';
    preview.style.background = appImageDataURL ? 'transparent' : 'var(--hover)';
  } else if (type === 'url') {
    const u = $('#app-iconurl').value.trim();
    preview.innerHTML = u ? `<img src="${escapeHTML(u)}" alt="">` : '<span style="opacity:.5;font-size:16px">链</span>';
    preview.style.background = u ? 'transparent' : 'var(--hover)';
  } else {
    preview.innerHTML = escapeHTML(name[0] ? name[0].toUpperCase() : '?');
    preview.style.background = selectedColor();
  }
}

function openAppSheet(app) {
  editingAppId = app ? app.id : null;
  appImageDataURL = null;
  $('#app-sheet-title').textContent = app ? '编辑应用' : '添加应用';
  $('#app-error').hidden = true;
  $('#app-name').value = app ? app.name : '';
  $('#app-internal').value = app ? app.url_internal : '';
  $('#app-external').value = app ? app.url_external : '';
  $('#app-emoji').value = (app && app.icon_type === 'emoji') ? app.icon_value : '';
  $('#app-iconurl').value = (app && app.icon_type === 'url') ? app.icon_value : '';
  $('#app-image').value = '';
  const type = (app && app.icon_type) || 'letter';
  $$('input[name="icon_type"]').forEach((r) => { r.checked = r.value === type; });
  // 若编辑 image 类型，保留原图（icon_value 为文件名，非 dataURL）
  if (type === 'image' && app && app.icon_value && !app.icon_value.startsWith('data:')) {
    appImageDataURL = `/uploads/${app.icon_value}`;
  }
  syncIconFields();
  updateIconPreview();
  openSheet($('#app-sheet'));
  setTimeout(() => $('#app-name').focus(), 100);
}

function syncIconFields() {
  const type = $$('input[name="icon_type"]').find((r) => r.checked).value;
  $$('.icon-opt').forEach((l) => l.classList.toggle('active', l.dataset.type === type));
  $('#field-letter').hidden = type !== 'letter';
  $('#field-emoji').hidden = type !== 'emoji';
  $('#field-image').hidden = type !== 'image';
  $('#field-url').hidden = type !== 'url';
}

async function submitApp(e) {
  e.preventDefault();
  const err = $('#app-error');
  err.hidden = true;
  const name = $('#app-name').value.trim();
  const internal = $('#app-internal').value.trim();
  const external = $('#app-external').value.trim();
  const type = $$('input[name="icon_type"]').find((r) => r.checked).value;
  if (!name) { return showErr(err, '请填写名称'); }
  if (!internal && !external) { return showErr(err, '请至少填写一个地址'); }

  let icon_value = '';
  if (type === 'letter') icon_value = '';
  else if (type === 'emoji') icon_value = $('#app-emoji').value.trim();
  else if (type === 'url') icon_value = $('#app-iconurl').value.trim();
  else if (type === 'image') {
    if (appImageDataURL && appImageDataURL.startsWith('data:')) icon_value = appImageDataURL;
    else if (editingAppId) {
      const old = currentApps.find((a) => a.id === editingAppId);
      if (old && old.icon_type === 'image') icon_value = old.icon_value;
    }
  }

  const body = {
    name, url_internal: internal, url_external: external,
    icon_type: type, icon_value,
    color: type === 'letter' ? selectedColor() : '#0071e3',
  };
  try {
    if (editingAppId) await api(`/api/apps/${editingAppId}`, { method: 'PUT', body });
    else await api('/api/apps', { method: 'POST', body });
    closeSheet();
    await loadApps();
    toast('已保存');
  } catch (errMsg) {
    showErr(err, errMsg.message);
  }
}
function showErr(el, msg) { el.textContent = msg; el.hidden = false; }

/* ── 管理列表（拖拽排序） ──────────────────────────────────────── */
function renderManageList() {
  const ul = $('#manage-list');
  ul.innerHTML = '';
  currentApps.forEach((app) => {
    const li = document.createElement('li');
    li.className = 'manage-item';
    li.draggable = true;
    li.dataset.id = app.id;
    const urls = [];
    if (app.url_internal) urls.push('内 ' + app.url_internal);
    if (app.url_external) urls.push('外 ' + app.url_external);
    li.innerHTML = `
      <span class="drag-handle"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>
      ${appIconHTML(app, '')}
      <div class="mi-info">
        <div class="mi-name">${escapeHTML(app.name)}</div>
        <div class="mi-urls">${escapeHTML(urls.join('  ·  ') || '未配置地址')}</div>
      </div>
      <div class="mi-actions">
        <button class="icon-btn" data-edit title="编辑"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg></button>
        <button class="icon-btn" data-del title="删除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>
      </div>`;
    ul.appendChild(li);
  });

  // 拖拽排序
  let dragged = null;
  ul.querySelectorAll('.manage-item').forEach((item) => {
    item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      const order = $$('#manage-list .manage-item').map((x) => x.dataset.id);
      // 更新本地顺序
      const map = new Map(currentApps.map((a) => [a.id, a]));
      currentApps = order.map((id) => map.get(id)).filter(Boolean);
      renderApps();
      try { await api('/api/apps/order', { method: 'PUT', body: { ids: order } }); } catch (e) { /* ignore */ }
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      ul.insertBefore(dragged, after ? item.nextSibling : item);
    });
  });

  ul.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const app = currentApps.find((a) => a.id === b.closest('.manage-item').dataset.id);
    closeSheet();
    openAppSheet(app);
  }));
  ul.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('.manage-item');
    const app = currentApps.find((a) => a.id === li.dataset.id);
    if (!confirm(`删除应用「${app.name}」？`)) return;
    try {
      await api(`/api/apps/${app.id}`, { method: 'DELETE' });
      await loadApps();
      renderManageList();
      toast('已删除');
    } catch (e) { toast(e.message); }
  }));
}

/* ── 图片处理 ──────────────────────────────────────────────────── */
function processImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/* ── 事件绑定 ──────────────────────────────────────────────────── */
function bindEvents() {
  // 首次设置
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#setup-error');
    err.hidden = true;
    const username = $('#setup-username').value.trim();
    const name = $('#setup-name').value.trim();
    const p1 = $('#setup-password').value;
    const p2 = $('#setup-password2').value;
    if (!username) return showErr(err, '请填写用户名');
    if (p1.length < 6) return showErr(err, '密码至少 6 位');
    if (p1 !== p2) return showErr(err, '两次输入的密码不一致');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      currentUser = await api('/api/setup', { method: 'POST', body: { username, name, password: p1 } });
      toast('账户已创建');
      enterDashboard();
    } catch (msg) { showErr(err, msg.message); }
    btn.disabled = false;
  });

  // 登录
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      currentUser = await api('/api/login', {
        method: 'POST',
        body: { username: $('#login-username').value.trim(), password: $('#login-password').value },
      });
      enterDashboard();
    } catch (msg) { showErr(err, msg.message); }
    btn.disabled = false;
  });

  // 网络切换
  $('#network-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    networkMode = b.dataset.net;
    localStorage.setItem('panel_network', networkMode);
    setSegActive($('#network-seg'), b);
    $('#foot-net').textContent = networkMode === 'internal' ? '内网' : '外网';
    renderApps();
  });

  // 用户菜单
  $('#user-chip').addEventListener('click', togglePopover);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-popover') && !e.target.closest('#user-chip')) {
      $('#user-popover').hidden = true;
    }
  });
  $('#user-popover').addEventListener('click', (e) => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    $('#user-popover').hidden = true;
    if (item.dataset.act === 'settings') openSettings();
    else if (item.dataset.act === 'logout') doLogout();
  });

  // 应用按钮
  $('#btn-add').addEventListener('click', () => openAppSheet(null));
  $('#btn-manage').addEventListener('click', () => { renderManageList(); openSheet($('#manage-sheet')); });
  $('#app-form').addEventListener('submit', submitApp);

  // 图标类型切换
  $$('input[name="icon_type"]').forEach((r) => r.addEventListener('change', () => { syncIconFields(); updateIconPreview(); }));
  $('#app-name').addEventListener('input', updateIconPreview);
  $('#app-emoji').addEventListener('input', updateIconPreview);
  $('#app-iconurl').addEventListener('input', updateIconPreview);
  $('#app-image').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { appImageDataURL = await processImage(f, 256); updateIconPreview(); } catch (msg) { toast(msg.message); }
  });

  // 设置
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      currentUser = await api('/api/profile', { method: 'POST', body: { name: $('#profile-name').value.trim() } });
      renderAvatars();
      toast('名称已更新');
    } catch (msg) { toast(msg.message); }
  });

  $('#btn-upload-avatar').addEventListener('click', () => $('#avatar-file').click());
  $('#avatar-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = await processImage(f, 512);
      currentUser = await api('/api/profile', { method: 'POST', body: { avatar: data } });
      renderAvatars();
      toast('头像已更新');
    } catch (msg) { toast(msg.message); }
  });
  $('#btn-remove-avatar').addEventListener('click', async () => {
    try {
      currentUser = await api('/api/profile', { method: 'POST', body: { avatar: '' } });
      renderAvatars();
      toast('头像已移除');
    } catch (msg) { toast(msg.message); }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pw-error');
    err.hidden = true;
    const cur = $('#pw-current').value;
    const next = $('#pw-new').value;
    const next2 = $('#pw-new2').value;
    if (next.length < 6) return showErr(err, '新密码至少 6 位');
    if (next !== next2) return showErr(err, '两次输入的新密码不一致');
    try {
      await api('/api/password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      $('#pw-current').value = $('#pw-new').value = $('#pw-new2').value = '';
      toast('密码已修改');
    } catch (msg) { showErr(err, msg.message); }
  });

  // 天气单位切换
  $('#unit-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    weatherUnit = b.dataset.unit;
    setSegActive($('#unit-seg'), b);
  });
  $('#weather-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#weather-error');
    err.hidden = true;
    const loc = $('#weather-location').value.trim();
    if (!loc) return showErr(err, '请填写位置');
    try {
      await api('/api/settings', { method: 'PUT', body: { location: loc, weatherUnit } });
      toast('设置已保存');
      await loadWeather();
    } catch (msg) { showErr(err, msg.message); }
  });

  // 导航标签切换（主页 / 文件）
  $('#nav-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.dataset.view;
    if (v === 'home') { showView('home'); setActiveTab('home'); }
    else if (v === 'files') { showView('files'); setActiveTab('files'); loadFiles(currentPath); }
    else if (v === 'mail') { showView('mail'); setActiveTab('mail'); enterMail(); }
  });

  // 文件：上传 / 新建文件夹
  $('#btn-upload-file').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
  $('#btn-mkdir').addEventListener('click', () => openNameSheet('mkdir', '', ''));

  // 文件：批量操作按钮
  const selActionMap = {
    'btn-del-sel': () => deleteSelected(),
    'btn-download-sel': () => downloadSelected(),
    'btn-share-sel': () => toast('暂未实现，可后续扩展为分享链接'),
  };
  Object.entries(selActionMap).forEach(([id, fn]) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  });

  // 主题切换按钮
  const themeBtn = document.getElementById('btn-theme');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // 侧栏折叠/展开按钮
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const wrap = $('#files-wrap');
      wrap.classList.toggle('sidebar-collapsed');
    });
  }
  // 侧栏导航切换（近期 / 全部 / 回收站）
  $$('.fs-nav').forEach((b) => b.addEventListener('click', () => {
    switchFsView(b.dataset.fsview);
  }));

  // "更多" 按钮占位
  const moreBtn = document.getElementById('btn-files-more');
  if (moreBtn) moreBtn.addEventListener('click', () => toast('更多操作：暂未实现'));

  // 文件列表事件委托
  $('#files-list').addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-act]');
    const checkBox = e.target.closest('input[type="checkbox"]');
    const row = e.target.closest('.file-row');
    if (!row) return;
    const rel = row.dataset.path;
    // 勾选框：单独处理切换选中，不触发进入/下载
    if (checkBox) {
      e.stopPropagation();
      toggleSelectRow(row);
      return;
    }
    if (actionBtn) {
      const act = actionBtn.dataset.act;
      if (act === 'edit') editFile(rel);
      else if (act === 'download') downloadFile(rel);
      else if (act === 'rename') openNameSheet('rename', rel, row.dataset.type);
      else if (act === 'del') deleteFile(rel);
      return;
    }
    // 普通点击：先判断是否已经有选中项 —— 有则切换选中，无则进入或下载
    if (selectedFiles.size > 0) {
      toggleSelectRow(row);
      return;
    }
    if (row.dataset.type === 'dir') loadFiles(rel);
    else if (row.dataset.editable === '1') editFile(rel);
    else downloadFile(rel);
  });

  // 名称 sheet（新建文件夹 / 重命名）
  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#name-error');
    err.hidden = true;
    const val = $('#name-input').value.trim();
    if (!val) return showErr(err, '请输入名称');
    try {
      if (nameSheetMode === 'mkdir') await api('/api/files/mkdir', { method: 'POST', body: { path: currentPath, name: val } });
      else await api('/api/files/rename', { method: 'POST', body: { path: nameSheetTarget, name: val } });
      closeSheet();
      await loadFiles(currentPath);
      toast('已保存');
    } catch (msg) { showErr(err, msg.message); }
  });

  // 拖拽上传
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (!isFilesVisible()) return; dragDepth++; $('#drop-hint').hidden = false; e.preventDefault(); });
  window.addEventListener('dragover', (e) => { if (isFilesVisible()) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) $('#drop-hint').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
    if (!isFilesVisible()) return;
    if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  // 邮件：写邮件
  $('#btn-mail-compose').addEventListener('click', () => {
    if (!mailAccounts.length) { toast('请先添加邮件账户'); return; }
    openComposeSheet(null);
  });
  $('#btn-mail-refresh').addEventListener('click', () => loadMailList(false));
  $('#compose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#compose-error');
    err.hidden = true;
    const files = $('#compose-attachments').querySelectorAll('.attach-chip');
    const attachments = Array.from(files).map((f) => ({
      filename: f.dataset.name, contentType: f.dataset.type, content: f.dataset.content,
    })).filter((a) => a.content);
    try {
      await api('/api/mail/send', {
        method: 'POST',
        body: {
          account: $('#compose-account').value,
          to: $('#compose-to').value,
          cc: $('#compose-cc').value,
          bcc: $('#compose-bcc').value,
          subject: $('#compose-subject').value,
          text: $('#compose-body').value,
          attachments,
        },
      });
      closeSheet();
      toast('邮件已发送');
    } catch (msg) { showErr(err, msg.message); }
  });
  $('#btn-add-attachment').addEventListener('click', () => $('#compose-file').click());
  $('#compose-file').addEventListener('change', (e) => {
    Array.from(e.target.files || []).forEach((f) => {
      if (f.size > 20 * 1024 * 1024) { toast('附件过大（≤20MB）'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] || '';
        const chip = document.createElement('span');
        chip.className = 'attach-chip';
        chip.dataset.name = f.name; chip.dataset.type = f.type || 'application/octet-stream'; chip.dataset.content = base64;
        chip.innerHTML = `<span>📎 ${escapeHTML(f.name)} (${fmtSize(f.size)})</span><button class="att-del" type="button">×</button>`;
        chip.querySelector('.att-del').addEventListener('click', () => chip.remove());
        $('#compose-attachments').appendChild(chip);
      };
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  });
  // 邮件账户表单
  $('#mailaccount-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#ma-error');
    err.hidden = true;
    try {
      await api('/api/mail/accounts', {
        method: 'POST',
        body: {
          name: $('#ma-name').value,
          email: $('#ma-email').value.trim(),
          password: $('#ma-password').value,
          imapHost: $('#ma-imap').value.trim(),
          imapSecure: $('#ma-imap-ssl').checked,
          smtpHost: $('#ma-smtp').value.trim(),
          smtpSecure: $('#ma-smtp-ssl').checked,
        },
      });
      closeSheet();
      toast('账户已添加');
      const data = await api('/api/mail/accounts');
      mailAccounts = data.accounts || [];
      mailCurrentAccount = mailAccounts[mailAccounts.length - 1] || null;
      renderMailAccounts();
      if (mailCurrentAccount) { await loadMailFolders(); await loadMailList(true); }
    } catch (msg) { showErr(err, msg.message); }
  });

  // 导航滚动阴影
  const nav = $('#navbar');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), { passive: true });
}

async function openSettings() {
  $('#profile-name').value = currentUser.name || '';
  renderAvatars();
  $('#pw-current').value = $('#pw-new').value = $('#pw-new2').value = '';
  $('#pw-error').hidden = true;
  $('#weather-error').hidden = true;
  try {
    const s = await api('/api/settings');
    $('#weather-location').value = s.location || '';
    weatherUnit = s.weatherUnit || 'c';
    setSegActive($('#unit-seg'), $('#unit-seg').querySelector(`[data-unit="${weatherUnit}"]`));
  } catch (e) { /* ignore */ }
  openSheet($('#settings-sheet'));
}

async function doLogout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  currentUser = null;
  showView('login');
}

/* ═══════════════ 主题切换 ═══════════════ */
function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('panel_theme', t);
}
function initTheme() {
  const saved = localStorage.getItem('panel_theme');
  if (saved) return applyTheme(saved);
  // 未设置则跟随系统
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ═══════════════ 文件（云盘） ═══════════════ */
let currentPath = '/';
let nameSheetMode = 'mkdir';
let nameSheetTarget = '';
let selectedFiles = new Set();
let fileViewMode = 'list';
let currentFsView = 'all';   // all | recent | trash

const FILE_ICONS = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
};

const FILE_GLYPH_SVG = {
  dir:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  word:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>',
  cell:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v1H8v-1zm0 3h8v1H8v-1zm0-6h4v1H8v-1z"/></svg>',
  slide: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>',
  pdf:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm14 4l4-2v10l-4-2V9z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
  archive:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V5zm0 5h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9zm6 3h6v3H9v-3z"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>',
};

const FILE_KIND_LABEL = {
  dir: '文件夹',
  word: '文档', cell: '电子表格', slide: '演示文稿', pdf: 'PDF',
  image: '图片', video: '视频', audio: '音频', archive: '压缩包', other: '文件',
};

function fileIconClass(item) {
  if (item.type === 'dir') return 'dir';
  const e = item.ext;
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(e)) return 'word';
  if (['xlsx', 'xls', 'ods', 'csv'].includes(e)) return 'cell';
  if (['pptx', 'ppt', 'odp'].includes(e)) return 'slide';
  if (e === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(e)) return 'image';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(e)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(e)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'archive';
  return 'other';
}
function formatMtime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function joinPath(dir, name) {
  if (dir === '/' || dir === '') return '/' + name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

async function loadFiles(path) {
  currentPath = path || '/';
  currentFsView = 'all';
  $$('.fs-nav').forEach((b) => b.classList.toggle('active', b.dataset.fsview === 'all'));
  const mkdirBtn = $('#btn-mkdir');
  const uploadBtn = $('#btn-upload-file');
  if (mkdirBtn) mkdirBtn.hidden = false;
  if (uploadBtn) uploadBtn.hidden = false;
  selectedFiles.clear();
  try {
    const data = await api('/api/files?path=' + encodeURIComponent(currentPath));
    renderBreadcrumb();
    renderHero(data);
    renderFiles(data);
  } catch (msg) { toast(msg.message); }
}

/* ── 侧栏视图切换：近期 / 全部 / 回收站 ── */
function switchFsView(view) {
  currentFsView = view || 'all';
  $$('.fs-nav').forEach((b) => b.classList.toggle('active', b.dataset.fsview === currentFsView));
  selectedFiles.clear();
  updateSelectionUI();
  // 视图相关按钮显隐：回收站视图隐藏「新建文件夹/上传」
  const mkdirBtn = $('#btn-mkdir');
  const uploadBtn = $('#btn-upload-file');
  if (mkdirBtn) mkdirBtn.hidden = currentFsView === 'trash';
  if (uploadBtn) uploadBtn.hidden = currentFsView === 'trash';
  if (view === 'recent') loadRecent();
  else if (view === 'trash') loadTrash();
  else loadFiles('/');
}

async function loadRecent() {
  $('#files-hero-title').textContent = '近期文件';
  $('#files-hero-sub').textContent = '按修改时间排序';
  $('#file-crumbs').innerHTML = '';
  $('#files-empty').hidden = true;
  $('#files-panel').hidden = false;
  const ul = $('#files-list');
  ul.innerHTML = '<div class="mail-loading">正在加载…</div>';
  try {
    const data = await api('/api/files/recent?limit=30');
    ul.innerHTML = '';
    if (!data.items || !data.items.length) {
      $('#files-empty').hidden = false;
      $('#files-empty').textContent = '暂无文件';
      return;
    }
    // 按天分组
    const groups = groupByTime(data.items);
    for (const g of groups) {
      const head = document.createElement('li');
      head.className = 'file-group';
      head.textContent = g.label;
      ul.appendChild(head);
      for (const item of g.items) {
        const rel = '/' + item.name;
        const kindClass = fileIconClass(item);
        ul.appendChild(fileRowEl(item, rel, kindClass));
      }
    }
    // 近期文件点击直接下载（跨目录）
    bindRecentListEvents();
  } catch (e) {
    ul.innerHTML = '';
    $('#files-empty').hidden = false;
    $('#files-empty').textContent = '加载失败：' + e.message;
  }
}

// 近期文件行：点击下载/编辑，操作列提供下载
function bindRecentListEvents() {
  $('#files-list').querySelectorAll('.file-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-act]');
      const checkBox = e.target.closest('input[type="checkbox"]');
      if (checkBox) { e.stopPropagation(); toggleSelectRow(row); return; }
      if (actionBtn) {
        const act = actionBtn.dataset.act;
        if (act === 'download') downloadFile(row.dataset.path);
        else if (act === 'edit') editFile(row.dataset.path);
        else if (act === 'del') { /* 近期列表不提供删除 */ }
        return;
      }
      if (selectedFiles.size > 0) { toggleSelectRow(row); return; }
      if (row.dataset.editable === '1') editFile(row.dataset.path);
      else downloadFile(row.dataset.path);
    });
  });
}

async function loadTrash() {
  $('#files-hero-title').textContent = '回收站';
  $('#files-hero-sub').textContent = '删除的文件在这里，可恢复或彻底删除';
  $('#file-crumbs').innerHTML = '';
  $('#files-empty').hidden = true;
  $('#files-panel').hidden = false;
  const ul = $('#files-list');
  ul.innerHTML = '<div class="mail-loading">正在加载…</div>';
  try {
    const data = await api('/api/trash/list');
    ul.innerHTML = '';
    if (!data.items || !data.items.length) {
      $('#files-empty').hidden = false;
      $('#files-empty').textContent = '回收站为空';
      return;
    }
    for (const item of data.items) {
      const li = document.createElement('li');
      li.className = 'file-row trash-row';
      li.dataset.path = item.name;
      const kindClass = fileIconClass({ type: 'file', ext: item.ext });
      const actions = [
        '<button class="icon-btn" data-act="restore" title="恢复">' + FILE_ICONS.download + '</button>',
        '<button class="icon-btn" data-act="purge" title="彻底删除">' + FILE_ICONS.del + '</button>',
      ];
      const nameTitle = escapeHTML(item.name);
      li.innerHTML = [
        '<span class="file-check"><input type="checkbox" aria-label="选择"/></span>',
        '<span class="file-icon">',
          '<span class="file-icon-bg ' + kindClass + '">' + (FILE_GLYPH_SVG[kindClass] || FILE_GLYPH_SVG.other) + '</span>',
          '<span class="file-name" title="' + nameTitle + '">' + nameTitle + '</span>',
        '</span>',
        '<span class="file-kind">' + escapeHTML(FILE_KIND_LABEL[kindClass] || '文件') + '</span>',
        '<span class="file-size">' + escapeHTML(item.sizeText || '—') + '</span>',
        '<span class="file-mtime">' + formatMtime(item.mtime) + '</span>',
        '<span class="file-actions">' + actions.join('') + '</span>'
      ].join('');
      li.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-act]');
        if (actionBtn) {
          const act = actionBtn.dataset.act;
          if (act === 'restore') trashRestore(item.name);
          else if (act === 'purge') trashPurge(item.name);
        }
      });
      ul.appendChild(li);
    }
  } catch (e) {
    ul.innerHTML = '';
    $('#files-empty').hidden = false;
    $('#files-empty').textContent = '加载失败：' + e.message;
  }
}

async function trashRestore(name) {
  try {
    await api('/api/trash/restore', { method: 'POST', body: { path: name } });
    toast('已恢复');
    await loadTrash();
  } catch (e) { toast(e.message); }
}
async function trashPurge(name) {
  if (!confirm('彻底删除「' + name + '」？此操作不可恢复。')) return;
  try {
    await api('/api/trash/purge', { method: 'POST', body: { path: name } });
    toast('已彻底删除');
    await loadTrash();
  } catch (e) { toast(e.message); }
}

function folderTitle() {
  if (currentPath === '/' || !currentPath) return '全部文件';
  const parts = currentPath.split('/').filter(Boolean);
  return parts[parts.length - 1] || '全部文件';
}

function renderBreadcrumb() {
  const wrap = $('#file-crumbs');
  wrap.innerHTML = "";
  const root = document.createElement('button');
  root.className = 'crumb' + (currentPath === '/' ? ' current' : '');
  root.textContent = '全部文件';
  root.onclick = () => loadFiles('/');
  wrap.appendChild(root);
  if (currentPath !== '/') {
    const parts = currentPath.split('/').filter(Boolean);
    let acc = '';
    parts.forEach((p, i) => {
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.textContent = '\u203A';
      wrap.appendChild(sep);
      acc += '/' + p;
      const btn = document.createElement('button');
      btn.className = 'crumb' + (i === parts.length - 1 ? ' current' : '');
      btn.textContent = p;
      btn.onclick = () => loadFiles(acc);
      wrap.appendChild(btn);
    });
  }
}

function renderHero(data) {
  const count = data.items.length;
  const totalSize = data.items.reduce((s, i) => s + (i.size || 0), 0);
  const sizeText = totalSize < 1024 ? '0 B'
    : totalSize < 1024 * 1024 ? (totalSize / 1024).toFixed(1) + ' KB'
    : totalSize < 1024 * 1024 * 1024 ? (totalSize / 1024 / 1024).toFixed(1) + ' MB'
    : (totalSize / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  $('#files-hero-title').textContent = folderTitle();
  $('#files-hero-sub').textContent = count + ' 个项目，共 ' + sizeText;
}

function timeBucketLabel(ms) {
  const d = new Date(ms);
  const now = new Date();
  const diffDay = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDay === 0) return '今天';
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return '本周早些时候';
  if (diffDay < 30) return '上周';
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月';
  return d.getFullYear() + '年';
}
function groupByTime(items) {
  const sorted = items.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return b.mtime - a.mtime;
  });
  const groups = [];
  let lastBucket = null;
  for (const it of sorted) {
    const bucket = timeBucketLabel(it.mtime);
    if (bucket !== lastBucket) {
      groups.push({ label: bucket, items: [] });
      lastBucket = bucket;
    }
    groups[groups.length - 1].items.push(it);
  }
  return groups;
}

function fileRowEl(item, fullPath, kindClass) {
  const li = document.createElement('li');
  li.className = 'file-row' + (selectedFiles.has(fullPath) ? ' selected' : '');
  li.dataset.path = fullPath;
  li.dataset.type = item.type;
  li.dataset.editable = item.editable ? '1' : '';
  const isDir = item.type === 'dir';
  const kindLabel = FILE_KIND_LABEL[kindClass] || '文件';
  const checked = selectedFiles.has(fullPath) ? 'checked' : '';
  const subInfo = isDir ? '项目' : (item.sizeText || '');
  const actions = [];
  if (item.editable) actions.push('<button class="icon-btn" data-act="edit" title="在线编辑">' + FILE_ICONS.edit + '</button>');
  actions.push('<button class="icon-btn" data-act="download" title="下载">' + FILE_ICONS.download + '</button>');
  actions.push('<button class="icon-btn" data-act="rename" title="重命名">' + FILE_ICONS.rename + '</button>');
  actions.push('<button class="icon-btn" data-act="del" title="删除">' + FILE_ICONS.del + '</button>');
  const svgGlyph = FILE_GLYPH_SVG[kindClass] || FILE_GLYPH_SVG.other;
  const nameTitle = escapeHTML(item.name);
  const kindInline = escapeHTML(subInfo);
  li.innerHTML = [
    '<span class="file-check"><input type="checkbox" ' + checked + ' aria-label="选择"/></span>',
    '<span class="file-icon">',
      '<span class="file-icon-bg ' + kindClass + '">' + svgGlyph + '</span>',
      '<span class="file-name" title="' + nameTitle + '">' + nameTitle + '<span class="file-kind-inline">' + kindInline + '</span></span>',
    '</span>',
    '<span class="file-kind">' + escapeHTML(kindLabel) + '</span>',
    '<span class="file-size">' + (isDir ? '—' : escapeHTML(item.sizeText || '—')) + '</span>',
    '<span class="file-mtime">' + formatMtime(item.mtime) + '</span>',
    '<span class="file-actions">' + actions.join('') + '</span>'
  ].join("");
  return li;
}

function renderFiles(data) {
  const ul = $('#files-list');
  ul.innerHTML = "";
  const groups = groupByTime(data.items);
  if (groups.length === 0) {
    $('#files-empty').hidden = false;
    $('#files-panel').hidden = true;
    $('#files-check-all').checked = false;
    updateSelectionUI();
    return;
  }
  $('#files-empty').hidden = true;
  $('#files-panel').hidden = false;
  const allPaths = [];
  for (const g of groups) {
    const groupHead = document.createElement('li');
    groupHead.className = 'file-group';
    groupHead.textContent = g.label;
    ul.appendChild(groupHead);
    for (const item of g.items) {
      const rel = joinPath(data.path, item.name);
      const kindClass = fileIconClass(item);
      ul.appendChild(fileRowEl(item, rel, kindClass));
      allPaths.push(rel);
    }
  }
  const allBox = $('#files-check-all');
  if (allBox) {
    allBox.checked = selectedFiles.size > 0 && selectedFiles.size === allPaths.length;
    allBox.indeterminate = selectedFiles.size > 0 && selectedFiles.size < allPaths.length;
    allBox.onchange = () => {
      if (allBox.checked) allPaths.forEach((p) => selectedFiles.add(p));
      else allPaths.forEach((p) => selectedFiles.delete(p));
      ul.querySelectorAll('.file-row').forEach((row) => row.classList.toggle('selected', selectedFiles.has(row.dataset.path)));
      ul.querySelectorAll('.file-row input[type="checkbox"]').forEach((cb, i) => {
        if (allPaths[i]) cb.checked = selectedFiles.has(allPaths[i]);
      });
      updateSelectionUI();
    };
  }
}

function updateSelectionUI() {
  const n = selectedFiles.size;
  const enable = n > 0;
  const inTrash = currentFsView === 'trash';
  // 回收站视图：批量分享/下载不可用（每行自带恢复/删除），删除按钮禁用
  ['btn-share-sel', 'btn-download-sel'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !enable || inTrash;
  });
  const delBtn = document.getElementById('btn-del-sel');
  if (delBtn) delBtn.disabled = inTrash ? true : !enable;
  const sub = $('#files-hero-sub');
  if (n > 0 && sub) {
    sub.textContent = '已选择 ' + n + ' 个项目';
  }
}

function toggleSelectRow(row) {
  const p = row.dataset.path;
  if (!p) return;
  if (selectedFiles.has(p)) selectedFiles.delete(p);
  else selectedFiles.add(p);
  row.classList.toggle('selected', selectedFiles.has(p));
  const cb = row.querySelector('input[type="checkbox"]');
  if (cb) cb.checked = selectedFiles.has(p);
  updateSelectionUI();
}

async function deleteSelected() {
  const paths = Array.from(selectedFiles);
  if (!paths.length) return;
  if (!confirm('确定删除选中的 ' + paths.length + ' 个项目？将移入回收站。')) return;
  try {
    for (const p of paths) {
      await api('/api/files/delete', { method: 'POST', body: { path: p } });
    }
    selectedFiles.clear();
    toast('已移入回收站 ' + paths.length + ' 个项目');
    await loadFiles(currentPath);
  } catch (msg) { toast(msg.message); }
}

function downloadSelected() {
  const paths = Array.from(selectedFiles);
  paths.forEach((p) => {
    const a = document.createElement('a');
    a.href = '/api/files/download?path=' + encodeURIComponent(p);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

async function uploadFiles(files) {
  let count = 0;
  for (const f of files) {
    const fd = new FormData();
    fd.append('path', currentPath);
    fd.append('file', f, f.name);
    const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
    if (res.status === 401) { showView('login'); return; }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || '上传失败');
    } else count++;
  }
  if (count) toast('已上传 ' + count + ' 个文件');
  await loadFiles(currentPath);
}
function downloadFile(rel) {
  const a = document.createElement('a');
  a.href = '/api/files/download?path=' + encodeURIComponent(rel);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function editFile(rel) {
  window.open('/edit.html?path=' + encodeURIComponent(rel), '_blank');
}
async function deleteFile(rel) {
  const name = rel.split('/').pop();
  if (!confirm('确定删除「' + name + '」？将移入回收站。')) return;
  try {
    await api('/api/files/delete', { method: 'POST', body: { path: rel } });
    selectedFiles.delete(rel);
    toast('已移入回收站');
    await loadFiles(currentPath);
  } catch (msg) { toast(msg.message); }
}
function openNameSheet(mode, target, type) {
  nameSheetMode = mode;
  nameSheetTarget = target || '';
  $('#name-sheet-title').textContent = mode === 'mkdir' ? '新建文件夹' : (type === 'dir' ? '重命名文件夹' : '重命名文件');
  $('#name-label').textContent = mode === 'mkdir' ? '文件夹名称' : '新名称';
  $('#name-input').value = '';
  $('#name-error').hidden = true;
  openSheet($('#name-sheet'));
  setTimeout(() => $('#name-input').focus(), 100);
}
function isFilesVisible() { return !$('#view-files').hidden; }
function setActiveTab(v) {
  $('#nav-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
}
/* ═══════════════ 邮件 ═══════════════ */
let mailAccounts = [];
let mailCurrentAccount = null;
let mailFoldersData = { folders: [], special: { junk: [], trash: [], sent: [], draft: [] } };
let mailCurrentFolder = 'INBOX';
let mailCurrentUid = null;
let mailTimer = null;
const MAIL_PRESETS = {
  qq: { imap: 'imap.qq.com', smtp: 'smtp.qq.com' },
  163: { imap: 'imap.163.com', smtp: 'smtp.163.com' },
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  outlook: { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
};
function applyMailPreset() {
  const p = MAIL_PRESETS[$('#ma-preset').value];
  if (p) { $('#ma-imap').value = p.imap; $('#ma-smtp').value = p.smtp; }
}
function fmtMailTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

async function enterMail() {
  stopMailPoll();
  try {
    const data = await api('/api/mail/accounts');
    mailAccounts = data.accounts || [];
    renderMailAccounts();
    if (mailAccounts.length) {
      if (!mailCurrentAccount || !mailAccounts.some((a) => a.id === mailCurrentAccount.id)) {
        mailCurrentAccount = mailAccounts[0];
      }
      await loadMailFolders();
      await loadMailList(true);
      startMailPoll();
    } else {
      $('#mail-folders').innerHTML = '';
      $('#mail-list').innerHTML = '';
      $('#mail-empty').hidden = false;
      $('#mail-empty').textContent = '还没有配置邮件账户，点击左侧「添加账户」。';
      $('#mail-folder-title').textContent = '邮件';
      $('#mail-read-pane').innerHTML = '<div class="mail-read-empty">请先添加邮件账户</div>';
      $('#mail-nav-badge').hidden = true;
    }
  } catch (e) {
    $('#mail-empty').hidden = false;
    $('#mail-empty').textContent = '邮件模块加载失败：' + e.message;
  }
}

function renderMailAccounts() {
  const wrap = $('#mail-accounts');
  if (!mailAccounts.length) {
    wrap.innerHTML = '<button class="mail-add-account" id="btn-add-mailaccount">＋ 添加邮件账户</button>';
  } else {
    wrap.innerHTML = mailAccounts.map((a) => `
      <button class="mail-account-item${mailCurrentAccount && mailCurrentAccount.id === a.id ? ' active' : ''}" data-id="${a.id}">
        <span class="ma-name" title="${escapeHTML(a.email)}">${escapeHTML(a.name || a.email)}</span>
        <span class="ma-actions">
          <button class="ma-test" data-test="${a.id}" title="测试连接">测试</button>
          <button class="ma-del" data-del="${a.id}" title="删除账户">×</button>
        </span>
      </button>
    `).join('') + '<button class="mail-add-account" id="btn-add-mailaccount">＋ 添加账户</button>';
  }
  wrap.querySelectorAll('.mail-account-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-test]')) return;
      mailCurrentAccount = mailAccounts.find((a) => a.id === item.dataset.id);
      renderMailAccounts();
      loadMailFolders();
    });
  });
  wrap.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.test;
    b.disabled = true;
    const orig = b.textContent;
    b.textContent = '…';
    try {
      const r = await api(`/api/mail/accounts/${id}?test=1`, { method: 'POST' });
      toast(`IMAP: ${r.imap ? '✓ 正常' : '✗ 失败'}  SMTP: ${r.smtp ? '✓ 正常' : '✗ 失败'}${r.error ? '  ' + r.error : ''}`);
    } catch (err) { toast('测试失败：' + err.message); }
    finally { b.disabled = false; b.textContent = orig; }
  }));
  wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.del;
    if (!confirm('确定删除该邮件账户？')) return;
    try {
      await api(`/api/mail/accounts/${id}`, { method: 'DELETE' });
      mailAccounts = mailAccounts.filter((a) => a.id !== id);
      if (mailCurrentAccount && mailCurrentAccount.id === id) mailCurrentAccount = mailAccounts[0] || null;
      renderMailAccounts();
      if (mailCurrentAccount) { await loadMailFolders(); await loadMailList(true); } else { $('#mail-empty').hidden = false; $('#mail-empty').textContent = '还没有配置邮件账户。'; }
    } catch (err) { toast(err.message); }
  }));
  const addBtn = $('#btn-add-mailaccount');
  if (addBtn) addBtn.addEventListener('click', () => openMailAccountSheet());
}

async function loadMailFolders() {
  if (!mailCurrentAccount) return;
  try {
    const data = await api(`/api/mail/folders?account=${mailCurrentAccount.id}`);
    mailFoldersData = data;
    renderMailFolders();
    // 自动选中收件箱或当前文件夹
    if (!mailFoldersData.folders.some((f) => f.path === mailCurrentFolder)) {
      mailCurrentFolder = 'INBOX';
    }
  } catch (e) { toast(e.message); }
}

function renderMailFolders() {
  const wrap = $('#mail-folders');
  const folders = mailFoldersData.folders || [];
  // 优先级排序：收件箱、垃圾邮件、已发送、其他
  const rank = (p) => {
    const l = p.toLowerCase();
    if (l === 'inbox') return 0;
    if (/(junk|spam|垃圾)/.test(l)) return 1;
    if (/(trash|deleted|已删除|回收站)/.test(l)) return 3;
    if (/(sent|已发送)/.test(l)) return 4;
    if (/(draft|草稿)/.test(l)) return 5;
    return 2;
  };
  const sorted = folders.slice().sort((a, b) => rank(a.path) - rank(b.path));
  const ICO = {
    inbox: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    junk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    sent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    draft: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  };
  wrap.innerHTML = sorted.map((f) => {
    const l = f.path.toLowerCase();
    let icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
    if (l === 'inbox') icon = ICO.inbox;
    else if (/(junk|spam|垃圾)/.test(l)) icon = ICO.junk;
    else if (/(sent|已发送)/.test(l)) icon = ICO.sent;
    else if (/(trash|deleted|已删除|回收站)/.test(l)) icon = ICO.trash;
    else if (/(draft|草稿)/.test(l)) icon = ICO.draft;
    const active = f.path === mailCurrentFolder ? ' active' : '';
    const isJunk = /(junk|spam|垃圾)/.test(f.path.toLowerCase());
    return `<button class="mail-folder${active}" data-folder="${escapeHTML(f.path)}">${icon}<span>${escapeHTML(isJunk ? '垃圾邮件' : f.path)}</span></button>`;
  }).join('');
  wrap.querySelectorAll('.mail-folder').forEach((b) => b.addEventListener('click', () => {
    mailCurrentFolder = b.dataset.folder;
    renderMailFolders();
    loadMailList(true);
  }));
}

async function loadMailList(clearRead = false) {
  if (!mailCurrentAccount) return;
  const listEl = $('#mail-list');
  const loadingEl = $('#mail-loading');
  const emptyEl = $('#mail-empty');
  $('#mail-folder-title').textContent = /(junk|spam|垃圾)/i.test(mailCurrentFolder) ? '垃圾邮件' : mailCurrentFolder;
  if (clearRead) { $('#mail-read-pane').innerHTML = '<div class="mail-read-empty">选择一封邮件查看内容</div>'; mailCurrentUid = null; }
  loadingEl.hidden = false;
  listEl.innerHTML = '';
  emptyEl.hidden = true;
  try {
    const data = await api(`/api/mail/list?account=${mailCurrentAccount.id}&folder=${encodeURIComponent(mailCurrentFolder)}`);
    loadingEl.hidden = true;
    if (!data.items || !data.items.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = '该文件夹暂无邮件';
      listEl.innerHTML = '';
      return;
    }
    listEl.innerHTML = data.items.map((m) => `
      <button class="mail-item${m.seen ? '' : ' unseen'}${m.uid === mailCurrentUid ? ' active' : ''}" data-uid="${m.uid}">
        <div class="mi-from"><span>${escapeHTML(m.fromName || m.fromAddr || '(未知发件人)')}</span>${m.flags && m.flags.includes('\\Flagged') ? '<span class="mi-flag">★</span>' : ''}<span class="mi-date">${fmtMailTime(m.date)}</span></div>
        <div class="mi-subject">${escapeHTML(m.subject)}</div>
        <div class="mi-preview">${escapeHTML((m.fromAddr || '') + ' · ' + fmtSize(m.size))}</div>
      </button>
    `).join('');
    listEl.querySelectorAll('.mail-item').forEach((b) => b.addEventListener('click', () => readMail(Number(b.dataset.uid))));
    // 刷新未读徽标
    updateMailBadge();
  } catch (e) {
    loadingEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = '加载失败：' + e.message;
  }
}

async function readMail(uid) {
  if (!mailCurrentAccount || !uid) return;
  mailCurrentUid = uid;
  document.querySelectorAll('.mail-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.uid) === uid));
  $('#mail-read-pane').innerHTML = '<div class="mail-loading">正在加载邮件…</div>';
  try {
    const m = await api(`/api/mail/read?account=${mailCurrentAccount.id}&folder=${encodeURIComponent(mailCurrentFolder)}&uid=${uid}`);
    const htmlBody = m.html || (m.text ? m.text.split('\n').map((l) => escapeHTML(l)).join('<br>') : '<p style="color:var(--text-3)">(无正文)</p>');
    const atts = (m.attachments || []).map((a, i) => `
      <button class="mr-att" data-dl="${i}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        <span class="att-name">${escapeHTML(a.filename)}</span>
        <span class="att-size">${fmtSize(a.size)}</span>
      </button>
    `).join('');
    $('#mail-read-pane').innerHTML = `
      <div class="mail-read-head">
        <div class="mr-subject">${escapeHTML(m.subject)}</div>
        <div class="mr-meta">
          <span class="mr-avatar">${escapeHTML((m.from && (m.from.name || m.from.address || '?')).slice(0, 1).toUpperCase())}</span>
          <div>
            <div class="mr-from">${escapeHTML((m.from && (m.from.name || m.from.address)) || '未知发件人')}</div>
            <div>${escapeHTML((m.from && m.from.address) || '')} · ${fmtMailTime(m.date)}</div>
          </div>
        </div>
        <div class="mr-actions">
          <button class="btn-secondary btn-sm" id="btn-reply">回复</button>
          <button class="btn-secondary btn-sm" id="btn-mail-spam">标记垃圾</button>
          <button class="btn-secondary btn-sm" id="btn-mail-trash">删除</button>
        </div>
      </div>
      <div class="mr-body">${htmlBody}</div>
      ${atts ? `<div class="mr-attachments"><span class="mr-att-title">附件 (${(m.attachments || []).length})</span>${atts}</div>` : ''}
    `;
    const reply = $('#btn-reply');
    if (reply) reply.addEventListener('click', () => openComposeSheet(m));
    const spam = $('#btn-mail-spam');
    if (spam) spam.addEventListener('click', async () => { await mailFlag('spam'); });
    const trash = $('#btn-mail-trash');
    if (trash) trash.addEventListener('click', async () => { await mailFlag('delete'); });
    $('#mail-read-pane').querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => downloadAttachment(Number(b.dataset.dl), m)));
    // 标记已读后刷新列表未读态
    const item = document.querySelector(`.mail-item[data-uid="${uid}"]`);
    if (item) item.classList.remove('unseen');
    updateMailBadge();
  } catch (e) {
    $('#mail-read-pane').innerHTML = '<div class="mail-read-empty">读取失败：' + escapeHTML(e.message) + '</div>';
  }
}

async function mailFlag(action) {
  if (!mailCurrentUid) return;
  try {
    await api('/api/mail/flag', { method: 'POST', body: { account: mailCurrentAccount.id, folder: mailCurrentFolder, uids: [mailCurrentUid], action } });
    toast(action === 'spam' ? '已标记为垃圾邮件' : '已删除');
    loadMailList(true);
  } catch (e) { toast(e.message); }
}

function downloadAttachment(idx, msg) {
  window.open(`/api/mail/attachment?account=${mailCurrentAccount.id}&folder=${encodeURIComponent(mailCurrentFolder)}&uid=${mailCurrentUid}&index=${idx}`, '_blank');
}

function openComposeSheet(replyMsg) {
  const sel = $('#compose-account');
  sel.innerHTML = mailAccounts.map((a) => `<option value="${a.id}">${escapeHTML(a.name || a.email)}</option>`).join('');
  $('#compose-to').value = replyMsg && replyMsg.from && replyMsg.from.address ? replyMsg.from.address : '';
  $('#compose-cc').value = '';
  $('#compose-bcc').value = '';
  $('#compose-subject').value = replyMsg ? 'Re: ' + replyMsg.subject : '';
  $('#compose-body').value = replyMsg ? `\n\n\n—— 原始邮件 ——\n发件人: ${replyMsg.from && (replyMsg.from.name || replyMsg.from.address)}\n日期: ${fmtMailTime(replyMsg.date)}\n主题: ${replyMsg.subject}\n\n${replyMsg.text || ''}` : '';
  $('#compose-attachments').innerHTML = '';
  $('#compose-error').hidden = true;
  openSheet($('#compose-sheet'));
}

function openMailAccountSheet() {
  $('#ma-name').value = '';
  $('#ma-email').value = '';
  $('#ma-password').value = '';
  $('#ma-imap').value = '';
  $('#ma-smtp').value = '';
  $('#ma-imap-ssl').checked = true;
  $('#ma-smtp-ssl').checked = true;
  $('#ma-error').hidden = true;
  openSheet($('#mailaccount-sheet'));
}

function startMailPoll() {
  stopMailPoll();
  mailTimer = setInterval(updateMailBadge, 60000); // 每 60 秒轮询未读
}
function stopMailPoll() { if (mailTimer) { clearInterval(mailTimer); mailTimer = null; } }
async function updateMailBadge() {
  try {
    const data = await api('/api/mail/poll');
    let totalUnseen = 0;
    for (const a of data.accounts || []) totalUnseen += (a.unseen || 0);
    const badge = $('#mail-nav-badge');
    if (totalUnseen > 0) {
      badge.textContent = totalUnseen > 99 ? '99+' : totalUnseen;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch (e) { /* 静默失败 */ }
}

async function enterDashboard() {
  showView('home');
  renderAvatars();
  startClock();
  const netBtn = $('#network-seg').querySelector(`[data-net="${networkMode}"]`);
  setSegActive($('#network-seg'), netBtn);
  $('#foot-net').textContent = networkMode === 'internal' ? '内网' : '外网';
  setActiveTab('home');
  try { await loadApps(); } catch (e) { /* ignore */ }
  loadWeather();
}

/* ── 启动 ──────────────────────────────────────────────────────── */
(async function init() {
  initTheme();
  buildSwatches();
  bindEvents();
  try {
    const st = await api('/api/status');
    currentUser = st.user;
    if (!st.initialized) return showView('setup');
    if (!st.authenticated) return showView('login');
    enterDashboard();
  } catch (e) {
    showView('login');
    $('#login-error').textContent = '无法连接服务器，请确认服务已启动';
    $('#login-error').hidden = false;
  }
})();
