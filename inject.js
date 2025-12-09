// Enhanced version - captures queries, scores, sources
(function() {
  console.log('🔍 [SQR] Injected script running');
  
  const seenData = new Set();
  
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await origFetch.apply(this, args);
    
    try {
      const clone = res.clone();
      const text = await clone.text();
      
      if (text.includes('search_model_queries') || text.includes('sonic_classification_result')) {
        try {
          const json = JSON.parse(text);
          extractAndSend(json);
        } catch(e) {
          text.split('\n').forEach(line => {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const json = JSON.parse(line.slice(6));
                extractAndSend(json);
              } catch(e) {}
            }
          });
        }
      }
    } catch(e) {}
    
    return res;
  };
  
  function extractAndSend(obj) {
    const data = {
      queries: [],
      scores: null,
      sourcesRetrieved: [],
      sourcesCited: [],
      searchTurns: null
    };
    
    function search(o) {
      if (!o || typeof o !== 'object') return;
      
      // Extract queries
      if (o.search_model_queries) {
        if (o.search_model_queries.queries && Array.isArray(o.search_model_queries.queries)) {
          data.queries.push(...o.search_model_queries.queries);
        } else if (Array.isArray(o.search_model_queries)) {
          data.queries.push(...o.search_model_queries);
        }
      }
      
      // Extract classification scores
      if (o.sonic_classification_result && !data.scores) {
        data.scores = {
          simpleSearch: (o.sonic_classification_result.simple_search_prob * 100).toFixed(3),
          complexSearch: (o.sonic_classification_result.complex_search_prob * 100).toFixed(3),
          noSearch: (o.sonic_classification_result.no_search_prob * 100).toFixed(3)
        };
      }
      
      // Extract search turns count
      if (o.search_turns_count && !data.searchTurns) {
        data.searchTurns = o.search_turns_count;
      }
      
      // Extract sources retrieved (search_result_groups)
      if (o.search_result_groups && Array.isArray(o.search_result_groups)) {
        o.search_result_groups.forEach(group => {
          if (group.entries && Array.isArray(group.entries)) {
            group.entries.forEach(entry => {
              if (entry.url && entry.title) {
                data.sourcesRetrieved.push({
                  domain: group.domain || new URL(entry.url).hostname,
                  url: entry.url,
                  title: entry.title,
                  snippet: entry.snippet || ''
                });
              }
            });
          }
        });
      }
      
      // Extract sources cited (content_references)
      if (o.content_references && Array.isArray(o.content_references)) {
        o.content_references.forEach(ref => {
          if (ref.items && Array.isArray(ref.items)) {
            ref.items.forEach(item => {
              if (item.url && item.title) {
                data.sourcesCited.push({
                  url: item.url,
                  title: item.title,
                  attribution: item.attribution || ''
                });
              }
            });
          }
        });
      }
      
      // Recurse
      for (const key in o) {
        if (o.hasOwnProperty(key) && typeof o[key] === 'object' && o[key] !== null) {
          search(o[key]);
        }
      }
    }
    
    search(obj);
    
    // Dedupe queries
    data.queries = [...new Set(data.queries)];
    
    // Dedupe sources by URL
    const seenUrls = new Set();
    data.sourcesRetrieved = data.sourcesRetrieved.filter(s => {
      if (seenUrls.has(s.url)) return false;
      seenUrls.add(s.url);
      return true;
    });
    
    const seenCitedUrls = new Set();
    data.sourcesCited = data.sourcesCited.filter(s => {
      if (seenCitedUrls.has(s.url)) return false;
      seenCitedUrls.add(s.url);
      return true;
    });
    
    // Send if we have any meaningful data
    const hasData = data.queries.length > 0 || data.scores || data.sourcesRetrieved.length > 0 || data.sourcesCited.length > 0;
    const dataKey = JSON.stringify(data);
    
    if (hasData && !seenData.has(dataKey)) {
      seenData.add(dataKey);
      console.log('🔍 [SQR] Sending data:', data);
      window.postMessage({ type: 'SQR_DATA', data: data }, '*');
    }
  }
  
  console.log('🔍 [SQR] Fetch interceptor installed');
})();