console.log('🔍 [SQR] Content script starting...');

// Inject external script to bypass CSP
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
  console.log('🔍 [SQR] inject.js loaded successfully');
  this.remove();
};
script.onerror = function(e) {
  console.error('🔍 [SQR] Failed to load inject.js:', e);
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'SQR_QUERIES') {
    console.log('🔍 [SQR] Received queries:', event.data.queries);
    showQueries(event.data.queries);
  }
});

let panel = null;

function createPanel() {
  if (panel) return panel;
  
  panel = document.createElement('div');
  panel.id = 'sqr-panel';
  panel.innerHTML = `
    <div class="sqr-header">
      <span>🔍 Search Queries</span>
      <div>
        <button class="sqr-min">−</button>
        <button class="sqr-close">×</button>
      </div>
    </div>
    <div class="sqr-content">
      <div class="sqr-empty">Waiting for ChatGPT to search...</div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #sqr-panel{position:fixed;bottom:20px;right:20px;width:340px;max-height:400px;background:#1e1e1e;border:1px solid #444;border-radius:12px;font-family:system-ui,sans-serif;font-size:13px;color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:999999;overflow:hidden}
    #sqr-panel.min .sqr-content{display:none}
    .sqr-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move}
    .sqr-header button{background:#444;border:none;color:#e0e0e0;width:24px;height:24px;border-radius:6px;cursor:pointer;margin-left:6px}
    .sqr-header button:hover{background:#555}
    .sqr-content{padding:12px;max-height:320px;overflow-y:auto}
    .sqr-empty{color:#888;text-align:center;padding:20px}
    .sqr-group{margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #333}
    .sqr-group:last-child{border-bottom:none}
    .sqr-time{font-size:10px;color:#888;margin-bottom:8px}
    .sqr-query{background:#2d4a3e;border-left:3px solid #4ade80;padding:8px 10px;margin:6px 0;border-radius:0 6px 6px 0;font-family:monospace;font-size:12px;cursor:pointer;word-break:break-word}
    .sqr-query:hover{background:#3d5a4e}
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  panel.querySelector('.sqr-close').onclick = () => panel.style.display = 'none';
  panel.querySelector('.sqr-min').onclick = () => {
    panel.classList.toggle('min');
    panel.querySelector('.sqr-min').textContent = panel.classList.contains('min') ? '+' : '−';
  };

  // Dragging
  let dragging = false, x, y;
  panel.querySelector('.sqr-header').onmousedown = (e) => {
    dragging = true; x = e.clientX; y = e.clientY;
  };
  document.onmousemove = (e) => {
    if (!dragging) return;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = (panel.offsetLeft + e.clientX - x) + 'px';
    panel.style.top = (panel.offsetTop + e.clientY - y) + 'px';
    x = e.clientX; y = e.clientY;
  };
  document.onmouseup = () => dragging = false;

  return panel;
}

function showQueries(queries) {
  if (!panel) createPanel();
  panel.style.display = 'block';
  const content = panel.querySelector('.sqr-content');
  const empty = content.querySelector('.sqr-empty');
  if (empty) empty.remove();

  const group = document.createElement('div');
  group.className = 'sqr-group';
  group.innerHTML = '<div class="sqr-time">' + new Date().toLocaleTimeString() + '</div>' +
    queries.map(q => '<div class="sqr-query">' + q.replace(/</g,'&lt;') + '</div>').join('');
  content.insertBefore(group, content.firstChild);

  group.querySelectorAll('.sqr-query').forEach(el => {
    el.onclick = () => {
      navigator.clipboard.writeText(el.textContent);
      el.style.background = '#4ade80';
      el.style.color = '#000';
      setTimeout(() => { el.style.background = ''; el.style.color = ''; }, 1000);
    };
  });

  chrome.storage.local.get(['queryHistory'], (result) => {
    const history = result.queryHistory || [];
    history.unshift({ time: new Date().toISOString(), queries });
    if (history.length > 50) history.pop();
    chrome.storage.local.set({ queryHistory: history });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(createPanel, 500));
} else {
  setTimeout(createPanel, 500);
}

console.log('🔍 [SQR] Content script loaded');