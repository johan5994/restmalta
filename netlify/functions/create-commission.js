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
      landlord_stripe_customer_id,  // si le landlord a une carte enregistrée
      tenant_email,
      tenant_name,
      tenant_stripe_customer_id,    // carte enregistrée via SetupIntent no-show
      property_address,
      has_agent,
      exclusive_mandate,
      has_escrow,
      agent_email,
      agent_name
    } = JSON.parse(event.body);

    const rent = parseFloat(monthly_rent) || 0;

    // ── Calcul des commissions ─────────────────────────────────
    let landlordPct, tenantPct, agentAmount;

    if (has_agent && exclusive_mandate) {
      landlordPct = 0.25;
      tenantPct   = 0.30;
      agentAmount = rent * 0.30;
    } else if (has_agent) {
      landlordPct = 0.30;
      tenantPct   = 0.30;
      agentAmount = rent * 0.30;
    } else {
      landlordPct = 0.05;
      tenantPct   = 0.05;
      agentAmount = 0;
    }

    const escrowExtra = has_escrow ? rent * 0.05 : 0;
    const landlordAmount = Math.round(rent * landlordPct * 100); // en centimes
    const tenantAmount   = Math.round((rent * tenantPct + escrowExtra) * 100);
    const desc = property_address || 'Malta property';

    // ── Tenant — prélèvement direct si carte enregistrée ──────
    let tenantResult = {};

    if (tenant_stripe_customer_id) {
      // Récupérer la carte enregistrée du tenant
      const paymentMethods = await stripe.paymentMethods.list({
        customer: tenant_stripe_customer_id,
        type: 'card'
      });

      if (paymentMethods.data.length > 0) {
        // Prélèvement direct
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: tenantAmount,
            currency: 'eur',
            customer: tenant_stripe_customer_id,
            payment_method: paymentMethods.data[0].id,
            confirm: true,
            off_session: true,
            description: `RestMalta commission (tenant) — ${desc}`,
            metadata: { lease_id, role: 'tenant', has_escrow: String(has_escrow) }
          });

          tenantResult = {
            amount: tenantAmount / 100,
            method: 'direct_charge',
            payment_intent_id: paymentIntent.id,
            status: paymentIntent.status,
            payment_url: null
          };
        } catch (chargeErr) {
          // Echec du prélèvement → fallback lien de paiement
          console.warn('Direct charge failed for tenant:', chargeErr.message);
          const session = await createCheckoutSession(stripe, 'tenant', tenant_email, tenantAmount, desc, lease_id, has_escrow, agentAmount, agent_email);
          tenantResult = {
            amount: tenantAmount / 100,
            method: 'checkout_link',
            payment_url: session.url,
            session_id: session.id
          };
        }
      } else {
        // Pas de carte → lien de paiement
        const session = await createCheckoutSession(stripe, 'tenant', tenant_email, tenantAmount, desc, lease_id, has_escrow, agentAmount, agent_email);
        tenantResult = {
          amount: tenantAmount / 100,
          method: 'checkout_link',
          payment_url: session.url,
          session_id: session.id
        };
      }
    } else {
      // Pas de customer_id → lien de paiement
      const session = await createCheckoutSession(stripe, 'tenant', tenant_email, tenantAmount, desc, lease_id, has_escrow, agentAmount, agent_email);
      tenantResult = {
        amount: tenantAmount / 100,
        method: 'checkout_link',
        payment_url: session.url,
        session_id: session.id
      };
    }

    // ── Landlord — prélèvement direct si carte, sinon lien ────
    let landlordResult = {};

    if (landlord_stripe_customer_id) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: landlord_stripe_customer_id,
        type: 'card'
      });

      if (paymentMethods.data.length > 0) {
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: landlordAmount,
            currency: 'eur',
            customer: landlord_stripe_customer_id,
            payment_method: paymentMethods.data[0].id,
            confirm: true,
            off_session: true,
            description: `RestMalta commission (landlord) — ${desc}`,
            metadata: {
              lease_id, role: 'landlord',
              has_agent: String(has_agent),
              agent_amount: String(agentAmount),
              agent_email: agent_email || ''
            }
          });

          landlordResult = {
            amount: landlordAmount / 100,
            method: 'direct_charge',
            payment_intent_id: paymentIntent.id,
            status: paymentIntent.status,
            payment_url: null
          };
        } catch (chargeErr) {
          console.warn('Direct charge failed for landlord:', chargeErr.message);
          const session = await createCheckoutSession(stripe, 'landlord', landlord_email, landlordAmount, desc, lease_id, false, agentAmount, agent_email, exclusive_mandate, has_agent);
          landlordResult = {
            amount: landlordAmount / 100,
            method: 'checkout_link',
            payment_url: session.url,
            session_id: session.id
          };
        }
      } else {
        const session = await createCheckoutSession(stripe, 'landlord', landlord_email, landlordAmount, desc, lease_id, false, agentAmount, agent_email, exclusive_mandate, has_agent);
        landlordResult = {
          amount: landlordAmount / 100,
          method: 'checkout_link',
          payment_url: session.url,
          session_id: session.id
        };
      }
    } else {
      const session = await createCheckoutSession(stripe, 'landlord', landlord_email, landlordAmount, desc, lease_id, false, agentAmount, agent_email, exclusive_mandate, has_agent);
      landlordResult = {
        amount: landlordAmount / 100,
        method: 'checkout_link',
        payment_url: session.url,
        session_id: session.id
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        landlord: landlordResult,
        tenant: tenantResult,
        agent_amount: agentAmount,
        breakdown: {
          landlord_pct: Math.round(landlordPct * 100) + '%',
          tenant_pct: Math.round(tenantPct * 100) + '%' + (has_escrow ? ' + 5% escrow' : ''),
          agent_receives: agentAmount,
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

// ── Helper — créer un lien Checkout Stripe ────────────────────
async function createCheckoutSession(stripe, role, email, amount, desc, lease_id, has_escrow, agentAmount, agent_email, exclusive_mandate, has_agent) {
  return stripe.checkout.sessions.create({
    payment_method_types: ['card', 'sepa_debit'],
    mode: 'payment',
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: `RestMalta Commission — ${role === 'landlord' ? 'Landlord' : 'Tenant'}`,
          description: role === 'landlord'
            ? `${has_agent ? (exclusive_mandate ? '25%' : '30%') : '5%'} commission for: ${desc}`
            : `${has_agent ? '30%' : '5%'} commission${has_escrow ? ' + 5% escrow' : ''} for: ${desc}`
        },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    metadata: {
      lease_id,
      role,
      has_escrow: String(has_escrow || false),
      agent_amount: String(agentAmount || 0),
      agent_email: agent_email || ''
    },
    success_url: `https://restmalta.com/${role}-dashboard.html?payment=success`,
    cancel_url: `https://restmalta.com/${role}-dashboard.html?payment=cancelled`,
  });
}
