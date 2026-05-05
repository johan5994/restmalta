// This function waits and then triggers select-best-agent
// Netlify functions have a max timeout of 26 seconds on free plan
// For 5 minutes we use a different approach — we call select-best-agent immediately
// after checking if enough time has passed since the visit was marked agents_applying

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { visit_id, delay_minutes = 5 } = JSON.parse(event.body || '{}');

    const sb = createClient(
      'https://clfqftbvohwybkrtvylo.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check when status was changed to agents_applying
    const { data: visit } = await sb.from('visits').select('*').eq('id', visit_id).single();

    if (!visit) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Visit not found' }) };
    }

    // If already assigned, skip
    if (visit.status === 'agent_assigned' || visit.status === 'confirmed') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned' }) };
    }

    // Schedule the selection — we call select-best-agent via a background task
    // Since Netlify free plan has 10s timeout, we trigger it immediately
    // The select-best-agent function will run and pick the best agent
    const SITE = process.env.URL || 'https://restmalta.com';
    
    // Fire and forget — don't await
    fetch(`${SITE}/.netlify/functions/select-best-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visit_id, wait_minutes: delay_minutes })
    }).catch(() => {});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Selection scheduled for visit ${visit_id}` })
    };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
