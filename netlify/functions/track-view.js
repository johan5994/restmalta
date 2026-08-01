const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  if (!SUPABASE_KEY) {
    console.error('track-view: SUPABASE_SERVICE_KEY not configured');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const { listingId } = JSON.parse(event.body || '{}');
    if (!listingId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing listingId' }) };

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Lire la valeur actuelle puis incrémenter — la clé de service role
    // ignore toute politique RLS qui bloquerait un visiteur normal.
    const { data: listing, error: readErr } = await sb.from('listings').select('views').eq('id', listingId).single();
    if (readErr) {
      console.error('track-view: read failed', readErr.message);
      return { statusCode: 200, headers, body: JSON.stringify({ error: readErr.message }) };
    }

    const newViews = (listing?.views || 0) + 1;
    const { error: writeErr } = await sb.from('listings').update({ views: newViews }).eq('id', listingId);
    if (writeErr) {
      console.error('track-view: write failed', writeErr.message);
      return { statusCode: 200, headers, body: JSON.stringify({ error: writeErr.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, views: newViews }) };

  } catch (e) {
    console.error('track-view: exception', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
