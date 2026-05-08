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

    let visit = null;
    try {
      const { data } = await sb.from('visits').select('*').eq('id', visit_id).single();
      visit = data;
    } catch(e) { visit = null; }

    if (!visit) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Visit not found' }) };

    // Déjà assigné → rien à faire
    if (visit.status === 'agent_assigned' || visit.status === 'confirmed') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned' }) };
    }

    const SITE = process.env.URL || 'https://restmalta.com';

    // Vérifier si 5 minutes se sont écoulées depuis agents_applying_since
    const applyingSince = visit.agents_applying_since ? new Date(visit.agents_applying_since) : null;
    const now = new Date();
    const minutesElapsed = applyingSince ? (now - applyingSince) / 1000 / 60 : 999;

    if (minutesElapsed >= delay_minutes) {
      // 5 min écoulées → sélectionner le meilleur agent maintenant
      console.log(`Visit ${visit_id} — ${minutesElapsed.toFixed(1)} min elapsed → selecting best agent`);
      
      // Appel direct (fire and forget) — select-best-agent s'exécute immédiatement
      fetch(`${SITE}/.netlify/functions/select-best-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_id, wait_minutes: 0 })
      }).catch(() => {});

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Selection triggered' }) };

    } else {
      // Pas encore 5 min — planifier un retry dans (5min - temps écoulé)
      const remainingMs = Math.max(0, (delay_minutes * 60 - (now - applyingSince) / 1000)) * 1000;
      const remainingSec = Math.round(remainingMs / 1000);
      console.log(`Visit ${visit_id} — ${minutesElapsed.toFixed(1)} min elapsed, retry in ${remainingSec}s`);

      // Retry via setTimeout (max 25s sur Netlify, donc on reschedule si besoin)
      const waitMs = Math.min(remainingMs, 24000);
      await new Promise(r => setTimeout(r, waitMs));

      // Après l'attente, vérifier à nouveau
      let visitUpdated = null;
      try {
        const { data } = await sb.from('visits').select('status,agents_applying_since').eq('id', visit_id).single();
        visitUpdated = data;
      } catch(e) { visitUpdated = null; }

      if (visitUpdated?.status === 'agent_assigned' || visitUpdated?.status === 'confirmed') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned during wait' }) };
      }

      const nowAfterWait = new Date();
      const totalElapsed = visitUpdated?.agents_applying_since
        ? (nowAfterWait - new Date(visitUpdated.agents_applying_since)) / 1000 / 60
        : delay_minutes + 1;

      if (totalElapsed >= delay_minutes) {
        // Maintenant on peut sélectionner
        fetch(`${SITE}/.netlify/functions/select-best-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visit_id, wait_minutes: 0 })
        }).catch(() => {});
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Selection triggered after wait' }) };
      } else {
        // Encore trop tôt — re-appeler schedule-selection pour continuer
        fetch(`${SITE}/.netlify/functions/schedule-selection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visit_id, delay_minutes })
        }).catch(() => {});
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Rescheduled' }) };
      }
    }

  } catch (e) {
    console.error('schedule-selection error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
