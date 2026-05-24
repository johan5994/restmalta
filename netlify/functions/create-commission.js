const Stripe = require('stripe');

// Commissions RestMalta — modèle maltais
// AVEC agent  : Tenant 40% TTC + Landlord 40% TTC
// SANS agent  : Tenant 15% TTC + Landlord 0%
// TVA maltaise 18% incluse dans les %

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
      lease_id, monthly_rent,
      landlord_email, landlord_name, landlord_stripe_customer_id,
      tenant_email, tenant_name, tenant_stripe_customer_id,
      property_address, has_agent, agent_email, agent_name,
      holding_commission_already_paid
    } = JSON.parse(event.body);

    const rent = parseFloat(monthly_rent) || 0;
    const desc = property_address || 'Malta property';

    // ── Taux selon présence agent ──────────────────────────────
    const tenantRate  = has_agent ? 0.40 : 0.15;  // 40% avec agent, 15% sans
    const landlordRate = has_agent ? 0.40 : 0.00; // 40% avec agent, 0% sans

    const landlordAmountTTC = Math.round(rent * landlordRate * 100); // centimes
    const tenantAmountTTC   = holding_commission_already_paid
      ? 0
      : Math.round(rent * tenantRate * 100);

    // Part agent : 50% de la commission tenant si avec agent
    const agentAmount = has_agent && tenantAmountTTC > 0
      ? Math.round(tenantAmountTTC * 0.5) / 100
      : 0;

    // ── Landlord ───────────────────────────────────────────────
    let landlordResult = {};
    if (landlordAmountTTC === 0) {
      landlordResult = { amount: 0, method: 'none', payment_url: null };
    } else if (landlord_stripe_customer_id) {
      try {
        const pms = await stripe.paymentMethods.list({ customer: landlord_stripe_customer_id, type: 'card' });
        if (pms.data.length > 0) {
          const pi = await stripe.paymentIntents.create({
            amount: landlordAmountTTC, currency: 'eur',
            customer: landlord_stripe_customer_id, payment_method: pms.data[0].id,
            confirm: true, off_session: true,
            description: `RestMalta commission landlord — ${desc}`,
            metadata: { lease_id, role: 'landlord' }
          });
          landlordResult = { amount: landlordAmountTTC/100, method: 'direct_charge', payment_intent_id: pi.id, status: pi.status, payment_url: null };
        } else { throw new Error('no card'); }
      } catch(e) {
        const s = await createCheckoutSession(stripe, 'landlord', landlord_email, landlordAmountTTC, desc, lease_id, has_agent, agentAmount, agent_email);
        landlordResult = { amount: landlordAmountTTC/100, method: 'checkout_link', payment_url: s.url, session_id: s.id };
      }
    } else {
      const s = await createCheckoutSession(stripe, 'landlord', landlord_email, landlordAmountTTC, desc, lease_id, has_agent, agentAmount, agent_email);
      landlordResult = { amount: landlordAmountTTC/100, method: 'checkout_link', payment_url: s.url, session_id: s.id };
    }

    // ── Tenant ─────────────────────────────────────────────────
    let tenantResult = {};
    if (holding_commission_already_paid) {
      tenantResult = { amount: 0, method: 'already_paid', payment_url: null };
    } else if (tenant_stripe_customer_id) {
      try {
        const pms = await stripe.paymentMethods.list({ customer: tenant_stripe_customer_id, type: 'card' });
        if (pms.data.length > 0) {
          const pi = await stripe.paymentIntents.create({
            amount: tenantAmountTTC, currency: 'eur',
            customer: tenant_stripe_customer_id, payment_method: pms.data[0].id,
            confirm: true, off_session: true,
            description: `RestMalta commission tenant — ${desc}`,
            metadata: { lease_id, role: 'tenant' }
          });
          tenantResult = { amount: tenantAmountTTC/100, method: 'direct_charge', payment_intent_id: pi.id, status: pi.status, payment_url: null };
        } else { throw new Error('no card'); }
      } catch(e) {
        const s = await createCheckoutSession(stripe, 'tenant', tenant_email, tenantAmountTTC, desc, lease_id, has_agent, agentAmount, agent_email);
        tenantResult = { amount: tenantAmountTTC/100, method: 'checkout_link', payment_url: s.url, session_id: s.id };
      }
    } else {
      const s = await createCheckoutSession(stripe, 'tenant', tenant_email, tenantAmountTTC, desc, lease_id, has_agent, agentAmount, agent_email);
      tenantResult = { amount: tenantAmountTTC/100, method: 'checkout_link', payment_url: s.url, session_id: s.id };
    }

    const restmaltaNet = Math.round(((landlordAmountTTC + tenantAmountTTC) / 100 / 1.18 - agentAmount) * 100) / 100;

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        landlord: landlordResult,
        tenant: tenantResult,
        agent_amount: agentAmount,
        breakdown: {
          model: has_agent ? 'with_agent' : 'direct',
          tenant_rate: has_agent ? '40% TTC' : '15% TTC',
          landlord_rate: has_agent ? '40% TTC' : '0%',
          landlord_ttc: landlordAmountTTC/100,
          tenant_ttc: tenantAmountTTC/100,
          restmalta_net_ht: restmaltaNet,
          agent_receives: agentAmount
        }
      })
    };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};

async function createCheckoutSession(stripe, role, email, amount, desc, lease_id, has_agent, agentAmount, agent_email) {
  const rateLabel = role === 'landlord'
    ? (has_agent ? '40%' : '0%')
    : (has_agent ? '40%' : '15%');
  return stripe.checkout.sessions.create({
    payment_method_types: ['card', 'sepa_debit'], mode: 'payment', customer_email: email,
    line_items: [{ price_data: { currency: 'eur', product_data: {
      name: `RestMalta Commission — ${role === 'landlord' ? 'Landlord' : 'Tenant'}`,
      description: `${rateLabel} commission (VAT included) — ${desc}` }, unit_amount: amount }, quantity: 1 }],
    metadata: { lease_id, role, has_agent: String(has_agent||false), agent_amount: String(agentAmount||0), agent_email: agent_email||'' },
    success_url: `https://restmalta.com/${role}-dashboard.html?payment=success`,
    cancel_url: `https://restmalta.com/${role}-dashboard.html?payment=cancelled`,
  });
}
