/* xCloud · IE 兼容页逻辑（ES5，无箭头函数 / 无 Promise / 无 fetch） */
'use strict';

var currentPath = '/';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function xhr(method, url, jsonData, callback) {
  var x = new XMLHttpRequest();
  x.open(method, url, true);
  x.onreadystatechange = function () {
    if (x.readyState === 4) {
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
      callback(x.status, data);
    }
  };
  if (jsonData) {
    x.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    x.send(JSON.stringify(jsonData));
  } else {
    x.send();
  }
}

function setErr(id, msg) {
  document.getElementById(id).innerHTML = msg ? esc(msg) : '';
}

function showLogin() {
  document.getElementById('login-box').style.display = 'block';
  document.getElementById('files-box').style.display = 'none';
}
function showFiles() {
  document.getElementById('login-box').style.display = 'none';
  document.getElementById('files-box').style.display = 'block';
}

function checkStatus() {
  xhr('GET', '/api/status', null, function (status, data) {
    if (status === 200 && data && data.initialized && data.authenticated) {
      showFiles();
      loadFiles('/');
    } else if (status === 200 && data && data.initialized && !data.authenticated) {
      showLogin();
    } else if (status === 200 && data && !data.initialized) {
      showLogin();
      setErr('login-err', '尚未初始化。请先用现代浏览器访问本面板完成管理员账户创建。');
    } else {
      showLogin();
      setErr('login-err', '无法连接服务器');
    }
  });
}

function doLogin() {
  var u = document.getElementById('u').value;
  var p = document.getElementById('p').value;
  if (!u || !p) { setErr('login-err', '请输入用户名和密码'); return; }
  setErr('login-err', '');
  xhr('POST', '/api/login', { username: u, password: p }, function (status, data) {
    if (status === 200) { showFiles(); loadFiles('/'); }
    else setErr('login-err', (data && data.error) ? data.error : '登录失败');
  });
}

function logout() {
  xhr('POST', '/api/logout', null, function () { showLogin(); });
}

