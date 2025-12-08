document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('content');
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');

  function renderHistory(history) {
    if (!history || history.length === 0) {
      content.innerHTML = `
        <div class="empty">
          <div class="empty-icon">🔎</div>
          <div>No queries captured yet</div>
          <div style="margin-top: 8px; font-size: 11px;">
            Ask ChatGPT something that triggers a web search
          </div>
        </div>
      `;
      return;
    }

    content.innerHTML = history.map(item => `
      <div class="group">
        <div class="timestamp">${item.timestamp}</div>
        ${item.queries.map(q => `
          <div class="query" data-query="${escapeHtml(q)}">${escapeHtml(q)}</div>
        `).join('')}
      </div>
    `).join('');

    content.querySelectorAll('.query').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.dataset.query);
        el.classList.add('copied');
        el.textContent = 'Copied!';
        setTimeout(() => {
          el.classList.remove('copied');
          el.textContent = el.dataset.query;
        }, 1000);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  chrome.storage.local.get(['queryHistory'], (result) => {
    renderHistory(result.queryHistory || []);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.queryHistory) {
      renderHistory(changes.queryHistory.newValue || []);
    }
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Clear all captured queries?')) {
      chrome.storage.local.set({ queryHistory: [] });
      renderHistory([]);
    }
  });

  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['queryHistory'], (result) => {
      const history = result.queryHistory || [];
      if (history.length === 0) {
        alert('No queries to export');
        return;
      }

      let csv = 'Timestamp,Query\n';
      history.forEach(item => {
        item.queries.forEach(q => {
          csv += `"${item.timestamp}","${q.replace(/"/g, '""')}"\n`;
        });
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chatgpt-search-queries-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
});
