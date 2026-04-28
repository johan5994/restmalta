const Stripe = require('stripe');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const {
      lease_id,
      monthly_rent,
      landlord_email,
      landlord_name,
      tenant_email,
      tenant_name,
      property_address,
      has_agent,        // bool
      exclusive_mandate, // bool
      has_escrow,       // bool
      agent_email,
      agent_name
    } = JSON.parse(event.body);

    const rent = parseFloat(monthly_rent) || 0;

    // ── Calculate commissions ──────────────────────────────────
    let landlordPct, tenantPct, agentAmount;

    if (has_agent && exclusive_mandate) {
      landlordPct = 0.25;  // 25%
      tenantPct   = 0.30;  // 30%
      agentAmount = rent * 0.30; // agent gets 1x 30%
    } else if (has_agent) {
      landlordPct = 0.30;  // 30%
      tenantPct   = 0.30;  // 30%
      agentAmount = rent * 0.30; // agent gets 1x 30%
    } else {
      landlordPct = 0.05;  // 5%
      tenantPct   = 0.05;  // 5%
      agentAmount = 0;
    }

    // Escrow adds 5% to tenant only
    const escrowExtra = has_escrow ? rent * 0.05 : 0;

    const landlordAmount = Math.round(rent * landlordPct * 100); // in cents
    const tenantAmount   = Math.round((rent * tenantPct + escrowExtra) * 100);

    const desc = property_address || 'Malta property';

    // ── Create Stripe Payment Links ────────────────────────────
    // Landlord commission
    const landlordSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'sepa_debit'],
      mode: 'payment',
      customer_email: landlord_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `RestMalta Commission — Landlord`,
            description: `${has_agent ? (exclusive_mandate ? '25%' : '30%') : '5%'} commission for: ${desc}${has_escrow ? ' (incl. escrow)' : ''}`,
          },
          unit_amount: landlordAmount,
        },
        quantity: 1,
      }],
      metadata: {
        lease_id,
        role: 'landlord',
        has_agent: String(has_agent),
        exclusive_mandate: String(exclusive_mandate),
        agent_amount: String(agentAmount),
        agent_email: agent_email || '',
      },
      success_url: 'https://restmalta.com/landlord-dashboard.html?payment=success',
      cancel_url: 'https://restmalta.com/landlord-dashboard.html?payment=cancelled',
    });

    // Tenant commission
    const tenantSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'sepa_debit'],
      mode: 'payment',
      customer_email: tenant_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `RestMalta Commission — Tenant`,
            description: `${has_agent ? '30%' : '5%'} commission${has_escrow ? ' + 5% escrow service' : ''} for: ${desc}`,
          },
          unit_amount: tenantAmount,
        },
        quantity: 1,
      }],
      metadata: {
        lease_id,
        role: 'tenant',
        has_escrow: String(has_escrow),
      },
      success_url: 'https://restmalta.com/tenant-dashboard.html?payment=success',
      cancel_url: 'https://restmalta.com/tenant-dashboard.html?payment=cancelled',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        landlord: {
          amount: landlordAmount / 100,
          payment_url: landlordSession.url,
          session_id: landlordSession.id,
        },
        tenant: {
          amount: tenantAmount / 100,
          payment_url: tenantSession.url,
          session_id: tenantSession.id,
        },
        agent_amount: agentAmount,
        breakdown: {
          landlord_pct: Math.round(landlordPct * 100) + '%',
          tenant_pct: Math.round(tenantPct * 100) + '%' + (has_escrow ? ' + 5% escrow' : ''),
          agent_receives: agentAmount,
          restmalta_net_landlord: (landlordAmount / 100) - agentAmount,
          restmalta_net_tenant: tenantAmount / 100,
          restmalta_total: (landlordAmount / 100) + (tenantAmount / 100) - agentAmount,
        }
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
