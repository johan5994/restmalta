const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Abonnement hebdomadaire (2€/semaine) pour qu'une annonce "For sale" reste
// en ligne — payé par le PROPRIÉTAIRE du bien, pas par l'agence (qui a déjà
// son propre abonnement RestMalta et poste gratuitement pour ses clients).
// Pas de commission sur la transaction, juste la visibilité de l'annonce.
const WEEKLY_PRICE_CENTS = 200;

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
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { listing_id, landlord_email, landlord_name, listing_title } = JSON.parse(event.body);

    if (!listing_id || !landlord_email) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing listing_id or landlord_email' }) };
    }

    // Client Stripe — le PROPRIÉTAIRE paie, pas l'agence (qui a déjà son
    // propre abonnement RestMalta et poste gratuitement pour ses clients)
    let customerId;
    const existing = await stripe.customers.list({ email: landlord_email, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: landlord_email,
        name: landlord_name || 'Landlord',
        metadata: { listing_id }
      });
      customerId = customer.id;
    }

    // Prix récurrent hebdomadaire — recherché par lookup_key, créé une seule
    // fois puis réutilisé pour tout le monde (évite de dupliquer produit/prix
    // à chaque nouvelle annonce).
    let priceId;
    const existingPrices = await stripe.prices.list({ lookup_keys: ['sale_listing_weekly'], limit: 1 });
    if (existingPrices.data.length > 0) {
      priceId = existingPrices.data[0].id;
    } else {
      const product = await stripe.products.create({ name: 'RestMalta — Sale listing visibility (weekly)' });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: WEEKLY_PRICE_CENTS,
        currency: 'eur',
        recurring: { interval: 'week' },
        lookup_key: 'sale_listing_weekly'
      });
      priceId = price.id;
    }

    const SITE = process.env.URL || 'https://restmalta.netlify.app';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE}/index.html?sale_activated=${listing_id}`,
      cancel_url: `${SITE}/index.html?sale_cancelled=${listing_id}`,
      metadata: {
        type: 'sale_listing_subscription',
        listing_id
      },
      subscription_data: {
        metadata: { type: 'sale_listing_subscription', listing_id }
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, checkout_url: session.url })
    };

  } catch (e) {
    console.error('create-sale-subscription error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
