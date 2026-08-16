'use strict';

/* OnlyOffice 编辑器加载 */
const params = new URLSearchParams(location.search);
const filePath = params.get('path') || '';

function showError(msg) {
  document.getElementById('loading').hidden = true;
  const e = document.getElementById('error');
  e.innerHTML = msg;
  e.hidden = false;
}

const DEPLOY_HINT =
  '先启动 OnlyOffice Document Server：<br>' +
  '<code style="display:inline-block;background:#f2f2f7;padding:4px 10px;border-radius:8px;margin:6px 0">docker compose up -d onlyoffice</code><br>' +
  '或单独运行：<code style="display:inline-block;background:#f2f2f7;padding:4px 10px;border-radius:8px;margin:6px 0">docker run -d -p 8080:80 onlyoffice/documentserver</code>';

function loadEditor(ooUrl, config) {
  const script = document.createElement('script');
  script.src = ooUrl.replace(/\/+$/, '') + '/web-apps/apps/api/documents/api.js';
  script.onload = () => {
    document.getElementById('loading').hidden = true;
    new window.DocsAPI.DocEditor('placeholder', config);
  };
  script.onerror = () =>
    showError(
      `无法连接 OnlyOffice 服务（${escapeHTML(ooUrl)}）。<br>请确认服务已启动、且该地址在浏览器中可访问。<br>${DEPLOY_HINT}<br><a href="javascript:history.back()">返回</a>`
    );
  document.body.appendChild(script);
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function init() {
  if (!filePath) { showError('缺少文件路径参数。<br><a href="javascript:history.back()">返回</a>'); return; }
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
    loadEditor(data.onlyofficeUrl, data.config);
  } catch (e) {
    showError('无法连接服务器，请确认面板已启动。<br><a href="javascript:history.back()">返回</a>');
  }
}

init();
