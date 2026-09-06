const Stripe = require('stripe');

// Frais de publication pour les annonces "Room rental" — RestMalta ne
// prend aucune commission sur ce type d'annonce (pas de bail/EDL généré
// non plus, volontairement laissé informel), donc un petit montant fixe
// est demandé à la publication à la place, une seule fois par annonce.
const ROOM_RENTAL_FEE_CENTS = 300; // €3

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
    const { listing_id, listing_title, payer_email } = JSON.parse(event.body);

    if (!listing_id || !payer_email) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing listing_id or payer_email' }) };
    }

    const SITE = process.env.URL || 'https://restmalta.netlify.app';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: payer_email,
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: ROOM_RENTAL_FEE_CENTS,
          product_data: { name: 'Room rental posting fee' + (listing_title ? ` — ${listing_title}` : '') }
        },
        quantity: 1
      }],
      success_url: `${SITE}/index.html?room_rental_fee_paid=${listing_id}`,
      cancel_url: `${SITE}/index.html?room_rental_fee_cancelled=${listing_id}`,
      metadata: {
        type: 'room_rental_fee',
        listing_id
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, checkout_url: session.url })
    };

  } catch (e) {
    console.error('create-room-rental-fee-payment error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
