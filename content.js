console.log('🔍 [SQR] Content script starting...');

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

let panel = null;
let currentTab = 'queries';
let latestData = null;
let batchState = {
  running: false,
  prompts: [],
  results: [],
  index: 0
};

// Restore batch state on load
chrome.storage.local.get(['batchState'], (result) => {
  if (result.batchState) {
    batchState = result.batchState;
    console.log('🔍 [SQR] Restored batch state:', batchState);
    if (batchState.running) {
      setTimeout(() => continueBatch(), 3000);
    }
  }
});

function saveBatchState() {
  chrome.storage.local.set({ batchState });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'SQR_DATA') {
    console.log('🔍 [SQR] Received data:', event.data.data);
    showData(event.data.data);
    
    // If batch is running, save/merge result
    if (batchState.running && batchState.index > 0) {
      const promptIndex = batchState.index - 1;
      const incoming = event.data.data;
      
      // Merge with existing result (scores and queries may come separately)
      if (!batchState.results[promptIndex]) {
        batchState.results[promptIndex] = {
          prompt: batchState.prompts[promptIndex],
          queries: [],
          scores: null,
          sourcesRetrieved: [],
          sourcesCited: [],
          searchTurns: null,
          timestamp: new Date().toISOString()
        };
      }
      
      const r = batchState.results[promptIndex];
      if (incoming.queries && incoming.queries.length) r.queries = incoming.queries;
      if (incoming.scores) r.scores = incoming.scores;
      if (incoming.sourcesRetrieved && incoming.sourcesRetrieved.length) r.sourcesRetrieved = incoming.sourcesRetrieved;
      if (incoming.sourcesCited && incoming.sourcesCited.length) r.sourcesCited = incoming.sourcesCited;
      if (incoming.searchTurns) r.searchTurns = incoming.searchTurns;
      
      saveBatchState();
      updateBatchUI();
    }
  }
});

