// Immediate feedback to verify script is loading
console.log('🔍 [SQR] Google content script starting...', window.location.href);
console.error('🔍 [SQR] SCRIPT LOADED - If you see this, the content script is running');

// Debug log storage
const debugLogs = [];
function debugLog(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { timestamp, message, data };
  debugLogs.push(logEntry);
  console.log(`🔍 [SQR] ${message}`, data || '');
  
  // Keep only last 50 entries
  if (debugLogs.length > 50) debugLogs.shift();
}


// Inject the interceptor script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('google-inject.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

let panel = null;
let currentTab = 'queries';
let latestData = null;
let geminiApiKey = null;

// Load API key
chrome.storage.sync.get(['geminiApiKey'], (result) => {
  if (result.geminiApiKey) {
    geminiApiKey = result.geminiApiKey;
    debugLog('Gemini API key loaded');
  } else {
    debugLog('No Gemini API key found');
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.geminiApiKey) {
    geminiApiKey = changes.geminiApiKey.newValue;
    debugLog('Gemini API key updated');
  }
});

// Detect when Google search is performed
let lastProcessedUrl = '';
const checkForSearch = () => {
  // Only process when URL has a search query (means search was submitted)
  const currentUrl = window.location.href;
  const urlParams = new URLSearchParams(window.location.search);
  const urlQuery = urlParams.get('q');
  
  // Check if we have a search query in URL and it's different from last processed
  if (urlQuery && currentUrl !== lastProcessedUrl) {
    lastProcessedUrl = currentUrl;
    
    // Clear previous data and debug logs
    latestData = null;
    debugLogs.length = 0;
    
    debugLog('New search detected', urlQuery);
    
    // Show panel immediately with "checking" status
    if (!panel) createPanel();
    panel.style.display = 'block';
    showData({
      queries: [],
      status: 'detecting',
      statusText: 'Detecting AI content...',
      source: 'Google Search',
      originalQuery: urlQuery,
      timestamp: new Date().toLocaleTimeString()
    });
    
    // Then check for AI overview
    detectAIOverview(urlQuery);
  }
};

