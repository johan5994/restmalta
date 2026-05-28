const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Commission RestMalta : 40% TTC (TVA 18% incluse) de chaque côté
// Logique : si loyer = 1000€ → commission = 400€ TTC par partie
// Net RestMalta = 400 / 1.18 = 338.98€ HT
const COMMISSION_RATE = 0.40; // 40% TTC

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

    const { action, ...params } = JSON.parse(event.body);

    // ── ACTION: Commission landlord ──
    if (action === 'create_landlord_commission') {
      const { booking_id, amount_cents, landlord_id, landlord_email } = params;

      // Créer ou récupérer le customer Stripe
      let customerId;
      const existing = await stripe.customers.list({ email: landlord_email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: landlord_email,
          metadata: { landlord_id, booking_id }
        });
        customerId = customer.id;
      }

      // PaymentIntent pour la commission landlord
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount_cents,
        currency: 'eur',
        customer: customerId,
        payment_method_types: ['card'],
        metadata: { type: 'landlord_commission', booking_id, landlord_id },
        description: 'RestMalta — Commission landlord'
      });

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          client_secret: paymentIntent.client_secret,
          customer_id: customerId
        })
      };
    }

    // ── ACTION: Créer l'intention de paiement pour le Holding Deposit ──
    if (action === 'create_holding') {
      const { listing_id, tenant_id, tenant_email, tenant_name, tenant_stripe_customer_id, monthly_rent, has_agent } = params;

      // Holding Deposit = ½ mois de loyer
      const holdingAmount = Math.round((monthly_rent / 2) * 100); // en centimes

      // Commission RestMalta tenant :
      // AVEC agent  : 40% TTC
      // SANS agent  : 15% TTC
      const tenantRate = has_agent ? COMMISSION_RATE : 0.15;
      const commissionAmount = Math.round(monthly_rent * tenantRate * 100);

      const totalAmount = holdingAmount + commissionAmount;

      // Créer ou récupérer le customer Stripe
      let customerId = tenant_stripe_customer_id;
      if (!customerId) {
        const existing = await stripe.customers.list({ email: tenant_email, limit: 1 });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          const customer = await stripe.customers.create({
            email: tenant_email,
            name: tenant_name || 'Tenant',
            metadata: { tenant_id, listing_id }
          });
          customerId = customer.id;
        }
      }

      // PaymentIntent en mode capture manuelle (funds held)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: 'eur',
        capture_method: 'manual', // Fonds bloqués, pas encore capturés
        customer: customerId,
        payment_method_types: ['card'],
        metadata: {
          type: 'holding_deposit',
          listing_id,
          tenant_id,
          holding_amount: holdingAmount,
          commission_amount: commissionAmount,
          monthly_rent: Math.round(monthly_rent * 100),
          has_agent: String(has_agent || false)
        },
        description: `RestMalta — Holding Deposit + Commission (tenant)`
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id,
          holding_amount: holdingAmount / 100,
          commission_amount: commissionAmount / 100,
          total: totalAmount / 100,
          customer_id: customerId
        })
      };
    }

    // ── ACTION: Landlord accepte → capturer les fonds ──
    if (action === 'landlord_accept') {
      const { booking_id } = params;

      // Récupérer la réservation
      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      // Capturer le PaymentIntent (débiter la carte du tenant)
      const intent = await stripe.paymentIntents.capture(booking.payment_intent_id);

      // Mettre à jour le statut
      await sb.from('bookings').update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        stripe_captured: true
      }).eq('id', booking_id);

      // Mettre à jour le listing → Reserved
      await sb.from('listings').update({ status: 'rented', reserved_by: booking.tenant_id, active: false }).eq('id', booking.listing_id);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, status: 'captured', intent_status: intent.status })
      };
    }

    // ── ACTION: Landlord refuse → rembourser intégralement ──
    if (action === 'landlord_decline') {
      const { booking_id, reason } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      // Annuler le PaymentIntent → remboursement automatique complet
      const intent = await stripe.paymentIntents.cancel(booking.payment_intent_id);

      // Mettre à jour le statut
      await sb.from('bookings').update({
        status: 'declined',
        declined_at: new Date().toISOString(),
        decline_reason: reason || 'No reason provided',
        stripe_refunded: true
      }).eq('id', booking_id);

      // Remettre le listing disponible
      await sb.from('listings').update({ status: 'active', reserved_by: null, active: true }).eq('id', booking.listing_id);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, status: 'refunded', intent_status: intent.status })
      };
    }

    // ── ACTION: Tenant annule avant acceptation → rembourser ──
    if (action === 'tenant_cancel') {
      const { booking_id } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
      if (booking.status !== 'pending') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Booking already processed' }) };
      }

      // Annuler → remboursement complet si landlord n'a pas encore accepté
      await stripe.paymentIntents.cancel(booking.payment_intent_id);

      await sb.from('bookings').update({
        status: 'cancelled_by_tenant',
        cancelled_at: new Date().toISOString()
      }).eq('id', booking_id);

      await sb.from('listings').update({ status: 'active', reserved_by: null, active: true }).eq('id', booking.listing_id);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Booking cancelled and refunded' })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (e) {
    console.error('holding-deposit error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
  }
};
