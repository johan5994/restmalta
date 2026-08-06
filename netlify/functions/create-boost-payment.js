const Stripe = require('stripe');

// Boost d'annonce — paiement unique, place l'annonce en tête des résultats
// de recherche pendant une durée limitée. Pas d'abonnement, pas de
// reconduction automatique — le propriétaire/l'agence reprend un boost
// s'il veut prolonger.
const BOOST_PRICES = {
  rental: { amountCents: 500, days: 7, label: 'Listing boost — 7 days (rental)' },
  sale: { amountCents: 1500, days: 14, label: 'Listing boost — 14 days (sale)' }
};

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
    const { listing_id, listing_title, listing_type, payer_email, payer_name } = JSON.parse(event.body);

    if (!listing_id || !payer_email) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing listing_id or payer_email' }) };
    }

    const boostType = listing_type === 'for_sale' ? 'sale' : 'rental';
    const boost = BOOST_PRICES[boostType];

    const SITE = process.env.URL || 'https://restmalta.netlify.app';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: payer_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: boost.amountCents,
          product_data: { name: boost.label + (listing_title ? ` — ${listing_title}` : '') }
        },
        quantity: 1
      }],
      success_url: `${SITE}/index.html?boost_activated=${listing_id}`,
      cancel_url: `${SITE}/index.html?boost_cancelled=${listing_id}`,
      metadata: {
        type: 'listing_boost',
        listing_id,
        boost_days: String(boost.days)
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, checkout_url: session.url })
    };

  } catch (e) {
    console.error('create-boost-payment error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