// Check for AI overview presence
const detectAIOverview = async (searchQuery) => {
  // Wait a bit for the page to load
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Look for AI overview indicators - updated selectors
  const aiOverviewSelectors = [
    // Common AI Overview selectors
    '[data-attrid="SGESourcePanel"]',
    '[data-sge-overlay]',
    '[aria-label*="AI overview"]',
    '[aria-label*="AI Overview"]',
    '[aria-label*="Generative"]',
    '[aria-label*="generative"]',
    'div[jsname="ZjFb9c"]',
    'div[data-hveid][data-ved] h3:has-text("AI Overview")',
    
    // AI mode specific selectors
    'div[data-test-id="ai-response"]',
    'div[role="region"][aria-label*="generated"]',
    
    // Additional selectors for newer versions
    'div[data-sgeb]',
    'div.TQc1id', // AI overview container class
    'div[jscontroller][jsaction*="sge"]',
    'div[data-ved*="CAI"]', // Common in AI responses
    
    // Text-based detection
    'h2:has-text("AI Overview")',
    'div[role="heading"]:has-text("AI Overview")',
    
    // Container classes often used
    '.ixp7T', // AI overview wrapper
    '.LGOjhe', // AI attribution area
    
    // Check for AI-specific attributes
    '[data-ai-overview]',
    '[data-feature-type="ai_overview"]'
  ];
  
  let hasAIOverview = false;
  for (const selector of aiOverviewSelectors) {
    try {
      // Skip :has-text selectors as they need special handling
      if (selector.includes(':has-text')) continue;
      
      const element = document.querySelector(selector);
      if (element) {
        hasAIOverview = true;
        debugLog('AI overview detected with selector', selector);
        break;
      }
    } catch (e) {
      // Some selectors might throw errors, ignore them
    }
  }
  
  // Also check for AI Overview text content
  if (!hasAIOverview) {
    const headings = document.querySelectorAll('h1, h2, h3, div[role="heading"]');
    for (const heading of headings) {
      if (heading.textContent && heading.textContent.includes('AI Overview')) {
        hasAIOverview = true;
        debugLog('AI overview detected by text content');
        break;
      }
    }
  }
  
  // Check for AI-related class names
  if (!hasAIOverview) {
    const elements = document.querySelectorAll('*');
    for (const el of elements) {
      if (el.className && typeof el.className === 'string') {
        const className = el.className.toLowerCase();
        if (className.includes('ai-overview') || className.includes('sge') || className.includes('generative')) {
          hasAIOverview = true;
          debugLog('AI overview detected by class name', el.className);
          break;
        }
      }
    }
  }
  
  // Check URL parameters for AI mode
  const urlParams = new URLSearchParams(window.location.search);
  const isAIMode = urlParams.get('udm') === '50';
  
  if (hasAIOverview || isAIMode) {
    debugLog('AI overview/mode confirmed, calling Gemini API');
    debugLog('Mode', isAIMode ? 'AI Mode (udm=50)' : 'AI Overview');
    
    if (geminiApiKey) {
      // Update status to show API call
      showData({
        queries: [],
        status: 'calling',
        statusText: 'Calling Gemini Grounding API...',
        source: 'Google Search',
        mode: isAIMode ? 'ai-mode' : 'ai-overview',
        originalQuery: searchQuery,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Use different models based on the mode
      await callGeminiAPI(searchQuery, isAIMode);
    } else {
      showData({
        queries: [],
        error: 'Gemini API key not configured. Please set it in the extension settings.',
        source: 'Google AI',
        originalQuery: searchQuery
      });
    }
  } else {
    debugLog('No AI overview detected on this search');
    showData({
      queries: [],
      status: 'No AI overview detected. Try a search that triggers AI responses.',
      source: 'Google Search',
      mode: 'no-ai',
      originalQuery: searchQuery,
      timestamp: new Date().toLocaleTimeString()
    });
  }
};

// Call Gemini API with search grounding
async function callGeminiAPI(searchQuery, isAIMode = false) {
  try {
    // Select model based on mode
    // AI Mode (udm=50) uses gemini-2.5-pro for better match with AI mode content
    // Regular AI Overviews use gemini-2.5-flash for closer alignment
    const model = isAIMode ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    debugLog('Calling Gemini API', { model, query: searchQuery });
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: searchQuery
          }]
        }],
        tools: [{
          googleSearch: {}
        }],
        generationConfig: {
          temperature: 1.0,
          maxOutputTokens: 1000
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    
    // Extract search queries from the response
    const queries = extractQueriesFromResponse(data);
    debugLog('Gemini API response received', { queriesFound: queries.length });
    
    showData({
      queries: queries,
      source: isAIMode ? 'Google AI Mode (Gemini Pro)' : 'Google AI Overview (Gemini Flash)',
      model: model,
      mode: isAIMode ? 'ai-mode' : 'ai-overview',
      originalQuery: searchQuery,
      timestamp: new Date().toLocaleTimeString(),
      rawResponse: data
    });
    
  } catch (error) {
    debugLog('Gemini API error', error.message);
    showData({
      queries: [],
      error: error.message,
      source: 'Google AI',
      originalQuery: searchQuery
    });
  }
}

