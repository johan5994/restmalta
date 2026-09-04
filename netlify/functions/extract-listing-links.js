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

    // 1 — Récupérer la page nous-mêmes, même approche que extract-listing.js
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
        return { statusCode: 200, headers, body: JSON.stringify({ error: `This site returned an error (${pageRes.status}) — it may be blocking automated access.` }) };
      }
      html = await pageRes.text();
    } catch (fetchErr) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not reach that URL — it may be blocking automated access.' }) };
    }

    // 2 — Ne garder que les <a href="..."> pour cette étape — on cherche
    // des LIENS, pas le contenu d'une fiche, donc pas besoin d'envoyer toute
    // la page (souvent bien plus lourde qu'une seule fiche) au modèle.
    const linkMatches = [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
    const candidates = linkMatches.map(m => {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      return { href, text };
    }).filter(c => c.href && !c.href.startsWith('#') && !c.href.startsWith('mailto:') && !c.href.startsWith('tel:'));

    if (!candidates.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'No links found on that page at all.' }) };
    }

    // Rendre chaque lien absolu par rapport à la page d'origine, avant de
    // les envoyer au modèle — sinon un lien relatif ("/listing/123") est
    // inutilisable une fois renvoyé seul, sans le contexte de la page.
    let baseOrigin;
    try { baseOrigin = new URL(url); } catch (e) {}
    const absolute = candidates.map(c => {
      try { return { href: new URL(c.href, baseOrigin).href, text: c.text }; }
      catch (e) { return null; }
    }).filter(Boolean);

    const uniqueByHref = [...new Map(absolute.map(c => [c.href, c])).values()].slice(0, 400);

    const listForModel = uniqueByHref.map((c, i) => `${i}: ${c.href} | "${c.text}"`).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Here is a numbered list of every link found on a real estate agency's "all listings" page, in the format "index: url | link text".\n\nIdentify which of these links point to an INDIVIDUAL property listing's own detail page (a specific property you could view and get full details on) — NOT navigation links, category/filter links, pagination, social media, contact pages, or the agency's own homepage.\n\nReturn ONLY valid JSON: {"listing_indexes":[0,3,7,...]}\n\nIf you genuinely can't tell any apart from navigation, return {"listing_indexes":[]}.\n\nLinks:\n${listForModel}`
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
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not identify listing links on that page' }) };
    }

    const indexes = Array.isArray(parsed.listing_indexes) ? parsed.listing_indexes : [];
    const listingUrls = indexes
      .map(i => uniqueByHref[i]?.href)
      .filter(Boolean);
    const uniqueListingUrls = [...new Set(listingUrls)];

    if (!uniqueListingUrls.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "Couldn't find any individual listing links on that page — try pasting a link to one specific listing instead, or check this is really a listings/search page." }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ urls: uniqueListingUrls }) };

  } catch (e) {
    console.error('extract-listing-links error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
