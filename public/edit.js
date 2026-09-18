'use strict';

/* OnlyOffice 编辑器加载（带分阶段计时，便于定位打开慢的环节） */

const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';

/* ── 计时器 ─────────────────────────────────────────────────── */
const T0 = performance.now();
const stages = []; // { name, at(ms), done(ms|null) }
let currentStageEl = null;

function markStage(name) {
  const last = stages[stages.length - 1];
  if (last && last.done == null) last.done = performance.now() - T0;
  stages.push({ name, at: performance.now() - T0, done: null });
  setStageText(name);
}
function finishStages() {
  const last = stages[stages.length - 1];
  if (last && last.done == null) last.done = performance.now() - T0;
}
function fmtStage(s) {
  const cost = s.done != null ? `${(s.done - s.at).toFixed(0)}ms` : '进行中…';
  return `${s.name}: ${cost}`;
}
function dumpTimings() {
  finishStages();
  console.group('[OnlyOffice] 打开耗时');
  stages.forEach((s) => console.log(`  ${fmtStage(s)}（始于 ${(s.at / 1000).toFixed(1)}s）`));
  console.log(`  总计: ${((performance.now() - T0) / 1000).toFixed(1)}s`);
  console.groupEnd();
}
// 界面提示：当前阶段 + 已完成阶段的耗时（长时间等待时可直观看到卡在哪）
function setStageText(text) {
  const el = document.querySelector('#loading span');
  if (!el) return;
  currentStageEl = el;
  const doneParts = stages.filter((s) => s.done != null).map((s) => `${s.name} ${(s.done / 1000).toFixed(1)}s`);
  el.innerHTML = escapeHTML(text) + (doneParts.length ? `<br><span style="font-size:12px;color:#a1a1aa">${escapeHTML(doneParts.join(' · '))}</span>` : '');
}

function showError(msg) {
  hideLoading();
  dumpTimings();
  const e = document.getElementById('error');
  e.innerHTML = msg;
  e.hidden = false;
}

// 隐藏加载遮罩：同时设置 hidden 属性 + 内联 display:none，
// 避免 CSS display:flex 覆盖 hidden 导致白色遮罩残留（白屏根因之一）
function hideLoading() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.hidden = true;
  el.style.display = 'none';
}

const DEPLOY_HINT =
  '先启动 OnlyOffice Document Server：<br>' +
  '<code style="display:inline-block;background:#f2f2f7;padding:4px 10px;border-radius:8px;margin:6px 0">docker compose up -d onlyoffice</code><br>' +
  '或单独运行：<code style="display:inline-block;background:#f2f2f7;padding:4px 10px;border-radius:8px;margin:6px 0">docker run -d -p 8080:80 onlyoffice/documentserver</code>';

/* ── "connection is too slow" 自动重试 ─────────────────────────
   该报错来自编辑器前端的组件加载看门狗：静态资源 / Editor.bin 在
   超时窗口内没加载完就报错。常见诱因：
   1) DS 内置 nginx 对 Editor.bin 做 gzip 慢压缩（官方 issue #3627，
      DocumentServer v9.4.0 已修复 → docker compose pull onlyoffice 升级）
   2) DS 刚重启时转换服务高负载，静态资源响应被拖慢
   3) 外网慢链路下载编辑器静态资源
   重载后资源大多已进入浏览器 HTTP 缓存，通常第二次即可成功。
   用 sessionStorage 限制自动重载次数，防止 DS 真不可用时无限刷新。 */
const OO_SLOW_RETRY_KEY = 'oo_slow_retry';
const OO_SLOW_MAX_RETRY = 1;

function isSlowConnError(desc) {
  return /connection is too slow|components could not be loaded/i.test(String(desc));
}

