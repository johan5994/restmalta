const { createClient } = require('@supabase/supabase-js');

// Helper — génère un thread_id unique pour une paire de participants
function makeThreadId(listingId, id1, id2) {
  return listingId + '__' + [id1, id2].sort().join('__');
}


const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { visit_id, delay_minutes = 5 } = JSON.parse(event.body || '{}');
    if (!visit_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'visit_id required' }) };

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    let visit = null;
    try { const { data } = await sb.from('visits').select('*').eq('id', visit_id).single(); visit = data; } catch(e) {}

    if (!visit) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Visit not found' }) };
    if (visit.status === 'agent_assigned' || visit.status === 'confirmed') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned' }) };
    }

    const applyingSince = visit.agents_applying_since ? new Date(visit.agents_applying_since) : new Date();
    const now = new Date();
    const elapsedMs = now - applyingSince;
    const targetMs = delay_minutes * 60 * 1000;
    const remainingMs = Math.max(0, targetMs - elapsedMs);

    console.log(`Visit ${visit_id} — elapsed: ${Math.round(elapsedMs/1000)}s, remaining: ${Math.round(remainingMs/1000)}s`);

    const MAX_WAIT = 9000; // 9s max par invocation Netlify

    if (remainingMs <= MAX_WAIT) {
      // Attendre le temps restant puis sélectionner
      if (remainingMs > 0) await new Promise(r => setTimeout(r, remainingMs));

      // Revérifier
      let visitFinal = null;
      try { const { data } = await sb.from('visits').select('status').eq('id', visit_id).single(); visitFinal = data; } catch(e) {}
      if (visitFinal?.status === 'agent_assigned' || visitFinal?.status === 'confirmed') {
        return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned' }) };
      }

      // Sélectionner maintenant
      const result = await selectBestAgent(sb, visit_id);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, result }) };

    } else {
      // Trop long — attendre 9s et reschedule
      await new Promise(r => setTimeout(r, MAX_WAIT));

      const SITE = process.env.URL || 'https://restmalta.com';
      fetch(`${SITE}/.netlify/functions/schedule-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_id, delay_minutes })
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Rescheduled' }) };
    }

  } catch (e) {
    console.error('schedule-selection error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

async function selectBestAgent(sb, visit_id) {
  let visit = null;
  try { const { data } = await sb.from('visits').select('*').eq('id', visit_id).single(); visit = data; } catch(e) {}
  if (!visit) return 'visit not found';

  let applications = [];
  try {
    const { data } = await sb.from('messages').select('sender_id').eq('type', 'agent_application').eq('visit_id', visit_id);
    applications = data || [];
  } catch(e) {}

  if (!applications.length) {
    await sb.from('visits').update({ status: 'no_agent' }).eq('id', visit_id).catch(() => {});
    await sb.from('messages').insert({
      listing_id: visit.listing_id, sender_id: 'system', receiver_id: visit.landlord_id,
      content: `⚠️ No agents applied for the visit on ${visit.visit_date}. You may need to handle this visit yourself.`,
      type: 'visit_info'
    }).catch(() => {});
    return 'no agents applied';
  }

  const agentIds = [...new Set(applications.map(a => a.sender_id))];
  let bestAgentId = null, bestAgentName = 'Agent', bestScore = -1;

  for (const agentId of agentIds) {
    let reviews = [];
    try { const { data } = await sb.from('reviews').select('rating').eq('agent_id', agentId); reviews = data || []; } catch(e) {}
    const score = reviews.length ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;
    if (score > bestScore || bestAgentId === null) {
      bestScore = score;
      bestAgentId = agentId;
      let profile = null;
      try { const { data } = await sb.from('profiles').select('full_name').eq('clerk_id', agentId).single(); profile = data; } catch(e) {}
      bestAgentName = profile?.full_name || 'Agent';
    }
  }

  await sb.from('visits').update({ agent_id: bestAgentId, agent_name: bestAgentName, status: 'agent_assigned' }).eq('id', visit_id).catch(() => {});

  let listing = null;
  try { const { data } = await sb.from('listings').select('*').eq('id', visit.listing_id).single(); listing = data; } catch(e) {}

  // Récupérer le profil tenant pour avoir le phone
  let tenantProfile = null;
  try { const { data } = await sb.from('profiles').select('full_name,phone,email').eq('clerk_id', visit.tenant_id).single(); tenantProfile = data; } catch(e) {}
  const tenantPhone = tenantProfile?.phone || visit.tenant_phone || '—';

  // Récupérer le profil landlord pour avoir le phone
  let landlordProfile = null;
  try { const { data } = await sb.from('profiles').select('full_name,phone,email').eq('clerk_id', visit.landlord_id).single(); landlordProfile = data; } catch(e) {}

  const SITE = process.env.URL || 'https://restmalta.com';

  // ── Créer conversation agent ↔ tenant ──────────────────────
  await sb.from('messages').insert({
    listing_id: visit.listing_id,
    sender_id: bestAgentId,
    receiver_id: visit.tenant_id,
    content: `👋 Hi ${visit.tenant_name || 'there'}! I'm ${bestAgentName}, your RestMalta agent for the visit.

📅 ${visit.visit_date} at ${visit.visit_time || 'TBD'}
🏠 ${listing?.title || '—'}
📍 ${listing?.full_address || listing?.zone || '—'}

Feel free to message me here if you have any questions before the visit!`,
    type: 'agent_tenant_chat'
  }).catch(() => {});

  // ── Créer conversation agent ↔ landlord ────────────────────
  await sb.from('messages').insert({
    listing_id: visit.listing_id,
    sender_id: bestAgentId,
    receiver_id: visit.landlord_id,
    content: `👋 Hi ${landlordProfile?.full_name || 'there'}! I'm ${bestAgentName}, assigned to the visit for your property.

📅 ${visit.visit_date} at ${visit.visit_time || 'TBD'}
👤 Tenant: ${visit.tenant_name || '—'} — 📞 ${tenantPhone}

I'll be handling the visit. Feel free to message me here if needed.`,
    type: 'agent_landlord_chat'
  }).catch(() => {});

  // Message agent sélectionné avec phone du tenant
  await sb.from('messages').insert({
    listing_id: visit.listing_id, sender_id: 'system', receiver_id: bestAgentId,
    content: `🎉 You have been selected for this visit!\n\n🏠 ${listing?.title || '—'}\n📍 ${listing?.full_address || listing?.zone || '—'}\n📅 ${visit.visit_date} at ${visit.visit_time || 'TBD'}\n👤 Tenant: ${visit.tenant_name || '—'}\n📞 Tenant phone: ${tenantPhone}\n🔑 Keys: ${listing?.key_location || 'Contact landlord'}`,
    type: 'agent_selected'
  }).catch(() => {});

  // Message tenant
  await sb.from('messages').insert({
    listing_id: visit.listing_id, sender_id: 'system', receiver_id: visit.tenant_id,
    content: `✅ Your visit is confirmed!\n\nAgent: ${bestAgentName}\nDate: ${visit.visit_date} at ${visit.visit_time || 'TBD'}\nProperty: ${listing?.title || '—'}\nAddress: ${listing?.full_address || listing?.zone || '—'}\n\n⚠️ Please confirm your presence in your dashboard → My Visits.\nNO-SHOW POLICY: €50 fee if no-show without 24h cancellation.`,
    type: 'visit_confirmed_noshow'
  }).catch(() => {});

  // Message landlord
  await sb.from('messages').insert({
    listing_id: visit.listing_id, sender_id: 'system', receiver_id: visit.landlord_id,
    content: `✅ Visit assigned!\n\nAgent: ${bestAgentName}\nDate: ${visit.visit_date} at ${visit.visit_time || 'TBD'}\nTenant: ${visit.tenant_name || '—'}`,
    type: 'visit_info'
  }).catch(() => {});

  // Messages agents non sélectionnés
  for (const agentId of agentIds) {
    if (agentId !== bestAgentId) {
      await sb.from('messages').insert({
        listing_id: visit.listing_id, sender_id: 'system', receiver_id: agentId,
        content: `ℹ️ Visit assigned to another agent (higher rating).\n\nProperty: ${listing?.title || '—'}\nDate: ${visit.visit_date}\n\nThank you for applying!`,
        type: 'agent_not_selected'
      }).catch(() => {});
    }
  }

  // Email agent
  let agentProfile = null;
  try { const { data } = await sb.from('profiles').select('email').eq('clerk_id', bestAgentId).single(); agentProfile = data; } catch(e) {}
  if (agentProfile?.email) {
    fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: 'agent_selected', to: agentProfile.email,
        data: { agentName: bestAgentName, visitDate: visit.visit_date, visitTime: visit.visit_time || 'TBD',
          listingTitle: listing?.title || '—', address: listing?.full_address || listing?.zone || '—',
          tenantName: visit.tenant_name || '—', keyInfo: listing?.key_location || 'Contact landlord',
          dashboardUrl: `${SITE}/agent-dashboard.html` }
      })
    }).catch(() => {});
  }

  console.log(`Visit ${visit_id} — assigned to ${bestAgentName}`);
  return `assigned to ${bestAgentName}`;
}
