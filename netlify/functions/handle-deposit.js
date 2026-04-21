const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { paymentIntentId, action } = JSON.parse(event.body);

    if (action === 'capture') {
      // Tenant confirmed entry — release deposit to landlord
      const intent = await stripe.paymentIntents.capture(paymentIntentId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'captured', intent })
      };
    }

    if (action === 'cancel') {
      // Problem reported — refund tenant
      const intent = await stripe.paymentIntents.cancel(paymentIntentId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'cancelled', intent })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