function joinPath(dir, name) {
  if (dir === '/' || dir === '') return '/' + name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

function fmtTime(ms) {
  var d = new Date(ms);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function iconClass(ext) {
  var e = String(ext || '').toLowerCase();
  if (e === 'doc' || e === 'docx' || e === 'odt' || e === 'rtf' || e === 'txt') return 'word';
  if (e === 'xls' || e === 'xlsx' || e === 'ods' || e === 'csv') return 'cell';
  if (e === 'ppt' || e === 'pptx' || e === 'odp') return 'slide';
  if (e === 'pdf') return 'pdf';
  return 'file';
}

function loadFiles(path) {
  currentPath = path || '/';
  xhr('GET', '/api/files?path=' + encodeURIComponent(currentPath), null, function (status, data) {
    if (status === 401) { showLogin(); return; }
    if (status !== 200) { setErr('files-err', (data && data.error) ? data.error : '加载失败'); return; }
    setErr('files-err', '');
    document.getElementById('upload-path').value = currentPath;
    renderCrumbs(data);
    renderList(data);
  });
}

function renderCrumbs(data) {
  var wrap = document.getElementById('crumbs');
  var html = '<a href="javascript:void(0)" onclick="loadFiles(\'\')">全部文件</a>';
  var path = data.path || '/';
  if (path !== '/') {
    var parts = path.split('/');
    var acc = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      acc += '/' + parts[i];
      html += '<span class="sep">›</span>';
      if (i === parts.length - 1) {
        html += '<span class="cur">' + esc(parts[i]) + '</span>';
      } else {
        html += '<a href="javascript:void(0)" data-path="' + esc(acc) + '" onclick="loadFiles(this.getAttribute(\'data-path\'))">' + esc(parts[i]) + '</a>';
      }
    }
  }
  wrap.innerHTML = html;
}

function renderList(data) {
  var ul = document.getElementById('file-list');
  var items = data.items || [];
  if (items.length === 0) {
    ul.innerHTML = '<div class="empty">此文件夹为空，点击右上角「上传文件」添加。</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var rel = joinPath(data.path, it.name);
    var time = fmtTime(it.mtime);
    if (it.type === 'dir') {
      html += '<li>' +
        '<span class="f-name"><a href="javascript:void(0)" data-path="' + esc(rel) + '" onclick="loadFiles(this.getAttribute(\'data-path\'))"><span class="f-icon dir">夹</span>' + esc(it.name) + '</a></span>' +
        '<span class="f-size">&nbsp;</span>' +
        '<span class="f-time">' + time + '</span>' +
        '<span class="f-op">' +
        '<a href="javascript:void(0)" data-path="' + esc(rel) + '" data-name="' + esc(it.name) + '" onclick="renameItem(this)">重命名</a>' +
        '<a href="javascript:void(0)" class="del" data-path="' + esc(rel) + '" data-name="' + esc(it.name) + '" onclick="deleteItem(this)">删除</a>' +
        '</span></li>';
    } else {
      var dl = '/api/files/download?path=' + encodeURIComponent(rel);
      var cls = iconClass(it.ext);
      var tag = String(it.ext || 'file').toUpperCase().substring(0, 4);
      html += '<li>' +
        '<span class="f-name"><a href="' + dl + '"><span class="f-icon ' + cls + '">' + esc(tag) + '</span>' + esc(it.name) + '</a></span>' +
        '<span class="f-size">' + esc(it.sizeText || '') + '</span>' +
        '<span class="f-time">' + time + '</span>' +
        '<span class="f-op">' +
        '<a href="' + dl + '">下载</a>' +
        '<a href="javascript:void(0)" data-path="' + esc(rel) + '" data-name="' + esc(it.name) + '" onclick="renameItem(this)">重命名</a>' +
        '<a href="javascript:void(0)" class="del" data-path="' + esc(rel) + '" data-name="' + esc(it.name) + '" onclick="deleteItem(this)">删除</a>' +
        '</span></li>';
    }
  }
  ul.innerHTML = html;
}

function deleteItem(el) {
  var rel = el.getAttribute('data-path');
  var name = el.getAttribute('data-name');
  if (!window.confirm('确定删除「' + name + '」？此操作不可撤销。')) return;
  xhr('POST', '/api/files/delete', { path: rel }, function (status, data) {
    if (status === 401) { showLogin(); return; }
    if (status === 200) loadFiles(currentPath);
    else setErr('files-err', (data && data.error) ? data.error : '删除失败');
  });
}

function renameItem(el) {
  var rel = el.getAttribute('data-path');
  var name = el.getAttribute('data-name');
  var newName = window.prompt('重命名为：', name);
  if (!newName) return;
  newName = newName.replace(/^\s+|\s+$/g, '');
  if (!newName || newName === name) return;
  xhr('POST', '/api/files/rename', { path: rel, name: newName }, function (status, data) {
    if (status === 401) { showLogin(); return; }
    if (status === 200) loadFiles(currentPath);
    else setErr('files-err', (data && data.error) ? data.error : '重命名失败');
  });
}

function mkdir() {
  var name = window.prompt('新建文件夹名称：');
  if (!name) return;
  name = name.replace(/^\s+|\s+$/g, '');
  if (!name) return;
  xhr('POST', '/api/files/mkdir', { path: currentPath, name: name }, function (status, data) {
    if (status === 401) { showLogin(); return; }
    if (status === 200) loadFiles(currentPath);
    else setErr('files-err', (data && data.error) ? data.error : '创建失败');
  });
}

function bindUpload() {
  var fileInput = document.getElementById('upload-file');
  var form = document.getElementById('upload-form');
  var frame = document.getElementById('upload-frame');
  fileInput.onchange = function () {
    document.getElementById('upload-path').value = currentPath;
    if (fileInput.value) form.submit();
  };
  frame.onload = function () {
    loadFiles(currentPath);
    fileInput.value = '';
  };
}

function init() {
  document.getElementById('btn-login').onclick = doLogin;
  document.getElementById('btn-logout').onclick = logout;
  document.getElementById('btn-mkdir').onclick = mkdir;
  var u = document.getElementById('u');
  var p = document.getElementById('p');
  u.onkeydown = function (e) { e = e || window.event; if (e.keyCode === 13) doLogin(); };
  p.onkeydown = function (e) { e = e || window.event; if (e.keyCode === 13) doLogin(); };
  bindUpload();
  checkStatus();
}

if (window.addEventListener) window.addEventListener('load', init, false);
else window.attachEvent('onload', init);
