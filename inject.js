// This runs in the page context to intercept fetch
(function() {
  console.log('🔍 [SQR] Injected script running in page context');
  
  const seenQueries = new Set();
  
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0]?.url || args[0] || '';
    
    const res = await origFetch.apply(this, args);
    
    try {
      const clone = res.clone();
      const text = await clone.text();
      
      if (text.includes('search_model_queries')) {
        console.log('🔍 [SQR] Found search_model_queries in response');
        
        try {
          const json = JSON.parse(text);
          const queries = findAllQueries(json);
          sendQueries(queries);
        } catch(e) {
          // Try streaming format
          text.split('\n').forEach(line => {
            if (line.includes('search_model_queries') && line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.slice(6));
                const queries = findAllQueries(json);
                sendQueries(queries);
              } catch(e) {}
            }
          });
        }
      }
    } catch(e) {}
    
    return res;
  };
  
  function findAllQueries(obj) {
    const queries = [];
    
    function search(o) {
      if (!o || typeof o !== 'object') return;
      
      if (o.search_model_queries) {
        if (o.search_model_queries.queries && Array.isArray(o.search_model_queries.queries)) {
          queries.push(...o.search_model_queries.queries);
        } else if (Array.isArray(o.search_model_queries)) {
          queries.push(...o.search_model_queries);
        }
      }
      
      for (const key in o) {
        if (o.hasOwnProperty(key) && typeof o[key] === 'object' && o[key] !== null) {
          search(o[key]);
        }
      }
    }
    
    search(obj);
    return queries;
  }
  
  function sendQueries(queries) {
    const newQueries = queries.filter(q => {
      if (seenQueries.has(q)) return false;
      seenQueries.add(q);
      return true;
    });
    
    if (newQueries.length > 0) {
      console.log('🔍 [SQR] Sending queries:', newQueries);
      window.postMessage({ type: 'SQR_QUERIES', queries: newQueries }, '*');
    }
  }
  
  console.log('🔍 [SQR] Fetch interceptor installed successfully');
})();
