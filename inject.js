// Enhanced version - captures queries, scores, sources
(function() {
  console.log('🔍 [SQR] Injected script running');
  
  const seenData = new Set();
  
  // Debug mode - set to true to log all streaming data
  const DEBUG_MODE = true;
  const DEBUG_REQUESTS = false; // Disabled to reduce noise
  
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const [urlOrRequest, options] = args;
    
    // Get URL string safely (could be string or Request object)
    let urlString = '';
    try {
      urlString = typeof urlOrRequest === 'string' ? urlOrRequest : (urlOrRequest?.url || '');
    } catch(e) {
      urlString = '';
    }
    
    // Only intercept conversation/backend-api calls
    const shouldIntercept = urlString && (urlString.includes('/backend-api/') || urlString.includes('/conversation'));
    
    if (!shouldIntercept) {
      return origFetch.apply(this, args);
    }
    
    // Log outgoing requests to conversation endpoint
    if (DEBUG_REQUESTS && urlString.includes('/conversation')) {
      try {
        if (options && options.body) {
          const requestBody = JSON.parse(options.body);
          console.log('🔍 [SQR] === OUTGOING REQUEST ===');
          console.log('🔍 [SQR] URL:', urlString);
          console.log('🔍 [SQR] Request body:', requestBody);
        }
      } catch(e) {}
    }
    
    let res;
    try {
      res = await origFetch.apply(this, args);
    } catch(e) {
      throw e; // Re-throw fetch errors
    }
    
    // Only process successful responses
    if (!res || !res.ok) {
      return res;
    }
    
    try {
      const clone = res.clone();
      const text = await clone.text();
      
      // Only process if it looks like relevant data
      if (text.includes('search_model_queries') || 
          text.includes('sonic_classification_result') || 
          text.includes('content_references') ||
          text.includes('search_result_groups')) {
        
        // In debug mode, log chunks with product data
        if (DEBUG_MODE && text.includes('product')) {
          console.log('🔍 [SQR] === RESPONSE WITH PRODUCTS ===');
        }
        
        // Try parsing as JSON first
        try {
          const json = JSON.parse(text);
          extractAndSend(json);
        } catch(e) {
          // Parse as streaming response
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
    } catch(e) {
      // Silently fail - don't break ChatGPT
      console.log('🔍 [SQR] Error processing response:', e.message);
    }
    
    return res;
  };
  
  function extractAndSend(obj) {
    const data = {
      queries: [],
      scores: null,
      sourcesRetrieved: [],
      sourcesCited: [],
      searchTurns: null,
      productsPool: [],      // All products retrieved
      productsSelected: []   // Products the LLM chose
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
      
      // Extract ALL products from the pool (type: "products" array)
      // These are products shown in the carousel
      if (o.type === 'products' && o.products && Array.isArray(o.products)) {
        console.log('🔍 [SQR] Found products pool:', o.products.length, 'products');
        console.log('🔍 [SQR] target_product_count:', o.target_product_count);
        o.products.forEach(p => {
          data.productsPool.push({
            cite: p.cite,
            title: p.title,
            price: p.price,
            rating: p.rating,
            numReviews: p.num_reviews,
            url: p.url
          });
          // Also add to sourcesCited since these appear in the carousel
          data.sourcesCited.push({
            url: p.url || '',
            title: p.title || '',
            attribution: p.merchants || '',
            refType: 'product',
            isProduct: true,
            price: p.price || '',
            numReviews: p.num_reviews || null,
            rating: p.rating || null
          });
        });
      }
      
      // Extract product selections from LLM output (matched_text with "products{selections")
      if (o.matched_text && o.matched_text.includes('products{') && o.matched_text.includes('selections')) {
        try {
          const selectionsMatch = o.matched_text.match(/products(\{.*\})/s);
          if (selectionsMatch) {
            const selectionsJson = JSON.parse(selectionsMatch[1]);
            if (selectionsJson.selections) {
              console.log('🔍 [SQR] Found product selections:', selectionsJson.selections);
              data.productsSelected = selectionsJson.selections.map(s => ({
                id: s[0],
                title: s[1]
              }));
            }
          }
        } catch(e) {
          console.log('🔍 [SQR] Error parsing selections:', e);
        }
      }
      
      // Extract sources retrieved (search_result_groups)
      if (o.search_result_groups && Array.isArray(o.search_result_groups)) {
        o.search_result_groups.forEach(group => {
          if (group.entries && Array.isArray(group.entries)) {
            group.entries.forEach(entry => {
              if (entry.url && entry.title) {
                // Get ref_type from ref_id if available
                let refType = 'search';
                if (entry.ref_id && entry.ref_id.ref_type) {
                  refType = entry.ref_id.ref_type;
                }
                data.sourcesRetrieved.push({
                  domain: group.domain || new URL(entry.url).hostname,
                  url: entry.url,
                  title: entry.title,
                  snippet: entry.snippet || '',
                  refType: refType
                });
              }
            });
          }
        });
      }
      
      // Extract sources cited (content_references)
      if (o.content_references && Array.isArray(o.content_references)) {
        o.content_references.forEach(ref => {
          // Handle product carousels (type: "products" with products array)
          if (ref.type === 'products' && ref.products && Array.isArray(ref.products)) {
            console.log('🔍 [SQR] Found product carousel:', ref.products.length, 'products');
            ref.products.forEach(p => {
              data.sourcesCited.push({
                url: p.url || '',
                title: p.title || '',
                attribution: p.merchants || '',
                refType: 'product',
                isProduct: true,
                price: p.price || '',
                numReviews: p.num_reviews || null,
                rating: p.rating || null,
                cite: p.cite || ''
              });
            });
          }
          // Handle individual product entities (type: "product_entity")
          else if (ref.type === 'product_entity' && ref.product) {
            const p = ref.product;
            // Skip if we already have this product (avoid duplicates from carousel)
            const alreadyHave = data.sourcesCited.some(s => s.cite === p.cite);
            if (!alreadyHave) {
              data.sourcesCited.push({
                url: p.url || '',
                title: p.title || '',
                attribution: p.merchants || '',
                refType: 'product',
                isProduct: true,
                price: p.price || '',
                numReviews: p.num_reviews || null,
                rating: p.rating || null,
                cite: p.cite || ''
              });
            }
          }
          // Handle grouped webpages and other citation types
          else if (ref.items && Array.isArray(ref.items)) {
            ref.items.forEach(item => {
              if (item.url && item.title) {
                // Try to get ref_type from refs array
                let refType = 'unknown';
                if (item.refs && item.refs.length > 0 && item.refs[0].ref_type) {
                  refType = item.refs[0].ref_type;
                } else if (ref.refs && ref.refs.length > 0 && ref.refs[0].ref_type) {
                  refType = ref.refs[0].ref_type;
                }
                data.sourcesCited.push({
                  url: item.url,
                  title: item.title,
                  attribution: item.attribution || '',
                  refType: refType,
                  isProduct: false
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
    const hasData = data.queries.length > 0 || data.scores || data.sourcesRetrieved.length > 0 || data.sourcesCited.length > 0 || data.productsPool.length > 0 || data.productsSelected.length > 0;
    const dataKey = JSON.stringify(data);
    
    if (hasData && !seenData.has(dataKey)) {
      seenData.add(dataKey);
      console.log('🔍 [SQR] Sending data:', data);
      window.postMessage({ type: 'SQR_DATA', data: data }, '*');
    }
  }
  
  console.log('🔍 [SQR] Fetch interceptor installed');
})();