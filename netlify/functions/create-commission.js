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
      lease_id, monthly_rent,
      landlord_email, landlord_name, landlord_stripe_customer_id,
      has_agent, exclusive_mandate,
      holding_commission_already_paid
    } = JSON.parse(event.body);

    const rent = parseFloat(monthly_rent) || 0;

    // Taux
    const landlordRate = has_agent ? (exclusive_mandate ? 0.35 : 0.40) : 0.00;
    const landlordAmountCents = Math.round(rent * landlordRate * 100);

    let landlordResult = { amount: 0, method: 'none', payment_url: null };

    if (landlordAmountCents > 0) {
      // Essayer prélèvement direct si carte enregistrée
      if (landlord_stripe_customer_id) {
        try {
          const pms = await stripe.paymentMethods.list({
            customer: landlord_stripe_customer_id,
            type: 'card'
          });
          if (pms.data.length > 0) {
            const pi = await stripe.paymentIntents.create({
              amount: landlordAmountCents,
              currency: 'eur',
              customer: landlord_stripe_customer_id,
              payment_method: pms.data[0].id,
              confirm: true,
              off_session: true,
              description: `Platform commission — landlord — ${landlordRate*100}%`,
              metadata: { lease_id: lease_id||'' }
            });
            landlordResult = {
              amount: landlordAmountCents / 100,
              method: 'direct_charge',
              payment_intent_id: pi.id,
              status: pi.status,
              payment_url: null
            };
          } else {
            throw new Error('no card on file');
          }
        } catch(e) {
          // Fallback — créer un Payment Link
          const paymentLink = await createPaymentLink(stripe, landlordAmountCents, landlord_email, lease_id, landlordRate);
          landlordResult = {
            amount: landlordAmountCents / 100,
            method: 'payment_link',
            payment_url: paymentLink
          };
        }
      } else {
        // Pas de customer — créer un Payment Link
        const paymentLink = await createPaymentLink(stripe, landlordAmountCents, landlord_email, lease_id, landlordRate);
        landlordResult = {
          amount: landlordAmountCents / 100,
          method: 'payment_link',
          payment_url: paymentLink
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        landlord: landlordResult,
        tenant: { amount: 0, method: 'already_paid' }
      })
    };

  } catch(e) {
    console.error('create-commission error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};

async function createPaymentLink(stripe, amountCents, email, lease_id, rate) {
  try {
    // Créer un produit + price + payment link
    const price = await stripe.prices.create({
      currency: 'eur',
      unit_amount: amountCents,
      product_data: {
        name: `Platform Commission (${Math.round(rate*100)}% TTC)`
      }
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { lease_id: lease_id||'', role: 'landlord' }
    });
    return link.url;
  } catch(e) {
    console.error('Payment link error:', e.message);
    return null;
  }
}
