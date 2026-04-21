const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' };
  }

  try {
    const { amount, currency, metadata } = JSON.parse(event.body);

    // Create a PaymentIntent — money is captured but held
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency: currency || 'eur',
      capture_method: 'manual', // IMPORTANT: holds funds without capturing
      metadata: {
        tenant_id: metadata.tenant_id || '',
        landlord_id: metadata.landlord_id || '',
        listing_id: metadata.listing_id || '',
        listing_title: metadata.listing_title || '',
        type: 'escrow_deposit'
      },
      description: `RestMalta escrow deposit — ${metadata.listing_title || 'Listing'}`
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      })
    };
  } catch (error) {
    console.error('Stripe error:', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
