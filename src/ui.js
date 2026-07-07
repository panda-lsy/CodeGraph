// UI 模态对话框工具
// 替换原生 prompt/alert/confirm（这些在某些环境如 TRAE Preview iframe 中不被支持）

// 创建模态对话框容器
function ensureContainer() {
  let container = document.getElementById('cg-modal-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'cg-modal-container';
    container.className = 'fixed inset-0 z-50 flex items-center justify-center pointer-events-none';
    document.body.appendChild(container);
  }
  return container;
}

// 注入模态样式（一次性）
let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cg-modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      backdrop-filter: blur(2px); pointer-events: auto;
      animation: cg-fade-in 0.15s ease-out;
    }
    .cg-modal-box {
      position: relative; pointer-events: auto;
      background: #fff; color: #0f172a;
      border-radius: 12px; padding: 20px; min-width: 360px; max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      animation: cg-pop-in 0.18s ease-out;
    }
    .dark .cg-modal-box { background: #1e293b; color: #e2e8f0; }
    .cg-modal-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
    .cg-modal-body { font-size: 13px; margin-bottom: 16px; white-space: pre-wrap; max-height: 50vh; overflow-y: auto; }
    .cg-modal-input {
      width: 100%; padding: 8px 12px; font-size: 13px;
      border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 16px;
      background: #fff; color: #0f172a;
    }
    .dark .cg-modal-input { background: #0f172a; border-color: #475569; color: #e2e8f0; }
    .cg-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .cg-modal-btn {
      padding: 6px 16px; font-size: 13px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent; transition: all 0.15s;
    }
    .cg-modal-btn-primary { background: #6366f1; color: #fff; }
    .cg-modal-btn-primary:hover { background: #4f46e5; }
    .cg-modal-btn-secondary { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
    .dark .cg-modal-btn-secondary { background: #334155; color: #e2e8f0; border-color: #475569; }
    .cg-modal-btn-secondary:hover { background: #e2e8f0; }
    .dark .cg-modal-btn-secondary:hover { background: #475569; }
    .cg-modal-list { max-height: 240px; overflow-y: auto; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 6px; }
    .dark .cg-modal-list { border-color: #334155; }
    .cg-modal-list-item { padding: 8px 12px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #f1f5f9; }
    .cg-modal-list-item:last-child { border-bottom: none; }
    .cg-modal-list-item:hover { background: #e0e7ff; }
    .dark .cg-modal-list-item { border-bottom-color: #1e293b; }
    .dark .cg-modal-list-item:hover { background: #312e81; }
    @keyframes cg-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes cg-pop-in { from { opacity: 0; transform: scale(0.95) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
  `;
  document.head.appendChild(style);
}

// 通用模态：返回 Promise，用户操作后 resolve
function showModal({ title, body, input, list, okText = '确定', cancelText = '取消' }) {
  injectStyle();
  const container = ensureContainer();

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cg-modal-backdrop';
    const box = document.createElement('div');
    box.className = 'cg-modal-box';

    let html = '';
    if (title) html += `<div class="cg-modal-title">${title}</div>`;
    if (body) html += `<div class="cg-modal-body">${body}</div>`;
    if (list && list.length) {
      html += `<div class="cg-modal-list">`;
      list.forEach((item, i) => {
        html += `<div class="cg-modal-list-item" data-idx="${i}">${item.label}</div>`;
      });
      html += `</div>`;
    }
    if (input !== undefined) {
      html += `<input type="text" class="cg-modal-input" id="cg-modal-input-el" value="${String(input).replace(/"/g, '&quot;')}"/>`;
    }
    html += `<div class="cg-modal-actions">`;
    if (cancelText) html += `<button class="cg-modal-btn cg-modal-btn-secondary" data-action="cancel">${cancelText}</button>`;
    html += `<button class="cg-modal-btn cg-modal-btn-primary" data-action="ok">${okText}</button>`;
    html += `</div>`;
    box.innerHTML = html;
    backdrop.appendChild(box);
    container.appendChild(backdrop);

    // 输入框聚焦选中
    if (input !== undefined) {
      const el = box.querySelector('#cg-modal-input-el');
      if (el) { el.focus(); el.select(); }
    }

    function close(result) {
      backdrop.remove();
      resolve(result);
    }

    backdrop.addEventListener('click', e => {
      const target = e.target;
      if (target.dataset.action === 'ok') {
        if (input !== undefined) {
          const el = box.querySelector('#cg-modal-input-el');
          close(el ? el.value : '');
        } else {
          close(true);
        }
      } else if (target.dataset.action === 'cancel') {
        close(input !== undefined ? null : false);
      } else if (target.dataset.idx !== undefined) {
        const idx = parseInt(target.dataset.idx, 10);
        close(list[idx].value);
      } else if (target === backdrop) {
        close(input !== undefined ? null : false);
      }
    });

    // 回车确认
    if (input !== undefined) {
      const el = box.querySelector('#cg-modal-input-el');
      if (el) el.addEventListener('keydown', e => {
        if (e.key === 'Enter') close(el.value);
        if (e.key === 'Escape') close(null);
      });
    }
  });
}

// 对外接口（兼容原生 prompt/alert/confirm 签名）
export async function prompt(message, defaultValue = '') {
  const result = await showModal({ title: message, input: defaultValue, okText: '确定', cancelText: '取消' });
  return result; // 字符串或 null
}

export async function alert(message) {
  await showModal({ body: message, okText: '确定', cancelText: '' });
}

export async function confirm(message) {
  return await showModal({ body: message, okText: '确定', cancelText: '取消' });
}

// 选择列表（替代 prompt 输入序号）
export async function select(title, items) {
  // items: [{label, value}]
  return await showModal({ title, list: items, okText: '取消', cancelText: '' });
}
