// Google inject script - intercepts API calls
(function() {
  console.log('🔍 [SQR] Google injected script running');
  
  const seenData = new Set();
  
  // Intercept fetch to catch Google's internal API calls
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const [urlOrRequest, options] = args;
    
    let urlString = '';
    try {
      urlString = typeof urlOrRequest === 'string' ? urlOrRequest : (urlOrRequest?.url || '');
    } catch(e) {
      urlString = '';
    }
    
    // Log all API calls in debug mode
    const DEBUG = false;
    if (DEBUG && urlString.includes('google.com')) {
      console.log('🔍 [SQR] Google API call:', urlString);
    }
    
    // Intercept calls that might contain AI/search data
    const shouldIntercept = urlString && (
      urlString.includes('/search') ||
      urlString.includes('/generate') ||
      urlString.includes('/complete') ||
      urlString.includes('bard') ||
      urlString.includes('lamda') ||
      urlString.includes('/v1/') ||
      urlString.includes('boq_searchfrontendservice')
    );
    
    let res;
    try {
      res = await origFetch.apply(this, args);
    } catch(e) {
      throw e;
    }
    
    if (!shouldIntercept || !res || !res.ok) {
      return res;
    }
    
    try {
      const clone = res.clone();
      const text = await clone.text();
      
      // Try to extract any search-related data
      if (text.includes('query') || text.includes('search')) {
        try {
          const json = JSON.parse(text);
          extractGoogleData(json, urlString);
        } catch(e) {
          // Not JSON, might be other format
        }
      }
    } catch(e) {
      console.error('🔍 [SQR] Error processing Google response:', e);
    }
    
    return res;
  };
  
  // Also intercept XMLHttpRequest for older APIs
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._sqrUrl = url;
    return origOpen.apply(this, [method, url, ...args]);
  };
  
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(data) {
    const url = this._sqrUrl;
    
    if (url && (url.includes('/search') || url.includes('/generate'))) {
      const origOnLoad = this.onload;
      this.onload = function(...args) {
        try {
          if (this.responseText) {
            const json = JSON.parse(this.responseText);
            extractGoogleData(json, url);
          }
        } catch(e) {}
        if (origOnLoad) origOnLoad.apply(this, args);
      };
    }
    
    return origSend.apply(this, [data]);
  };
  
  function extractGoogleData(obj, source) {
    const data = {
      queries: [],
      source: 'Google Internal API',
      interceptedFrom: source
    };
    
    function search(o, path = '') {
      if (!o || typeof o !== 'object') return;
      
      // Look for query-like fields
      const queryFields = ['query', 'search_query', 'q', 'searchQuery', 'text', 'prompt', 'question'];
      
      for (const field of queryFields) {
        if (o[field] && typeof o[field] === 'string' && o[field].length > 3) {
          data.queries.push(o[field]);
        }
      }
      
      // Look for arrays of queries
      if (o.queries && Array.isArray(o.queries)) {
        o.queries.forEach(q => {
          if (typeof q === 'string') data.queries.push(q);
          else if (q.query) data.queries.push(q.query);
          else if (q.text) data.queries.push(q.text);
        });
      }
      
      // Recurse
      for (const key in o) {
        if (o.hasOwnProperty(key) && typeof o[key] === 'object' && o[key] !== null) {
          search(o[key], path + '.' + key);
        }
      }
    }
    
    search(obj);
    
    // Remove duplicates
    data.queries = [...new Set(data.queries)];
    
    // Filter out non-search queries
    data.queries = data.queries.filter(q => 
      q.length > 5 && 
      !q.startsWith('data:') &&
      !q.startsWith('http') &&
      !q.includes('base64')
    );
    
    if (data.queries.length > 0) {
      const dataKey = JSON.stringify(data);
      if (!seenData.has(dataKey)) {
        seenData.add(dataKey);
        console.log('🔍 [SQR] Google data extracted:', data);
        window.postMessage({ type: 'SQR_GOOGLE_DATA', data: data }, '*');
      }
    }
  }
  
  console.log('🔍 [SQR] Google interceptors installed');
})();