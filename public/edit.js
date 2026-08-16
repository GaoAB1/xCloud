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

function loadEditor(ooUrl, config) {
  const script = document.createElement('script');
  script.src = ooUrl.replace(/\/+$/, '') + '/web-apps/apps/api/documents/api.js';
  script.onload = () => {
    document.getElementById('loading').hidden = true;
    new window.DocsAPI.DocEditor('placeholder', config);
  };
  script.onerror = () => showError('无法加载 OnlyOffice 编辑器，请检查 OnlyOffice 服务是否已启动、地址是否可访问。<br><a href="javascript:history.back()">返回</a>');
  document.body.appendChild(script);
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
    loadEditor(data.onlyofficeUrl, data.config);
  } catch (e) {
    showError('无法连接服务器，请确认面板已启动。<br><a href="javascript:history.back()">返回</a>');
  }
}

init();
