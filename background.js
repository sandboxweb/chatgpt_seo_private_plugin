// Background script to handle opening options page and checking Google AI overview
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
  } else if (request.action === 'checkGoogleAIOverview') {
    checkGoogleAIOverview(request.query, request.useAIMode).then(result => {
      sendResponse({ hasAIOverview: result });
    });
    return true; // Keep the message channel open for async response
  }
});

async function checkGoogleAIOverview(query, useAIMode = false) {
  try {
    // Open Google search in a new tab
    const searchUrl = useAIMode 
      ? `https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`
      : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    
    // Wait for the page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Inject script to check for AI overview
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const aiOverviewSelectors = [
          '[data-attrid="SGESourcePanel"]',
          '[data-sge-overlay]',
          '[aria-label*="AI overview"]',
          '[aria-label*="AI Overview"]',
          'div[data-sgeb]',
          '.TQc1id',
          '.ixp7T',
          '.LGOjhe'
        ];
        
        for (const selector of aiOverviewSelectors) {
          try {
            if (document.querySelector(selector)) return true;
          } catch (e) {}
        }
        
        // Check for text content
        const headings = document.querySelectorAll('h1, h2, h3, div[role="heading"]');
        for (const heading of headings) {
          if (heading.textContent && heading.textContent.includes('AI Overview')) {
            return true;
          }
        }
        
        return false;
      }
    });
    
    // Close the tab
    await chrome.tabs.remove(tab.id);
    
    return results[0].result;
  } catch (error) {
    console.error('Error checking Google AI overview:', error);
    return false;
  }
}