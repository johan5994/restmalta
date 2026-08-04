const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Commission RestMalta côté LOCATAIRE : 10% TTC d'un mois de loyer, que ce soit
// avec ou sans agent. Côté PROPRIÉTAIRE avec agent (action ci-dessous), le montant
// exact (amount_cents) est calculé et transmis par le frontend
// (landlord-dashboard.html) — cette fonction ne fait que créer le PaymentIntent
// Stripe pour le montant donné, elle ne connaît pas le taux elle-même.
//
// NOTE: le système de "Holding Deposit" (pré-autorisation de 50% du loyer,
// capturée uniquement si le locataire disparaît) a été retiré — le locataire
// paie déjà les frais RestMalta dès l'acceptation, ce qui représente un
// engagement réel ; ajouter un blocage de carte supplémentaire avant même la
// réponse du propriétaire créait de la friction pour une protection redondante.
const TENANT_FEE_RATE = 0.10;

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

    // ── ACTION: Commission landlord (avec agent) — inchangé ──
    if (action === 'create_landlord_commission') {
      const { booking_id, amount_cents, landlord_id, landlord_email } = params;

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

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount_cents,
        currency: 'eur',
        customer: customerId,
        payment_method_types: ['card'],
        metadata: { type: 'landlord_commission', booking_id, landlord_id },
        description: 'Platform commission — landlord'
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

    // ── ACTION: Créer la pré-autorisation des frais RestMalta (10%) côté locataire ──
    // Autorisée à la demande, capturée uniquement si le propriétaire accepte.
    // Remplace l'ancien flow à deux intentions (holding + commission) par une
    // seule intention directe.
    if (action === 'create_commission_intent') {
      const { listing_id, tenant_id, tenant_email, tenant_name, tenant_stripe_customer_id, monthly_rent } = params;
      if (!monthly_rent) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing monthly_rent' }) };
      }

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

      const commissionAmount = Math.round(monthly_rent * TENANT_FEE_RATE * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: commissionAmount,
        currency: 'eur',
        capture_method: 'manual', // Autorisé maintenant, capturé (encaissé) seulement si le propriétaire accepte
        customer: customerId,
        payment_method_types: ['card'],
        metadata: {
          type: 'tenant_commission',
          listing_id: listing_id || '',
          tenant_id: tenant_id || '',
          commission_amount: commissionAmount
        },
        description: `RestMalta platform fee — 10%`
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          client_secret: paymentIntent.client_secret,
          commission_payment_intent_id: paymentIntent.id,
          commission_amount: commissionAmount / 100,
          customer_id: customerId
        })
      };
    }

    // ── ACTION: Landlord accepte → capture la commission (10%) ──
    if (action === 'landlord_accept') {
      const { booking_id } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      let captureResult = 'skipped';
      let commissionAmountEur = 0;

      if (booking.commission_payment_intent_id) {
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.commission_payment_intent_id);
          if (intent.status === 'requires_capture') {
            const captured = await stripe.paymentIntents.capture(booking.commission_payment_intent_id);
            captureResult = 'commission_captured';
            commissionAmountEur = (captured.amount_received || captured.amount || 0) / 100;
          } else {
            captureResult = `commission_already_${intent.status}`;
          }
        } catch(e) {
          console.warn('Commission capture error (non-blocking):', e.message);
          captureResult = 'error: ' + e.message;
        }
      }

      // Tracer la commission dans 'payments' pour qu'elle soit visible côté locataire
      if (commissionAmountEur > 0 && booking.tenant_id) {
        try {
          await sb.from('payments').insert({
            tenant_id: booking.tenant_id,
            listing_id: booking.listing_id || null,
            tenant_name: booking.tenant_name || null,
            tenant_email: booking.tenant_email || null,
            amount: commissionAmountEur,
            type: 'commission',
            status: 'paid',
            paid_at: new Date().toISOString(),
            due_date: new Date().toISOString().split('T')[0]
          });
        } catch(e) { console.warn('Commission payment record error (non-blocking):', e.message); }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, capture: captureResult })
      };
    }

    // ── ACTION: Landlord refuse → rembourser la commission ──
    if (action === 'landlord_decline') {
      const { booking_id, reason } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      if (booking.commission_payment_intent_id) {
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.commission_payment_intent_id);
          if (intent.status === 'requires_capture') await stripe.paymentIntents.cancel(booking.commission_payment_intent_id);
          else if (intent.status === 'succeeded') await stripe.refunds.create({ payment_intent: booking.commission_payment_intent_id });
        } catch(e) { console.warn('Decline refund/cancel error (non-blocking):', e.message); }
      }

      await sb.from('bookings').update({
        status: 'declined',
        declined_at: new Date().toISOString(),
        decline_reason: reason || 'No reason provided',
        stripe_refunded: true
      }).eq('id', booking_id);

      await sb.from('listings').update({ status: 'active', reserved_by: null, active: true }).eq('id', booking.listing_id);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, status: 'refunded' })
      };
    }

    // ── ACTION: Tenant annule avant acceptation → rembourser la commission ──
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

      if (booking.commission_payment_intent_id) {
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.commission_payment_intent_id);
          if (intent.status === 'requires_capture') await stripe.paymentIntents.cancel(booking.commission_payment_intent_id);
        } catch(e) { console.warn('Cancel error (non-blocking):', e.message); }
      }

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