// Extract search queries from Gemini response
function extractQueriesFromResponse(response) {
  const queries = [];
  debugLog('Raw API response structure', JSON.stringify(response, null, 2).substring(0, 500));
  
  // Look for search queries in various parts of the response
  if (response.candidates) {
    response.candidates.forEach((candidate, idx) => {
      debugLog(`Checking candidate ${idx}`, candidate);
      
      // Check grounding metadata
      if (candidate.groundingMetadata?.searchQueries) {
        debugLog('Found queries in groundingMetadata.searchQueries', candidate.groundingMetadata.searchQueries);
        queries.push(...candidate.groundingMetadata.searchQueries);
      }
      
      // Check for webSearchQueries in groundingMetadata
      if (candidate.groundingMetadata?.webSearchQueries) {
        debugLog('Found queries in groundingMetadata.webSearchQueries', candidate.groundingMetadata.webSearchQueries);
        queries.push(...candidate.groundingMetadata.webSearchQueries);
      }
      
      // Check grounding metadata with different structure
      if (candidate.groundingMetadata?.groundingAttributions) {
        candidate.groundingMetadata.groundingAttributions.forEach(attr => {
          if (attr.searchQuery) {
            debugLog('Found query in groundingAttributions', attr.searchQuery);
            queries.push(attr.searchQuery);
          }
        });
      }
      
      // Check for search tool calls
      if (candidate.content?.parts) {
        candidate.content.parts.forEach((part, partIdx) => {
          debugLog(`Checking part ${partIdx}`, part);
          
          if (part.functionCall?.name === 'google_search' && part.functionCall?.args?.query) {
            debugLog('Found query in functionCall', part.functionCall.args.query);
            queries.push(part.functionCall.args.query);
          }
          
          // Check for inline search queries in text
          if (part.text && part.text.includes('search')) {
            debugLog('Part contains search-related text', part.text.substring(0, 200));
          }
        });
      }
    });
  }
  
  // Check for search entry points
  if (response.searchEntryPoint?.query) {
    debugLog('Found query in searchEntryPoint', response.searchEntryPoint.query);
    queries.push(response.searchEntryPoint.query);
  }
  
  // Also check for any search-related metadata
  if (response.metadata?.searchQueries) {
    debugLog('Found queries in metadata', response.metadata.searchQueries);
    queries.push(...response.metadata.searchQueries);
  }
  
  const uniqueQueries = [...new Set(queries)];
  debugLog('Total unique queries extracted', uniqueQueries.length);
  return uniqueQueries;
}

// Listen for messages from injected script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'SQR_GOOGLE_DATA') {
    debugLog('Received Google data from injected script', event.data.data);
    showData(event.data.data);
  }
});

