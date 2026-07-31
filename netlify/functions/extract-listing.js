exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on the server' }) };
  }

  try {
    const { url } = JSON.parse(event.body);
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url' }) };

    // 1 — Récupérer la page nous-mêmes, avec un User-Agent de vrai navigateur
    // (beaucoup de sites bloquent les requêtes sans ça). Si ça échoue, on le
    // dit clairement plutôt que de laisser le modèle deviner.
    let html;
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8'
        },
        redirect: 'follow'
      });
      if (!pageRes.ok) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: `This site returned an error (${pageRes.status}) — it may be blocking automated access. Try the Manual form instead.` }) };
      }
      html = await pageRes.text();
    } catch (fetchErr) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not reach that URL — it may be blocking automated access. Try the Manual form instead.' }) };
    }

    // 2 — Extraire les photos de manière fiable via les balises Open Graph
    // (utilisées par la plupart des sites pros pour les aperçus de partage —
    // présentes dans le HTML brut même sur les sites très JS, donc fiable).
    const photos=[];
    const ogImageMatches=[...html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)];
    ogImageMatches.forEach(m=>{if(m[1]&&!photos.includes(m[1]))photos.push(m[1]);});
    if(!photos.length){
      const twitterImg=html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
      if(twitterImg?.[1])photos.push(twitterImg[1]);
    }

    // 3 — Nettoyer un minimum et tronquer (limite de tokens + coût)
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 40000);

    if (cleaned.replace(/<[^>]+>/g, '').trim().length < 200) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'This page has almost no content when loaded without JavaScript — this site likely requires a real browser to view. Try the Manual form instead.' }) };
    }

    // 4 — Demander au modèle d'extraire les infos structurées, et en plus (best
    // effort) de repérer d'autres photos du bien dans le HTML si possible.
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `Here is the raw HTML of a property listing page. Extract the listing details from it.\n\nReturn ONLY valid JSON with these exact fields:\n{"title":"","zone":"","price":0,"bedrooms":0,"bathrooms":0,"description":"","full_address":"","bills":"excluded","furnished":false,"wifi":false,"lease_type":"long","photo_urls":[],"features":[]}\n\nFor zone, use only Malta zones like: Sliema, St Julian's, Valletta, Msida, Gzira, Swieqi, Mellieha, etc. If the property isn't in Malta, still extract what you can and set zone to the actual city/area.\nFor photo_urls: look through the HTML for <img> tags or data attributes (data-src, data-lazy-src, srcset) that point to actual PHOTOS of this property (not logos, icons, avatars, or ads). Return full absolute URLs only (starting with http). Up to 8 photos. If you can't confidently identify real property photos, return an empty array — don't guess.\nFor features: pick ONLY from this exact list (use the exact spelling), based on what's actually mentioned or shown on the page: ["Air Conditioning","Furnished","Pet Friendly","Balcony","Sea View","Valley View","Dishwasher","Washing Machine","Parking","Pool","Elevator / Lift","Garden","Terrace","WiFi","Walk-In Wardrobe","Storage Room","CCTV / Security","Gym","Utility Room","Sofa Bed"]. Don't include anything not on this list. If unsure, leave it out.\nIf this page clearly isn't a property listing, return {"error":"This doesn't look like a property listing page"}\n\nHTML:\n${cleaned}`
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: data?.error?.message || 'Anthropic API error' }) };
    }

    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse listing details from that page' }) };
    }

    // 5 — Fusionner : og:image en premier (le plus fiable), puis ce que le
    // modèle a trouvé en plus, sans doublons.
    const modelPhotos=Array.isArray(parsed.photo_urls)?parsed.photo_urls.filter(p=>typeof p==='string'&&p.startsWith('http')):[];
    modelPhotos.forEach(p=>{if(!photos.includes(p))photos.push(p);});
    parsed.photos=photos.slice(0,8);
    delete parsed.photo_urls;

    // 6 — Ne garder que des features de la liste connue (défense contre un modèle qui invente)
    const KNOWN_FEATURES=["Air Conditioning","Furnished","Pet Friendly","Balcony","Sea View","Valley View","Dishwasher","Washing Machine","Parking","Pool","Elevator / Lift","Garden","Terrace","WiFi","Walk-In Wardrobe","Storage Room","CCTV / Security","Gym","Utility Room","Sofa Bed"];
    parsed.features=Array.isArray(parsed.features)?parsed.features.filter(f=>KNOWN_FEATURES.includes(f)):[];

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (e) {
    console.error('extract-listing error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
