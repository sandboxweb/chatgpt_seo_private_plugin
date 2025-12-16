document.addEventListener('DOMContentLoaded', async () => {
  // Tab functionality
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${targetTab}-tab`).classList.add('active');
    });
  });
  
  // Check Gemini API key status
  const geminiDot = document.getElementById('gemini-dot');
  const geminiText = document.getElementById('gemini-text');
  const settingsBtn = document.getElementById('settingsBtn');
  const clearBtn = document.getElementById('clearBtn');
  const historyContent = document.getElementById('history-content');
  
  // Check API key
  const { geminiApiKey } = await chrome.storage.sync.get(['geminiApiKey']);
  if (geminiApiKey) {
    geminiDot.className = 'status-dot active';
    geminiText.textContent = 'API Key Set';
  } else {
    geminiDot.className = 'status-dot warning';
    geminiText.textContent = 'API Key Required';
  }
  
  // Settings button
  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  
  // Load query history
  loadHistory();
  
  // Clear history
  clearBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (confirm('Clear all captured queries?')) {
      await chrome.storage.local.set({ queryHistory: [] });
      loadHistory();
    }
  });
  
  // Listen for changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.queryHistory) {
      loadHistory();
    }
    if (changes.geminiApiKey) {
      if (changes.geminiApiKey.newValue) {
        geminiDot.className = 'status-dot active';
        geminiText.textContent = 'API Key Set';
      } else {
        geminiDot.className = 'status-dot warning';
        geminiText.textContent = 'API Key Required';
      }
    }
  });
  
  async function loadHistory() {
    const { queryHistory } = await chrome.storage.local.get(['queryHistory']);
    if (!queryHistory || queryHistory.length === 0) {
      historyContent.innerHTML = '<div class="empty-history">No queries captured yet</div>';
      return;
    }
    
    // Collect recent queries from all sources
    const recentQueries = [];
    for (const item of queryHistory.slice(0, 10)) {
      if (item.queries && item.queries.length > 0) {
        recentQueries.push(...item.queries.map(q => ({
          query: q,
          source: item.source || 'ChatGPT',
          time: item.timestamp
        })));
      }
      // Add Google/Gemini queries
      if (item.geminiQueries && item.geminiQueries.length > 0) {
        recentQueries.push(...item.geminiQueries.map(q => ({
          query: q,
          source: 'Google AI',
          time: item.timestamp
        })));
      }
    }
    
    if (recentQueries.length === 0) {
      historyContent.innerHTML = '<div class="empty-history">No queries captured yet</div>';
      return;
    }
    
    // Show last 5 queries
    historyContent.innerHTML = recentQueries.slice(0, 5).map(item => `
      <div class="query-item" data-query="${escapeHtml(item.query)}" title="${item.source} - ${item.time}">
        ${escapeHtml(item.query)}
      </div>
    `).join('');
    
    // Add click to copy
    historyContent.querySelectorAll('.query-item').forEach(el => {
      el.addEventListener('click', async () => {
        const query = el.dataset.query;
        await navigator.clipboard.writeText(query);
        el.classList.add('copied');
        const originalText = el.textContent;
        el.textContent = 'Copied!';
        setTimeout(() => {
          el.classList.remove('copied');
          el.textContent = originalText;
        }, 1000);
      });
    });
  }
  
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});