// Create/update the panel
function createPanel() {
  if (panel) return panel;
  
  panel = document.createElement('div');
  panel.id = 'sqr-panel';
  panel.innerHTML = `
    <div class="sqr-header">
      <span>🔍 Sandbox AI SEO Extension <i style="font-weight: normal; color: #aaa;">Google</i></span>
      <div>
        <button class="sqr-settings" title="API Settings">⚙️</button>
        <button class="sqr-min">−</button>
        <button class="sqr-close">×</button>
      </div>
    </div>
    <div class="sqr-mode-toggle">
      <span>Batch Mode</span>
      <label class="sqr-switch">
        <input type="checkbox" id="sqr-batch-toggle">
        <span class="sqr-slider"></span>
      </label>
    </div>
    <div class="sqr-tabs">
      <button class="sqr-tab active" data-tab="queries">Queries</button>
      <button class="sqr-tab" data-tab="cited">Cited</button>
      <button class="sqr-tab" data-tab="debug">API response</button>
      <button class="sqr-tab" data-tab="batch" style="display:none">Batch</button>
    </div>
    <div class="sqr-content">
      <div class="sqr-empty">Ready to analyze Google searches...</div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = `
    #sqr-panel{position:fixed;bottom:20px;right:20px;width:380px;max-height:500px;background:#1e1e1e;border:1px solid #444;border-radius:12px;font-family:system-ui,sans-serif;font-size:13px;color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:999999;overflow:hidden}
    #sqr-panel.min .sqr-content,#sqr-panel.min .sqr-tabs,#sqr-panel.min .sqr-mode-toggle{display:none}
    #sqr-panel.batch-mode .sqr-tab[data-tab="queries"],#sqr-panel.batch-mode .sqr-tab[data-tab="cited"],#sqr-panel.batch-mode .sqr-tab[data-tab="debug"]{display:none}
    #sqr-panel.batch-mode .sqr-tab[data-tab="batch"]{display:block !important}
    .sqr-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move}
    .sqr-header button{background:#444;border:none;color:#e0e0e0;width:24px;height:24px;border-radius:6px;cursor:pointer;margin-left:6px}
    .sqr-header button:hover{background:#555}
    .sqr-mode-toggle{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#252525;border-bottom:1px solid #444;font-size:12px;color:#888}
    .sqr-switch{position:relative;width:36px;height:20px}
    .sqr-switch input{opacity:0;width:0;height:0}
    .sqr-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#444;border-radius:20px;transition:0.3s}
    .sqr-slider:before{position:absolute;content:"";height:14px;width:14px;left:3px;bottom:3px;background:#888;border-radius:50%;transition:0.3s}
    .sqr-switch input:checked+.sqr-slider{background:#a855f7}
    .sqr-switch input:checked+.sqr-slider:before{transform:translateX(16px);background:#fff}
    .sqr-tabs{display:flex;background:#252525;border-bottom:1px solid #444}
    .sqr-tab{flex:1;padding:8px 4px;background:none;border:none;color:#888;cursor:pointer;font-size:11px;border-bottom:2px solid transparent}
    .sqr-tab:hover{color:#ccc}
    .sqr-tab.active{color:#a855f7;border-bottom-color:#a855f7}
    .sqr-content{padding:12px;height:380px;overflow-y:auto}
    .sqr-empty{color:#888;text-align:center;padding:20px}
    .sqr-time{font-size:10px;color:#888;margin-bottom:8px}
    .sqr-query{background:#3b2d4a;border-left:3px solid #a855f7;padding:8px 10px;margin:6px 0;border-radius:0 6px 6px 0;font-family:monospace;font-size:12px;cursor:pointer;word-break:break-word}
    .sqr-query:hover{background:#4a3d5a}
    .sqr-error{background:#3d1e1e;border-left:3px solid #ef4444;padding:8px 10px;margin:6px 0;border-radius:0 6px 6px 0;font-size:12px;color:#fca5a5}
    .sqr-cited-container{padding:8px 0}
    .sqr-cited-header{font-size:13px;color:#aaa;margin-bottom:12px;padding:0 4px}
    .sqr-cited-item{display:flex;gap:10px;background:#2a2a2a;border-radius:8px;padding:10px;margin:6px 0;cursor:pointer;transition:background 0.2s;text-decoration:none}
    .sqr-cited-item:hover{background:#333;text-decoration:none}
    .sqr-cited-number{flex-shrink:0;width:24px;height:24px;background:#444;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa}
    .sqr-cited-content{flex:1;min-width:0}
    .sqr-cited-title{font-size:13px;color:#60a5fa}
    .sqr-original{color:#60a5fa;font-style:italic}
    .sqr-debug{background:#1a1a1a;border-radius:6px;padding:8px;margin:4px 0;font-family:monospace;font-size:11px}
    .sqr-debug-time{color:#666;margin-right:8px}
    .sqr-debug-msg{color:#aaa}
    .sqr-debug-data{color:#4ade80;margin-left:8px}
    .sqr-debug-container{max-height:300px;overflow-y:auto}
    .sqr-debug-actions{display:flex;gap:8px;margin-bottom:12px}
    .sqr-debug-btn{padding:6px 12px;background:#444;border:none;border-radius:6px;color:#e0e0e0;font-size:12px;cursor:pointer;flex:1}
    .sqr-debug-btn:hover:not(:disabled){background:#555}
    .sqr-debug-btn:disabled{opacity:0.5;cursor:not-allowed}
    .sqr-debug-help{font-size:11px;color:#60a5fa;margin-top:4px;padding-left:20px;font-style:italic}
    .sqr-mode-pill{display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:12px}
    .sqr-mode-pill.ai-overview{background:#2d1e3d;color:#a855f7;border:1px solid #a855f7}
    .sqr-mode-pill.ai-mode{background:#1e3a5f;color:#60a5fa;border:1px solid #60a5fa}
    .sqr-mode-pill.no-ai{background:#3d1e1e;color:#ef4444;border:1px solid #ef4444}
    .sqr-spinner{display:inline-block;width:14px;height:14px;border:2px solid #444;border-top-color:#a855f7;border-radius:50%;animation:sqr-spin 0.8s linear infinite;margin-right:8px;vertical-align:middle}
    @keyframes sqr-spin{to{transform:rotate(360deg)}}
    .sqr-batch-input{width:100%;height:120px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#e0e0e0;padding:10px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:10px}
    .sqr-batch-input::placeholder{color:#666}
    .sqr-batch-btn{background:#a855f7;color:#fff;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-bottom:10px;width:100%}
    .sqr-batch-btn:hover{background:#9333ea}
    .sqr-batch-btn:disabled{background:#444;color:#888;cursor:not-allowed}
    .sqr-batch-results{margin-top:12px}
    .sqr-batch-item{background:#2a2a2a;border-radius:8px;padding:10px;margin:8px 0}
    .sqr-batch-query{color:#a855f7;font-weight:600;margin-bottom:6px}
    .sqr-batch-queries{font-size:11px;color:#aaa;line-height:1.4}
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  panel.querySelector('.sqr-close').onclick = () => panel.style.display = 'none';
  panel.querySelector('.sqr-min').onclick = () => {
    panel.classList.toggle('min');
    panel.querySelector('.sqr-min').textContent = panel.classList.contains('min') ? '+' : '−';
  };
  panel.querySelector('.sqr-settings').onclick = () => {
    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
  };

  // Batch mode toggle
  const batchToggle = panel.querySelector('#sqr-batch-toggle');
  batchToggle.onchange = () => {
    if (batchToggle.checked) {
      panel.classList.add('batch-mode');
      currentTab = 'batch';
      panel.querySelector('.sqr-tab[data-tab="batch"]').classList.add('active');
      panel.querySelectorAll('.sqr-tab:not([data-tab="batch"])').forEach(t => t.classList.remove('active'));
    } else {
      panel.classList.remove('batch-mode');
      currentTab = 'queries';
      panel.querySelector('.sqr-tab[data-tab="queries"]').classList.add('active');
      panel.querySelector('.sqr-tab[data-tab="batch"]').classList.remove('active');
    }
    renderCurrentTab();
  };

  panel.querySelectorAll('.sqr-tab').forEach(tab => {
    tab.onclick = () => {
      panel.querySelectorAll('.sqr-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderCurrentTab();
    };
  });

  // Make panel draggable
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
  
  latestData = data;
  renderCurrentTab();
  
  // Save to history
  chrome.storage.local.get(['queryHistory'], (result) => {
    const history = result.queryHistory || [];
    history.unshift({
      queries: data.queries || [],
      geminiQueries: data.queries || [],
      source: data.source || 'Google AI',
      timestamp: data.timestamp || new Date().toLocaleTimeString(),
      error: data.error,
      originalQuery: data.originalQuery
    });
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
    case 'cited':
      content.innerHTML = renderCited();
      break;
    case 'debug':
      content.innerHTML = renderDebug();
      attachDebugHandlers();
      break;
    case 'batch':
      content.innerHTML = renderBatch();
      attachBatchHandlers();
      break;
  }
}

function attachDebugHandlers() {
  const downloadBtn = document.getElementById('download-debug-logs');
  const clearBtn = document.getElementById('clear-debug-logs');
  
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const logText = debugLogs.map(log => {
        const dataStr = log.data ? ` | Data: ${JSON.stringify(log.data)}` : '';
        return `[${log.timestamp}] ${log.message}${dataStr}`;
      }).join('\n');
      
      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sqr-debug-logs-${new Date().toISOString().replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }
  
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (confirm('Clear all debug logs?')) {
        debugLogs.length = 0;
        renderCurrentTab();
      }
    };
  }
}

function renderQueries() {
  if (!latestData) {
    return '<div class="sqr-empty">No data captured yet</div>';
  }
  
  let html = '';
  
  // Add mode pill
  if (latestData.mode) {
    const pillClass = latestData.mode;
    const pillText = latestData.mode === 'ai-mode' ? '🤖 AI Mode' : 
                    latestData.mode === 'ai-overview' ? '✨ AI Overview' : 
                    '❌ No AI';
    html += `<div class="sqr-mode-pill ${pillClass}">${pillText}</div>`;
  }
  
  if (latestData.timestamp) {
    html += `<div class="sqr-time">${latestData.timestamp}</div>`;
  }
  
  if (latestData.originalQuery) {
    html += `<div class="sqr-original">Original: "${esc(latestData.originalQuery)}"</div>`;
  }
  
  if (latestData.status && latestData.statusText) {
    const spinner = (latestData.status === 'detecting' || latestData.status === 'calling') ? 
                   '<span class="sqr-spinner"></span>' : '';
    html += `<div class="sqr-empty">${spinner}${esc(latestData.statusText)}</div>`;
  }
  
  if (latestData.error) {
    html += `<div class="sqr-error">Error: ${esc(latestData.error)}</div>`;
  }
  
  if (latestData.queries && latestData.queries.length > 0) {
    html += latestData.queries.map(q => 
      `<div class="sqr-query">${esc(q)}</div>`
    ).join('');
  } else if (!latestData.error && !latestData.status) {
    html += '<div class="sqr-empty">No search queries generated</div>';
  }
  
  return html;
}

function renderCited() {
  if (!latestData || !latestData.rawResponse) {
    return '<div class="sqr-empty">No cited sources available</div>';
  }
  
  // Extract grounding chunks from the raw response
  const groundingChunks = [];
  if (latestData.rawResponse.candidates) {
    latestData.rawResponse.candidates.forEach(candidate => {
      if (candidate.groundingMetadata?.groundingChunks) {
        groundingChunks.push(...candidate.groundingMetadata.groundingChunks);
      }
    });
  }
  
  if (groundingChunks.length === 0) {
    return '<div class="sqr-empty">No cited sources found in the API response</div>';
  }
  
  return `
    <div class="sqr-cited-container">
      <div class="sqr-cited-header">
        <span>📚 Sources cited by Gemini (${groundingChunks.length})</span>
      </div>
      ${groundingChunks.map((chunk, idx) => {
        const title = chunk.web?.title || 'Unknown source';
        const url = chunk.web?.uri || '';
        return `
          <a class="sqr-cited-item" ${url ? `href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : ''}>
            <div class="sqr-cited-number">${idx + 1}</div>
            <div class="sqr-cited-content">
              <div class="sqr-cited-title">${esc(title)}</div>
            </div>
          </a>
        `;
      }).join('')}
    </div>
  `;
}

function renderDebug() {
  if (debugLogs.length === 0) {
    return `
      <div class="sqr-debug-actions">
        <button class="sqr-debug-btn" disabled>Download Logs</button>
        <button class="sqr-debug-btn" disabled>Clear Logs</button>
      </div>
      <div class="sqr-empty">No debug logs yet</div>
      <div style="text-align: center; margin-top: 20px;">
        <a href="${chrome.runtime.getURL('debug-guide.html')}" target="_blank" style="color: #a855f7; text-decoration: underline;">📖 API Response Guide</a>
      </div>
    `;
  }
  
  const logs = debugLogs.slice(); // Show in chronological order (oldest first)
  return `
    <div class="sqr-debug-actions">
      <button class="sqr-debug-btn" id="download-debug-logs">📥 Download Logs</button>
      <button class="sqr-debug-btn" id="clear-debug-logs">🗑️ Clear Logs</button>
    </div>
    <div class="sqr-debug-container">
      ${logs.map(log => {
        // Get contextual help tip for this message
        let helpTip = '';
        const msg = log.message.toLowerCase();
        
        if (msg.includes('google content script loaded')) {
          helpTip = '✨ The extension has successfully loaded on the Google page';
        } else if (msg.includes('gemini api key loaded')) {
          helpTip = '✨ Your API key was found and loaded from storage';
        } else if (msg.includes('no gemini api key found')) {
          helpTip = '⚠️ No API key is configured. Click the ⚙️ button to add one';
        } else if (msg.includes('new search detected')) {
          helpTip = 'ℹ️ A new Google search was submitted and detected';
        } else if (msg.includes('ai overview detected with selector')) {
          helpTip = 'ℹ️ An AI overview was found using the specified CSS selector';
        } else if (msg.includes('ai overview detected by text content')) {
          helpTip = 'ℹ️ An AI overview was found by searching for "AI Overview" text in page headings';
        } else if (msg.includes('no ai overview detected')) {
          helpTip = 'ℹ️ The search results don\'t include an AI overview. This is normal for many searches';
        } else if (msg === 'mode') {
          helpTip = 'ℹ️ Indicates whether AI Overview or AI Mode (udm=50) was detected';
        } else if (msg.includes('calling gemini api')) {
          helpTip = 'ℹ️ The extension is calling Gemini API with the specified model and query';
        } else if (msg.includes('raw api response structure')) {
          helpTip = 'ℹ️ Shows the first 500 characters of the Gemini API response for debugging';
        } else if (msg.includes('found queries in groundingmetadata.websearchqueries')) {
          helpTip = '✨ Successfully extracted search queries from the API response';
        } else if (msg.includes('checking candidate')) {
          helpTip = 'ℹ️ Examining response candidates for search queries and grounding information';
        } else if (msg.includes('checking part')) {
          helpTip = 'ℹ️ Examining individual parts of the response content';
        } else if (msg.includes('total unique queries extracted')) {
          helpTip = 'ℹ️ Shows how many unique search queries were found in the response';
        } else if (msg.includes('gemini api response received')) {
          helpTip = '✨ Final summary showing the total number of queries extracted';
        } else if (msg.includes('gemini api error')) {
          helpTip = '❌ The API call failed. Check your API key and connection';
        } else if (msg.includes('error:') && msg.includes('api key not configured')) {
          helpTip = '⚠️ You need to add your Gemini API key in the extension settings';
        } else if (msg.includes('ai overview/mode confirmed')) {
          helpTip = 'ℹ️ AI content detected, proceeding with API call';
        }
        
        return `
          <div class="sqr-debug">
            <span class="sqr-debug-time">${log.timestamp}</span>
            <span class="sqr-debug-msg">${esc(log.message)}</span>
            ${log.data ? `<span class="sqr-debug-data">${esc(JSON.stringify(log.data))}</span>` : ''}
            ${helpTip ? `<div class="sqr-debug-help">${helpTip}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div style="text-align: center; margin-top: 12px;">
      <a href="${chrome.runtime.getURL('debug-guide.html')}" target="_blank" style="color: #a855f7; text-decoration: underline;">📖 API Response Guide</a>
    </div>
  `;
}

function renderBatch() {
  // Check if we have completed results
  if (batchResults.length > 0) {
    return `
      <div style="padding: 8px 0;">
        <div style="background: #2d1e3d; border: 1px solid #a855f7; border-radius: 8px; padding: 12px; margin-bottom: 12px; text-align: center;">
          <div style="color: #a855f7; font-weight: 600; margin-bottom: 4px;">✨ Complete</div>
          <div style="color: #888; font-size: 12px;">${batchResults.length} results collected</div>
        </div>
        <button class="sqr-batch-btn" id="sqr-batch-export">Export CSV</button>
        <button class="sqr-batch-btn" id="sqr-batch-clear" style="background: #444; margin-top: 8px;">Clear & New Batch</button>
        <div class="sqr-batch-results" style="margin-top: 12px; max-height: 300px; overflow-y: auto;">
          ${batchResults.map(result => `
            <div class="sqr-batch-item">
              <div class="sqr-batch-query">${esc(result.originalQuery)}</div>
              <div class="sqr-batch-queries">
                ${result.searchQueries.length > 0 
                  ? result.searchQueries.map(q => `• ${esc(q)}`).join('<br>')
                  : '<span style="color: #888;">No search queries generated</span>'}
                <br><span style="color: ${result.hasAIOverview ? '#a855f7' : '#888'}; font-size: 10px; margin-top: 4px; display: inline-block;">
                  ${result.hasAIOverview ? '✨ AI Overview detected' : 'No AI Overview'} ${result.isAIMode ? '(AI Mode)' : '(Regular)'}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Initial state
  return `
    <div style="padding: 8px 0;">
      <textarea class="sqr-batch-input" placeholder="Enter search queries, one per line..."></textarea>
      <button class="sqr-batch-btn" id="sqr-batch-process">Process All Queries</button>
      <div class="sqr-batch-results" id="sqr-batch-results"></div>
    </div>
  `;
}

let batchResults = [];

async function attachBatchHandlers() {
  const processBtn = document.getElementById('sqr-batch-process');
  const exportBtn = document.getElementById('sqr-batch-export');
  const clearBtn = document.getElementById('sqr-batch-clear');
  const resultsDiv = document.getElementById('sqr-batch-results');

  // Handle process button
  if (processBtn) {
    processBtn.onclick = async () => {
      const input = document.querySelector('.sqr-batch-input');
      const queries = input.value.trim().split('\n').filter(q => q.trim());
      if (!queries.length) return;

      if (!geminiApiKey) {
        resultsDiv.innerHTML = '<div class="sqr-error">Please configure your Gemini API key first</div>';
        return;
      }

      processBtn.disabled = true;
      processBtn.textContent = 'Processing...';
      batchResults = [];
      resultsDiv.innerHTML = '';

      for (let i = 0; i < queries.length; i++) {
        const query = queries[i].trim();
        if (!query) continue;

        resultsDiv.innerHTML += `
          <div class="sqr-batch-item">
            <div class="sqr-batch-query">${esc(query)}</div>
            <div class="sqr-batch-queries"><span class="sqr-spinner"></span> Processing...</div>
          </div>
        `;

        try {
          // Call Gemini API
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: query
                }]
              }],
              tools: [{
                googleSearch: {}
              }],
              generationConfig: {
                temperature: 1.0,
                maxOutputTokens: 1000
              }
            })
          });

          if (!response.ok) {
            throw new Error('API request failed');
          }

          const data = await response.json();
          const searchQueries = extractQueriesFromResponse(data);
          
          // Check if this search has AI overview on actual Google
          const hasAIOverview = await checkGoogleAIOverview(query);
          
          batchResults.push({
            originalQuery: query,
            searchQueries: searchQueries,
            hasAIOverview: hasAIOverview,
            isAIMode: isInAIMode
          });

          // Update display
          const items = resultsDiv.querySelectorAll('.sqr-batch-item');
          const lastItem = items[items.length - 1];
          let html = '';
          if (searchQueries.length > 0) {
            html += searchQueries.map(q => `• ${esc(q)}`).join('<br>');
          } else {
            html += '<span style="color: #888;">No search queries generated</span>';
          }
          const isInAIMode = new URLSearchParams(window.location.search).get('udm') === '50';
          html += `<br><span style="color: ${hasAIOverview ? '#a855f7' : '#888'}; font-size: 10px; margin-top: 4px; display: inline-block;">
            ${hasAIOverview ? '✨ AI Overview detected' : 'No AI Overview'} ${isInAIMode ? '(AI Mode)' : '(Regular)'}
          </span>`;
          lastItem.querySelector('.sqr-batch-queries').innerHTML = html;

        } catch (error) {
          const items = resultsDiv.querySelectorAll('.sqr-batch-item');
          const lastItem = items[items.length - 1];
          lastItem.querySelector('.sqr-batch-queries').innerHTML = `<span style="color: #ef4444;">Error: ${esc(error.message)}</span>`;
          
          batchResults.push({
            originalQuery: query,
            searchQueries: [],
            hasAIOverview: false,
            error: error.message
          });
        }

        // Add a small delay between requests
        if (i < queries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Show completion state
      renderCurrentTab();
    };
  }

  // Handle clear button
  if (clearBtn) {
    clearBtn.onclick = () => {
      batchResults = [];
      renderCurrentTab();
    };
  }

  // Handle export button
  if (exportBtn) {
    exportBtn.onclick = () => {
      const csvContent = generateCSV();
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `google-ai-queries-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }
}

// Check if Google shows AI overview for a query
async function checkGoogleAIOverview(query) {
  // Check if we're currently in AI mode
  const urlParams = new URLSearchParams(window.location.search);
  const isInAIMode = urlParams.get('udm') === '50';
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'checkGoogleAIOverview', query: query, useAIMode: isInAIMode },
      (response) => {
        resolve(response?.hasAIOverview || false);
      }
    );
  });
}

// Generate CSV content
function generateCSV() {
  let csv = 'Original Query,Generated Queries,Has AI Overview,Mode,Query Count\n';
  
  for (const result of batchResults) {
    const originalQuery = `"${result.originalQuery.replace(/"/g, '""')}"`;
    const generatedQueries = result.searchQueries.join(' | ');
    const quotedQueries = `"${generatedQueries.replace(/"/g, '""')}"`;
    const hasAI = result.hasAIOverview ? 'Yes' : 'No';
    const mode = result.isAIMode ? 'AI Mode' : 'Regular';
    const queryCount = result.searchQueries.length;
    
    csv += `${originalQuery},${quotedQueries},${hasAI},${mode},${queryCount}\n`;
  }
  
  return csv;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Monitor for changes
setInterval(checkForSearch, 500);

// Also check on navigation
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(checkForSearch, 500);
  }
}).observe(document, { subtree: true, childList: true });

// Initial check when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    createPanel();
    panel.style.display = 'block';
    checkForSearch();
  });
} else {
  // DOM already loaded
  setTimeout(() => {
    createPanel();
    panel.style.display = 'block';
    checkForSearch();
  }, 100);
}

debugLog('Google content script loaded', window.location.href);

// Show panel immediately
setTimeout(() => {
  if (!panel) {
    createPanel();
    panel.style.display = 'block';
    debugLog('Panel created on page load');
  }
}, 500);