function createPanel() {
  if (panel) return panel;
  
  panel = document.createElement('div');
  panel.id = 'sqr-panel';
  panel.innerHTML = `
    <div class="sqr-header">
      <span>🔍 Sandbox AI SEO Extension</span>
      <div>
        <button class="sqr-min">−</button>
        <button class="sqr-close">×</button>
      </div>
    </div>
    <div class="sqr-tabs">
      <button class="sqr-tab active" data-tab="queries">Queries</button>
      <button class="sqr-tab" data-tab="scores">Scores</button>
      <button class="sqr-tab" data-tab="retrieved">Retrieved</button>
      <button class="sqr-tab" data-tab="cited">Cited</button>
      <button class="sqr-tab" data-tab="batch">Batch</button>
    </div>
    <div class="sqr-content">
      <div class="sqr-empty">Waiting for ChatGPT to search...</div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #sqr-panel{position:fixed;bottom:20px;right:20px;width:380px;max-height:500px;background:#1e1e1e;border:1px solid #444;border-radius:12px;font-family:system-ui,sans-serif;font-size:13px;color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:999999;overflow:hidden}
    #sqr-panel.min .sqr-content,#sqr-panel.min .sqr-tabs{display:none}
    .sqr-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move}
    .sqr-header button{background:#444;border:none;color:#e0e0e0;width:24px;height:24px;border-radius:6px;cursor:pointer;margin-left:6px}
    .sqr-header button:hover{background:#555}
    .sqr-tabs{display:flex;background:#252525;border-bottom:1px solid #444}
    .sqr-tab{flex:1;padding:8px 4px;background:none;border:none;color:#888;cursor:pointer;font-size:11px;border-bottom:2px solid transparent}
    .sqr-tab:hover{color:#ccc}
    .sqr-tab.active{color:#4ade80;border-bottom-color:#4ade80}
    .sqr-content{padding:12px;max-height:380px;overflow-y:auto}
    .sqr-empty{color:#888;text-align:center;padding:20px}
    .sqr-time{font-size:10px;color:#888;margin-bottom:8px}
    .sqr-query{background:#2d4a3e;border-left:3px solid #4ade80;padding:8px 10px;margin:6px 0;border-radius:0 6px 6px 0;font-family:monospace;font-size:12px;cursor:pointer;word-break:break-word}
    .sqr-query:hover{background:#3d5a4e}
    .sqr-score-grid{display:grid;gap:8px}
    .sqr-score{background:#2a2a2a;border-radius:8px;padding:12px}
    .sqr-score-label{font-size:11px;color:#888;margin-bottom:4px}
    .sqr-score-value{font-size:24px;font-weight:600;color:#4ade80}
    .sqr-score.low .sqr-score-value{color:#888}
    .sqr-score.med .sqr-score-value{color:#fbbf24}
    .sqr-source{background:#2a2a2a;border-radius:8px;padding:10px;margin:8px 0}
    .sqr-source-title{color:#4ade80;font-size:12px;margin-bottom:4px;word-break:break-word}
    .sqr-source-domain{font-size:11px;color:#888;margin-bottom:6px}
    .sqr-source-snippet{font-size:11px;color:#aaa;line-height:1.4}
    .sqr-source a{color:#4ade80;text-decoration:none}
    .sqr-source a:hover{text-decoration:underline}
    .sqr-count{font-size:11px;color:#888;margin-bottom:8px}
    .sqr-batch-input{width:100%;height:120px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#e0e0e0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:10px}
    .sqr-batch-input::placeholder{color:#666}
    .sqr-btn{padding:10px 16px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;margin-right:8px;margin-bottom:8px}
    .sqr-btn-primary{background:#4ade80;color:#000}
    .sqr-btn-primary:hover{background:#5eeb94}
    .sqr-btn-danger{background:#ef4444;color:#fff}
    .sqr-btn-danger:hover{background:#f87171}
    .sqr-btn-secondary{background:#444;color:#e0e0e0}
    .sqr-btn-secondary:hover{background:#555}
    .sqr-progress{background:#2a2a2a;border-radius:8px;padding:12px;margin:10px 0}
    .sqr-progress-bar{height:8px;background:#333;border-radius:4px;overflow:hidden;margin:8px 0}
    .sqr-progress-fill{height:100%;background:#4ade80;transition:width 0.3s}
    .sqr-progress-text{font-size:11px;color:#888}
    .sqr-result-item{background:#2a2a2a;border-radius:8px;padding:10px;margin:6px 0;font-size:11px}
    .sqr-result-prompt{color:#4ade80;margin-bottom:4px;font-family:monospace}
    .sqr-result-queries{color:#888}
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  panel.querySelector('.sqr-close').onclick = () => panel.style.display = 'none';
  panel.querySelector('.sqr-min').onclick = () => {
    panel.classList.toggle('min');
    panel.querySelector('.sqr-min').textContent = panel.classList.contains('min') ? '+' : '−';
  };

  panel.querySelectorAll('.sqr-tab').forEach(tab => {
    tab.onclick = () => {
      panel.querySelectorAll('.sqr-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderCurrentTab();
    };
  });

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

function showData(data) {
  if (!panel) createPanel();
  panel.style.display = 'block';
  
  if (!latestData) {
    latestData = { queries: [], scores: null, sourcesRetrieved: [], sourcesCited: [], searchTurns: null, timestamp: new Date().toLocaleTimeString() };
  }
  
  if (data.queries.length) latestData.queries = data.queries;
  if (data.scores) latestData.scores = data.scores;
  if (data.sourcesRetrieved.length) latestData.sourcesRetrieved = data.sourcesRetrieved;
  if (data.sourcesCited.length) latestData.sourcesCited = data.sourcesCited;
  if (data.searchTurns) latestData.searchTurns = data.searchTurns;
  latestData.timestamp = new Date().toLocaleTimeString();
  
  if (currentTab !== 'batch') renderCurrentTab();
  
  chrome.storage.local.get(['queryHistory'], (result) => {
    const history = result.queryHistory || [];
    history.unshift(latestData);
    if (history.length > 50) history.pop();
    chrome.storage.local.set({ queryHistory: history });
  });
}

function renderCurrentTab() {
  if (!panel) return;
  const content = panel.querySelector('.sqr-content');
  
  switch(currentTab) {
    case 'queries':
      content.innerHTML = renderQueries();
      content.querySelectorAll('.sqr-query').forEach(el => {
        el.onclick = () => {
          navigator.clipboard.writeText(el.textContent);
          el.style.background = '#4ade80';
          el.style.color = '#000';
          setTimeout(() => { el.style.background = ''; el.style.color = ''; }, 1000);
        };
      });
      break;
    case 'scores':
      content.innerHTML = renderScores();
      break;
    case 'retrieved':
      content.innerHTML = renderRetrieved();
      break;
    case 'cited':
      content.innerHTML = renderCited();
      break;
    case 'batch':
      content.innerHTML = renderBatch();
      attachBatchListeners();
      break;
  }
}

function renderQueries() {
  if (!latestData || !latestData.queries.length) {
    return '<div class="sqr-empty">No queries captured yet</div>';
  }
  return `
    <div class="sqr-time">${latestData.timestamp}</div>
    ${latestData.queries.map(q => `<div class="sqr-query">${esc(q)}</div>`).join('')}
  `;
}

function renderScores() {
  if (!latestData || !latestData.scores) {
    return '<div class="sqr-empty">No classification scores yet</div>';
  }
  const s = latestData.scores;
  return `
    <div class="sqr-time">${latestData.timestamp}</div>
    <div class="sqr-score-grid">
      <div class="sqr-score ${parseFloat(s.simpleSearch) > 50 ? '' : 'low'}">
        <div class="sqr-score-label">Simple Search Probability</div>
        <div class="sqr-score-value">${s.simpleSearch}%</div>
      </div>
      <div class="sqr-score ${parseFloat(s.complexSearch) > 20 ? 'med' : 'low'}">
        <div class="sqr-score-label">Complex Search Probability</div>
        <div class="sqr-score-value">${s.complexSearch}%</div>
      </div>
      <div class="sqr-score ${parseFloat(s.noSearch) > 50 ? '' : 'low'}">
        <div class="sqr-score-label">No Search Probability</div>
        <div class="sqr-score-value">${s.noSearch}%</div>
      </div>
      ${latestData.searchTurns ? `
      <div class="sqr-score">
        <div class="sqr-score-label">Search Turns</div>
        <div class="sqr-score-value">${latestData.searchTurns}</div>
      </div>
      ` : ''}
    </div>
  `;
}

function renderRetrieved() {
  if (!latestData || !latestData.sourcesRetrieved.length) {
    return '<div class="sqr-empty">No sources retrieved yet</div>';
  }
  return `
    <div class="sqr-count">${latestData.sourcesRetrieved.length} sources retrieved</div>
    ${latestData.sourcesRetrieved.slice(0, 20).map(s => `
      <div class="sqr-source">
        <div class="sqr-source-title"><a href="${esc(s.url)}" target="_blank">${esc(s.title)}</a></div>
        <div class="sqr-source-domain">${esc(s.domain)}</div>
        ${s.snippet ? `<div class="sqr-source-snippet">${esc(s.snippet).substring(0, 150)}...</div>` : ''}
      </div>
    `).join('')}
    ${latestData.sourcesRetrieved.length > 20 ? `<div class="sqr-count">...and ${latestData.sourcesRetrieved.length - 20} more</div>` : ''}
  `;
}

function renderCited() {
  if (!latestData || !latestData.sourcesCited.length) {
    return '<div class="sqr-empty">No sources cited yet</div>';
  }
  return `
    <div class="sqr-count">${latestData.sourcesCited.length} sources cited in answer</div>
    ${latestData.sourcesCited.map(s => `
      <div class="sqr-source">
        <div class="sqr-source-title"><a href="${esc(s.url)}" target="_blank">${esc(s.title)}</a></div>
        <div class="sqr-source-domain">${esc(s.attribution)}</div>
      </div>
    `).join('')}
  `;
}

function renderBatch() {
  if (batchState.running) {
    const pct = batchState.prompts.length > 0 ? Math.round((batchState.index / batchState.prompts.length) * 100) : 0;
    const completed = batchState.results.filter(r => r).length;
    return `
      <div class="sqr-progress">
        <div class="sqr-progress-text">Running: ${batchState.index} / ${batchState.prompts.length} prompts</div>
        <div class="sqr-progress-bar"><div class="sqr-progress-fill" style="width:${pct}%"></div></div>
        <div class="sqr-progress-text">Current: ${esc(batchState.prompts[batchState.index] || 'Waiting...')}</div>
      </div>
      <button class="sqr-btn sqr-btn-danger" id="sqr-batch-stop">Stop Batch</button>
      ${completed > 0 ? `<div class="sqr-count" style="margin-top:12px">${completed} results collected so far</div>` : ''}
    `;
  }
  
  const completed = batchState.results.filter(r => r).length;
  if (completed > 0) {
    return `
      <div class="sqr-count">${completed} results collected</div>
      <button class="sqr-btn sqr-btn-primary" id="sqr-batch-export">Export CSV</button>
      <button class="sqr-btn sqr-btn-secondary" id="sqr-batch-clear">Clear & New Batch</button>
      <div style="margin-top:12px;max-height:200px;overflow-y:auto">
        ${batchState.results.filter(r => r).slice(0, 10).map(r => `
          <div class="sqr-result-item">
            <div class="sqr-result-prompt">${esc(r.prompt)}</div>
            <div class="sqr-result-queries">→ ${r.queries && r.queries.length ? r.queries.map(q => esc(q)).join(', ') : '<em>No search triggered</em>'}</div>
          </div>
        `).join('')}
        ${completed > 10 ? `<div class="sqr-count">...and ${completed - 10} more</div>` : ''}
      </div>
    `;
  }
  
  return `
    <div style="margin-bottom:10px;color:#aaa;font-size:12px">Enter prompts (one per line):</div>
    <textarea class="sqr-batch-input" id="sqr-batch-prompts" placeholder="What is the best CRM for small business?
How do I improve my SEO?
Best project management tools 2025"></textarea>
    <div style="margin-bottom:10px;color:#888;font-size:11px">
      ⚠️ Opens a new chat for each prompt. ~10 sec delay between prompts.
    </div>
    <button class="sqr-btn sqr-btn-primary" id="sqr-batch-start">Start Batch</button>
  `;
}

function updateBatchUI() {
  if (currentTab === 'batch' && panel) {
    renderCurrentTab();
  }
}

function attachBatchListeners() {
  const startBtn = document.getElementById('sqr-batch-start');
  const stopBtn = document.getElementById('sqr-batch-stop');
  const exportBtn = document.getElementById('sqr-batch-export');
  const clearBtn = document.getElementById('sqr-batch-clear');
  
  if (startBtn) {
    startBtn.onclick = () => {
      const textarea = document.getElementById('sqr-batch-prompts');
      const prompts = textarea.value.split('\n').map(p => p.trim()).filter(p => p.length > 0);
      if (prompts.length === 0) {
        alert('Please enter at least one prompt');
        return;
      }
      batchState = {
        running: true,
        prompts: prompts,
        results: new Array(prompts.length).fill(null),
        index: 0
      };
      saveBatchState();
      renderCurrentTab();
      runNextPrompt();
    };
  }
  
  if (stopBtn) {
    stopBtn.onclick = () => {
      batchState.running = false;
      saveBatchState();
      renderCurrentTab();
    };
  }
  
  if (exportBtn) {
    exportBtn.onclick = exportBatchCSV;
  }
  
  if (clearBtn) {
    clearBtn.onclick = () => {
      batchState = { running: false, prompts: [], results: [], index: 0 };
      saveBatchState();
      renderCurrentTab();
    };
  }
}

async function continueBatch() {
  console.log('🔍 [SQR] Continuing batch from index:', batchState.index);
  
  if (!batchState.running) return;
  
  // Wait for page to stabilize
  await sleep(2000);
  
  // Check if we're on a fresh page (need to enter prompt)
  const isNewChat = window.location.pathname === '/' || !window.location.pathname.includes('/c/');
  
  if (isNewChat && batchState.index < batchState.prompts.length) {
    // Initialize result for this prompt (in case no search happens)
    if (!batchState.results[batchState.index]) {
      batchState.results[batchState.index] = {
        prompt: batchState.prompts[batchState.index],
        queries: [],
        scores: null,
        sourcesRetrieved: [],
        sourcesCited: [],
        searchTurns: null,
        timestamp: new Date().toISOString()
      };
      saveBatchState();
    }
    
    await enterPrompt(batchState.prompts[batchState.index]);
    batchState.index++;
    saveBatchState();
  }
  
  // Wait for response
  await waitForResponse();
  await sleep(2000);
  
  // Check if more prompts
  if (batchState.index < batchState.prompts.length && batchState.running) {
    // Navigate to new chat for next prompt
    setTimeout(() => {
      window.location.href = 'https://chatgpt.com/';
    }, 3000);
  } else {
    // Done
    batchState.running = false;
    saveBatchState();
    updateBatchUI();
  }
}

async function runNextPrompt() {
  if (!batchState.running || batchState.index >= batchState.prompts.length) {
    batchState.running = false;
    saveBatchState();
    updateBatchUI();
    return;
  }
  
  // Navigate to new chat
  window.location.href = 'https://chatgpt.com/';
}

async function enterPrompt(prompt) {
  console.log('🔍 [SQR] Entering prompt:', prompt);
  
  // Wait for input to appear
  let input = null;
  for (let i = 0; i < 20; i++) {
    input = document.querySelector('#prompt-textarea') || 
            document.querySelector('textarea[placeholder]') ||
            document.querySelector('[contenteditable="true"][data-placeholder]');
    if (input) break;
    await sleep(500);
  }
  
  if (!input) {
    console.error('🔍 [SQR] Could not find input');
    return;
  }
  
  // Focus and enter text
  input.focus();
  
  // Use execCommand for contenteditable or value for textarea
  if (input.tagName === 'TEXTAREA') {
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('insertText', false, prompt);
  }
  
  await sleep(500);
  
  // Find send button
  const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                  document.querySelector('button[aria-label*="Send"]') ||
                  document.querySelector('form button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => b.querySelector('svg path[d*="M15.192"]'));
  
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
    console.log('🔍 [SQR] Clicked send button');
  } else {
    // Try Enter key
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    console.log('🔍 [SQR] Pressed Enter key');
  }
}

async function waitForResponse() {
  console.log('🔍 [SQR] Waiting for response to complete...');
  
  // Wait for streaming to start
  await sleep(3000);
  
  // Wait for streaming to stop
  for (let i = 0; i < 120; i++) { // Max 2 minutes
    const isStreaming = document.querySelector('[data-testid="stop-button"]') ||
                        document.querySelector('[class*="result-streaming"]') ||
                        document.querySelector('[class*="streaming"]');
    
    if (!isStreaming) {
      console.log('🔍 [SQR] Response complete');
      return;
    }
    await sleep(1000);
  }
  
  console.log('🔍 [SQR] Response timeout');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exportBatchCSV() {
  const results = batchState.results.filter(r => r);
  if (results.length === 0) {
    alert('No results to export');
    return;
  }
  
  let csv = 'Prompt,Queries,Simple Search %,Complex Search %,No Search %,Search Turns,Sources Retrieved,Sources Cited,Timestamp\n';
  
  results.forEach(r => {
    const queries = (r.queries && r.queries.length) ? r.queries.join(' | ') : 'none';
    const simpleSearch = r.scores?.simpleSearch || 'n/a';
    const complexSearch = r.scores?.complexSearch || 'n/a';
    const noSearch = r.scores?.noSearch || 'n/a';
    const searchTurns = r.searchTurns || '0';
    const sourcesRetrieved = r.sourcesRetrieved ? r.sourcesRetrieved.length : 0;
    const sourcesCited = r.sourcesCited ? r.sourcesCited.length : 0;
    
    csv += `"${escCSV(r.prompt)}","${escCSV(queries)}","${simpleSearch}","${complexSearch}","${noSearch}","${searchTurns}","${sourcesRetrieved}","${sourcesCited}","${r.timestamp}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sandbox-batch-results-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escCSV(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '""');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(createPanel, 500));
} else {
  setTimeout(createPanel, 500);
}

console.log('🔍 [SQR] Content script loaded');