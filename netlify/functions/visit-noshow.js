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
    const { action, tenant_email, tenant_name, visit_id, listing_title, visit_date, visit_time, payment_method_id } = JSON.parse(event.body);

    if (action === 'setup_payment') {
      // Create or get Stripe customer
      let customer;
      const existing = await stripe.customers.list({ email: tenant_email, limit: 1 });
      if (existing.data.length > 0) {
        customer = existing.data[0];
      } else {
        customer = await stripe.customers.create({
          email: tenant_email,
          name: tenant_name || 'Tenant',
          metadata: { visit_id }
        });
      }

      // Create SetupIntent to save card
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        metadata: { visit_id, tenant_email }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          client_secret: setupIntent.client_secret,
          customer_id: customer.id
        })
      };
    }

    if (action === 'charge_noshow') {
      // Charge 50€ no-show fee
      const customers = await stripe.customers.list({ email: tenant_email, limit: 1 });
      if (!customers.data.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No payment method on file' }) };
      }

      const customer = customers.data[0];
      const paymentMethods = await stripe.paymentMethods.list({ customer: customer.id, type: 'card' });

      if (!paymentMethods.data.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No card on file' }) };
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: 5000, // €50.00
        currency: 'eur',
        customer: customer.id,
        payment_method: paymentMethods.data[0].id,
        confirm: true,
        off_session: true,
        description: `RestMalta no-show fee — ${listing_title} — ${visit_date} at ${visit_time}`,
        metadata: { visit_id, type: 'noshow_fee' }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          payment_intent_id: paymentIntent.id,
          amount_charged: 50
        })
      };
    }

    if (action === 'cancel_visit') {
      // Tenant cancels 24h+ before — no charge
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Visit cancelled — no charge' })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
