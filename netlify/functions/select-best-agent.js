const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const sb = createClient(
      'https://clfqftbvohwybkrtvylo.supabase.co',
      process.env.SUPABASE_SERVICE_KEY
    );

    const { visit_id } = JSON.parse(event.body || '{}');
    if (!visit_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'visit_id required' }) };

    // Get visit details
    const { data: visit } = await sb.from('visits').select('*').eq('id', visit_id).single();
    if (!visit) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Visit not found' }) };

    // Already assigned? Skip
    if (visit.status === 'agent_assigned' || visit.status === 'confirmed') {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already assigned' }) };
    }

    // Get all agents who applied (type='agent_application' for this visit)
    const { data: applications } = await sb.from('messages')
      .select('sender_id')
      .eq('type', 'agent_application')
      .eq('visit_id', visit_id);

    if (!applications || applications.length === 0) {
      // No agents applied — notify landlord and tenant
      await sb.from('messages').insert({
        listing_id: visit.listing_id,
        sender_id: 'system',
        receiver_id: visit.landlord_id,
        content: `⚠️ No agents applied for the visit on ${visit.visit_date} at ${visit.visit_time || 'TBD'} for tenant ${visit.tenant_name || '—'}.\n\nYou may need to handle this visit yourself or the tenant can request a new date.`,
        type: 'visit_info'
      });
      await sb.from('visits').update({ status: 'no_agent' }).eq('id', visit_id);
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No agents applied' }) };
    }

    // Get scores for all applicants
    const agentIds = [...new Set(applications.map(a => a.sender_id))];
    let bestAgentId = null;
    let bestAgentName = 'Agent';
    let bestScore = -1;

    for (const agentId of agentIds) {
      // Get reviews
      const { data: reviews } = await sb.from('reviews').select('rating').eq('agent_id', agentId);
      const score = reviews && reviews.length
        ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length
        : 0; // New agents get 0 score

      if (score > bestScore || bestAgentId === null) {
        bestScore = score;
        bestAgentId = agentId;
        // Get agent name
        const { data: profile } = await sb.from('profiles').select('full_name').eq('clerk_id', agentId).single();
        bestAgentName = profile?.full_name || 'Agent';
      }
    }

    // Get listing details for visit sheet
    const { data: listing } = await sb.from('listings').select('*').eq('id', visit.listing_id).single();

    // Assign best agent
    await sb.from('visits').update({
      agent_id: bestAgentId,
      agent_name: bestAgentName,
      status: 'agent_assigned'
    }).eq('id', visit_id);

    // Generate visit sheet
    const keyLabels = { keysafe: '🔐 Key safe on site', neighbor: '🏘️ With neighbour/concierge', agent: '🏆 Agent has the keys', landlord: '📞 Contact landlord' };
    const inventoryLabels = { mandatory: '✅ Owner will be present', if_possible: '👋 Owner if possible (agent signs if absent)', not_needed: '❌ Agent signs on behalf of owner' };
    const visitSheet = `━━━━━━━━━━━━━━━━━━━━━━━━
📋 VISIT SHEET — RestMalta
━━━━━━━━━━━━━━━━━━━━━━━━
🏠 Property: ${listing?.title || '—'}
📍 Address: ${listing?.full_address || listing?.zone || '—'}
📅 Date: ${visit.visit_date || '—'} at ${visit.visit_time || 'TBD'}
👤 Tenant: ${visit.tenant_name || '—'} (${visit.tenant_email || '—'})
🏆 Agent: ${bestAgentName}

🛏 Bedrooms: ${listing?.bedrooms || listing?.spots || '—'}
🏷 Type: ${listing?.type === 'short' ? 'Short-let' : 'Long-let'}
💰 Rent: €${listing?.price || '—'}/month
${listing?.furnished ? '✅ Furnished' : '❌ Unfurnished'}
${listing?.bills_included ? '✅ Bills included' : ''}
${listing?.parking ? '✅ Parking' : ''}
${listing?.pool ? '✅ Pool' : ''}

🔑 Key access: ${keyLabels[listing?.key_type] || 'Contact landlord'}
${listing?.key_location ? '└ ' + listing.key_location : ''}

📝 Entry inventory: ${inventoryLabels[listing?.inventory_presence] || 'Owner present'}
━━━━━━━━━━━━━━━━━━━━━━━━`;

    // Notify selected agent with full visit sheet
    await sb.from('messages').insert({
      listing_id: visit.listing_id,
      sender_id: 'system',
      receiver_id: bestAgentId,
      content: `🎉 You have been selected for this visit!\n\nYou were chosen as the best available agent (score: ${bestScore > 0 ? bestScore.toFixed(1) : 'New'}).\n\n${visitSheet}\n\nPlease confirm with the tenant through RestMalta.`,
      type: 'agent_selected'
    });

    // Notify tenant
    await sb.from('messages').insert({
      listing_id: visit.listing_id,
      sender_id: 'system',
      receiver_id: visit.tenant_id,
      content: `✅ Your visit is confirmed!\n\nAgent: ${bestAgentName}\nDate: ${visit.visit_date} at ${visit.visit_time || 'TBD'}\n\n⚠️ NO-SHOW POLICY: Cancel at least 24h before to avoid a €50 fee.\n\nRegister your card in your dashboard → My Visits.`,
      type: 'visit_confirmed_noshow'
    });

    // Notify landlord
    await sb.from('messages').insert({
      listing_id: visit.listing_id,
      sender_id: 'system',
      receiver_id: visit.landlord_id,
      content: `✅ Visit assigned!\n\nAgent: ${bestAgentName}\nDate: ${visit.visit_date} at ${visit.visit_time || 'TBD'}\nTenant: ${visit.tenant_name || '—'}\n\n${listing?.inventory_presence === 'mandatory' ? '⚠️ Remember: you must be present for the entry inventory.' : '✅ No action needed — agent handles everything.'}`,
      type: 'visit_info'
    });

    // Notify other applicants they were not selected
    for (const agentId of agentIds) {
      if (agentId !== bestAgentId) {
        await sb.from('messages').insert({
          listing_id: visit.listing_id,
          sender_id: 'system',
          receiver_id: agentId,
          content: `ℹ️ Visit assigned to another agent (higher rating).\n\nProperty: ${listing?.title || '—'}\nDate: ${visit.visit_date}\n\nThank you for applying — you'll receive other opportunities.`,
          type: 'agent_not_selected'
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agent_assigned: bestAgentName,
        score: bestScore,
        applicants: agentIds.length
      })
    };

  } catch (e) {
    console.error('select-best-agent error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
