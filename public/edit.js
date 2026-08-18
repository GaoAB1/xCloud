'use strict';

/* OnlyOffice 编辑器加载 */
const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';

function showError(msg) {
  hideLoading();
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

function loadEditor(ooUrl, config) {
  const base = ooUrl.replace(/\/+$/, '');
  const apiUrl = base + '/web-apps/apps/api/documents/api.js';

  // 注入事件回调：将 OnlyOffice 内部错误暴露到 UI，避免静默白屏无法排查
  config.events = {
    // 编辑器 UI 真正就绪后再隐藏加载遮罩（onAppReady 触发即代表 iframe 已渲染出界面）
    onAppReady: function () {
      console.log('[OnlyOffice] app ready');
      hideLoading();
    },
    onDocumentReady: function () { console.log('[OnlyOffice] document ready'); },
    onError: function (event) {
      console.error('[OnlyOffice] editor error', event);
      var desc = (event && event.data && (event.data.description || event.data.error || JSON.stringify(event.data))) || '未知错误';
      showError('OnlyOffice 编辑器错误：<br>' + escapeHTML(String(desc)) + '<br><br>' + DEPLOY_HINT + '<br><a href="javascript:history.back()">返回</a>');
    },
    onWarning: function (event) { console.warn('[OnlyOffice] warning', event); },
  };

  function mount() {
    try {
      new window.DocsAPI.DocEditor('placeholder', config);
    } catch (e) {
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
    const res = await fetch('/api/onlyoffice/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
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

init();