function autoRetrySlowConn(desc) {
  let n = 0;
  try { n = parseInt(sessionStorage.getItem(OO_SLOW_RETRY_KEY) || '0', 10) || 0; } catch { /* ignore */ }
  if (n >= OO_SLOW_MAX_RETRY) return false;
  try { sessionStorage.setItem(OO_SLOW_RETRY_KEY, String(n + 1)); } catch { /* ignore */ }
  console.warn('[OnlyOffice] 连接过慢，自动重载第 ' + (n + 1) + ' 次…', desc);
  setStageText('连接过慢，正在自动重载（第 ' + (n + 1) + ' 次）…');
  setTimeout(function () { location.reload(); }, 1200);
  return true;
}

/* ── 编辑器初始化看门狗（前端兜底） ───────────────────────────
   DocEditor 创建后 iframe 内要拉取 20MB+ 的 sdk 内核；api.js 秒下
   但 iframe 资源迟迟不完 = 链路带宽不足（外网穿透典型 ~1Mbps）。
   等待期间动态显示秒数；45s 未就绪自动重载一次（资源已入 HTTP 缓存）。 */
let initWatchTimer = null;
function stopInitWatch() {
  if (initWatchTimer) { clearInterval(initWatchTimer); initWatchTimer = null; }
}
function startInitWatch() {
  stopInitWatch();
  let waited = 0;
  initWatchTimer = setInterval(function () {
    waited += 1;
    if (currentStageEl) {
      currentStageEl.innerHTML =
        '编辑器初始化（加载 sdk 内核，资源较大）… ' +
        '<span style="font-size:12px;color:#a1a1aa">已等待 ' + waited + 's</span>';
    }
    if (waited >= 45) {
      stopInitWatch();
      if (!autoRetrySlowConn('编辑器初始化超时(45s)')) {
        showError(
          '编辑器加载超时（sdk 内核未在超时窗口内载入）。<br>' +
          'api.js 秒下但内核拉不完 = 当前链路带宽不足（外网穿透典型现象）。<br><br>' +
          '建议：<br>' +
          '1. 在面板顶部切换到「内网」模式后重新打开（需在 compose 配置 ONLYOFFICE_URL_INTERNAL 指向 NAS 内网地址）；<br>' +
          '2. 或在内网环境访问面板。<br>' +
          '<a href="javascript:history.back()">返回</a>'
        );
      }
    }
  }, 1000);
}

