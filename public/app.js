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
  const authed = name === 'home' || name === 'files';
  $('#navbar').hidden = !authed;
  $('#view-dashboard').hidden = name !== 'home';
  $('#view-files').hidden = name !== 'files';
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

  let dragged = null;
  ul.querySelectorAll('.manage-item').forEach((item) => {
    item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      const order = $$('#manage-list .manage-item').map((x) => x.dataset.id);
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
  });

  // 文件：上传 / 新建文件夹
  $('#btn-upload-file').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
  $('#btn-mkdir').addEventListener('click', () => openNameSheet('mkdir', '', ''));

  // 文件列表事件委托
  $('#files-list').addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-act]');
    const row = e.target.closest('.file-row');
    if (!row) return;
    const rel = row.dataset.path;
    if (actionBtn) {
      const act = actionBtn.dataset.act;
      if (act === 'edit') editFile(rel);
      else if (act === 'download') downloadFile(rel);
      else if (act === 'rename') openNameSheet('rename', rel, row.dataset.type);
      else if (act === 'del') deleteFile(rel);
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

/* ═══════════════ 文件（云盘） ═══════════════ */
let currentPath = '/';
let nameSheetMode = 'mkdir';
let nameSheetTarget = '';

const FILE_ICONS = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
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
function fileIconGlyph(item) {
  if (item.type === 'dir') return '📁';
  const map = { word: '📝', cell: '📊', slide: '📽️', pdf: '📕', image: '🖼️', video: '🎬', audio: '🎵', archive: '📦', other: '📄' };
  return map[fileIconClass(item)] || '📄';
}
function formatMtime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function joinPath(dir, name) {
  if (dir === '/' || dir === '') return '/' + name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

async function loadFiles(path) {
  currentPath = path || '/';
  try {
    const data = await api('/api/files?path=' + encodeURIComponent(currentPath));
    renderBreadcrumb();
    renderFiles(data);
  } catch (msg) { toast(msg.message); }
}

function renderBreadcrumb() {
  const wrap = $('#file-crumbs');
  wrap.innerHTML = '';
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
      sep.className = 'sep'; sep.textContent = '›';
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

function renderFiles(data) {
  const ul = $('#files-list');
  ul.innerHTML = '';
  data.items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'file-row';
    li.dataset.path = joinPath(data.path, item.name);
    li.dataset.type = item.type;
    li.dataset.editable = item.editable ? '1' : '';
    const actions = [];
    if (item.editable) actions.push(`<button class="icon-btn" data-act="edit" title="在线编辑">${FILE_ICONS.edit}</button>`);
    actions.push(`<button class="icon-btn" data-act="download" title="下载">${FILE_ICONS.download}</button>`);
    actions.push(`<button class="icon-btn" data-act="rename" title="重命名">${FILE_ICONS.rename}</button>`);
    actions.push(`<button class="icon-btn" data-act="del" title="删除">${FILE_ICONS.del}</button>`);
    li.innerHTML = `
      <span class="file-icon ${fileIconClass(item)}">${fileIconGlyph(item)}</span>
      <span class="file-name">${escapeHTML(item.name)}</span>
      <span class="file-size hide-sm">${escapeHTML(item.sizeText)}</span>
      <span class="file-mtime hide-sm">${formatMtime(item.mtime)}</span>
      <span class="file-actions">${actions.join('')}</span>`;
    ul.appendChild(li);
  });
  const empty = data.items.length === 0;
  $('#files-empty').hidden = !empty;
  $('#files-panel').hidden = empty;
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
  if (count) toast(`已上传 ${count} 个文件`);
  await loadFiles(currentPath);
}
function downloadFile(rel) {
  const a = document.createElement('a');
  a.href = `/api/files/download?path=${encodeURIComponent(rel)}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function editFile(rel) {
  window.open(`/edit.html?path=${encodeURIComponent(rel)}`, '_blank');
}
async function deleteFile(rel) {
  const name = rel.split('/').pop();
  if (!confirm(`确定删除「${name}」？此操作不可撤销。`)) return;
  try {
    await api('/api/files/delete', { method: 'POST', body: { path: rel } });
    toast('已删除');
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