function loadEditor(ooUrl, config) {
  const base = ooUrl.replace(/\/+$/, '');
  const apiUrl = base + '/web-apps/apps/api/documents/api.js';

  // 注入事件回调：将 OnlyOffice 内部错误暴露到 UI，避免静默白屏无法排查
  config.events = {
    // 编辑器 UI 真正就绪后再隐藏加载遮罩（onAppReady 触发即代表 iframe 已渲染出界面）
    onAppReady: function () {
      markStage('编辑器初始化');
      stopInitWatch();
      console.log('[OnlyOffice] app ready');
      hideLoading();
    },
    onDocumentReady: function () {
      markStage('文档打开（含服务端转换/拉取）');
      dumpTimings();
      console.log('[OnlyOffice] document ready');
      // 打开成功：清零自动重试计数
      try { sessionStorage.removeItem(OO_SLOW_RETRY_KEY); } catch { /* ignore */ }
    },
    onError: function (event) {
      console.error('[OnlyOffice] editor error', event);
      var desc = (event && event.data && (event.data.description || event.data.error || JSON.stringify(event.data))) || '未知错误';
      // 看门狗超时：先自动重载一次（资源已在浏览器缓存，二次加载通常可过）
      if (isSlowConnError(desc) && autoRetrySlowConn(desc)) return;
      var hint = isSlowConnError(desc)
        ? '<br>常见原因：OnlyOffice 版本过旧（Editor.bin gzip 慢，官方 v9.4.0 已修复，请执行 <code>docker compose pull onlyoffice</code> 升级）或 DS 刚重启转换负载高。<br><br>'
        : '<br><br>';
      showError('OnlyOffice 编辑器错误：<br>' + escapeHTML(String(desc)) + hint + DEPLOY_HINT + '<br><a href="javascript:history.back()">返回</a>');
    },
    onWarning: function (event) { console.warn('[OnlyOffice] warning', event); },
  };

  function mount() {
    markStage('编辑器初始化');
    startInitWatch(); // ⚡ 前端看门狗：动态秒数 + 45s 未就绪自动重载
    try {
      new window.DocsAPI.DocEditor('placeholder', config);
    } catch (e) {
      stopInitWatch();
      showError('编辑器初始化异常：' + escapeHTML(e.message) + '<br><a href="javascript:history.back()">返回</a>');
    }
  }

  // 若 init 阶段已并行预下载过同一份 api.js，直接等它完成即可（避免二次下载）
  if (_apiCache.has(apiUrl)) {
    _apiCache.get(apiUrl).then(mount).catch(function () {
      showError(
        '无法连接 OnlyOffice 服务（' + escapeHTML(ooUrl) + '）。<br>请确认服务已启动、且该地址在浏览器中可访问。<br>' + DEPLOY_HINT + '<br><a href="javascript:history.back()">返回</a>'
      );
    });
    return;
  }

  const script = document.createElement('script');
  script.src = apiUrl;
  script.onload = mount;
  script.onerror = function () {
    showError(
      '无法连接 OnlyOffice 服务（' + escapeHTML(ooUrl) + '）。<br>请确认服务已启动、且该地址在浏览器中可访问。<br>' + DEPLOY_HINT + '<br><a href="javascript:history.back()">返回</a>'
    );
  };
  document.body.appendChild(script);
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function init() {
  if (!filePath) { showError('缺少文件路径参数。<br><a href="javascript:history.back()">返回</a>'); return; }
  markStage('获取编辑配置');

  // 加速优化：服务器已在 HTML 中注入 window.__OO_URL__，
  // 页面加载时立即开始预下载 api.js，与后端 config 请求并行，减少串行等待
  const injectedUrl = (window.__OO_URL__ || '').replace(/\/+$/, '');
  if (injectedUrl) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = injectedUrl;
    document.head.appendChild(pre);
    preloadApi(injectedUrl); // 提前开始下载 api.js（不阻塞）
  }

  try {
    // ⚡ 带上文件页的「内网/外网」模式：server 据此选择浏览器侧 DS 地址
    //   （内网模式 → ONLYOFFICE_URL_INTERNAL 直连，编辑器资源走局域网秒级加载）
    let netMode = 'internal';
    try { netMode = localStorage.getItem('panel_network') === 'external' ? 'external' : 'internal'; } catch { /* ignore */ }
    const res = await fetch('/api/onlyoffice/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, net: netMode }),
    });
    if (res.status === 401) { showError('登录已失效，请先登录面板。<br><a href="/">去登录</a>'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showError(data.error || '加载失败'); return; }
    if (!data.onlyofficeUrl) { showError('未配置 OnlyOffice 服务。'); return; }
    if (data.onlyofficeUp === false) {
      showError(
        `OnlyOffice 服务（${escapeHTML(data.onlyofficeUrl)}）未启动或不可达。<br>${DEPLOY_HINT}<br><a href="/">返回面板</a>`
      );
      return;
    }
    markStage('下载编辑器内核 api.js');
    // 若上面已并行预下载过 api.js，这里 loadEditor 里会直接复用缓存
    loadEditor(data.onlyofficeUrl, data.config);
  } catch (e) {
    showError('无法连接服务器，请确认面板已启动。<br><a href="javascript:history.back()">返回</a>');
  }
}

// 预下载 OnlyOffice api.js（幂等：多次调用只下载一次）
const _apiCache = new Map();
function preloadApi(ooUrl) {
  const u = ooUrl.replace(/\/+$/, '') + '/web-apps/apps/api/documents/api.js';
  if (_apiCache.has(u)) return _apiCache.get(u);
  const script = document.createElement('script');
  script.src = u;
  script.async = true;
  const p = new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => { _apiCache.delete(u); reject(new Error('api.js 加载失败')); };
  });
  _apiCache.set(u, p);
  document.body.appendChild(script);
  return p;
}

window.addEventListener('beforeunload', dumpTimings);
init();
