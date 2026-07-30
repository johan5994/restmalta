const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Commission RestMalta côté LOCATAIRE : 10% TTC d'un mois de loyer, que ce soit
// avec ou sans agent. (Le 40%/35% côté PROPRIÉTAIRE avec agent est géré séparément
// dans create-commission.js — inchangé.)
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

    // ── ACTION: Créer la pré-autorisation du Holding Deposit (bonne foi, PAS la commission) ──
    // Le tenant confirme cette intention avec sa carte (gère 3DS/SCA). Une fois confirmée,
    // le front récupère le payment_method et appelle 'create_commission_intent' juste après
    // pour créer une DEUXIÈME intention séparée (la commission), en réutilisant la même carte
    // sans redemander de saisie. Les deux intentions vivent indépendamment :
    //  - la commission est capturée (encaissée) dès que le propriétaire accepte
    //  - le holding reste juste autorisé, et n'est capturé QUE si le propriétaire déclare
    //    le locataire disparu après signature du bail des deux côtés. Sinon il est relâché
    //    (jamais prélevé) une fois le vrai dépôt payé directement au propriétaire.
    if (action === 'create_holding') {
      const { listing_id, tenant_id, tenant_email, tenant_name, tenant_stripe_customer_id, monthly_rent, has_agent } = params;

      const holdingAmount = Math.round((monthly_rent / 2) * 100); // 50% loyer, en centimes
      const commissionAmount = Math.round(monthly_rent * TENANT_FEE_RATE * 100); // 10%, calculé ici pour cohérence, capturé plus tard via create_commission_intent

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

      const paymentIntent = await stripe.paymentIntents.create({
        amount: holdingAmount,
        currency: 'eur',
        capture_method: 'manual', // Fonds bloqués, capturés uniquement si "tenant disparu"
        customer: customerId,
        payment_method_types: ['card'],
        metadata: {
          type: 'holding_deposit',
          listing_id,
          tenant_id,
          holding_amount: holdingAmount,
          monthly_rent: Math.round(monthly_rent * 100),
          has_agent: String(has_agent || false)
        },
        description: `Holding Deposit (bonne foi)`
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
          total: (holdingAmount + commissionAmount) / 100,
          customer_id: customerId
        })
      };
    }

    // ── ACTION: Créer la 2e pré-autorisation (commission) juste après confirmation du holding ──
    // Appelée immédiatement après que le front a confirmé create_holding avec succès.
    // Réutilise le payment_method déjà validé — off_session, aucune ressaisie carte.
    if (action === 'create_commission_intent') {
      const { customer_id, payment_method_id, monthly_rent, has_agent, listing_id, tenant_id } = params;
      if (!customer_id || !payment_method_id || !monthly_rent) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing customer_id/payment_method_id/monthly_rent' }) };
      }

      const commissionAmount = Math.round(monthly_rent * TENANT_FEE_RATE * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: commissionAmount,
        currency: 'eur',
        capture_method: 'manual', // Autorisé maintenant, capturé (encaissé) seulement si le propriétaire accepte
        customer: customer_id,
        payment_method: payment_method_id,
        confirm: true,
        off_session: true,
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
          commission_payment_intent_id: paymentIntent.id,
          commission_amount: commissionAmount / 100
        })
      };
    }

    // ── ACTION: Landlord accepte → capture la commission (10%), le holding reste en attente ──
    if (action === 'landlord_accept') {
      const { booking_id } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      let captureResult = 'skipped';

      if (booking.commission_payment_intent_id) {
        // Nouveau flow : intentions séparées — capture propre de la commission uniquement
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.commission_payment_intent_id);
          if (intent.status === 'requires_capture') {
            await stripe.paymentIntents.capture(booking.commission_payment_intent_id);
            captureResult = 'commission_captured';
          } else {
            captureResult = `commission_already_${intent.status}`;
          }
        } catch(e) {
          console.warn('Commission capture error (non-blocking):', e.message);
          captureResult = 'error: ' + e.message;
        }
        // Le holding (booking.payment_intent_id) n'est PAS touché ici — il reste autorisé,
        // et sera soit relâché (release_holding) soit capturé (tenant_ghosted) plus tard.
      } else if (booking.payment_intent_id) {
        // Ancien flow (réservations créées avant la séparation en 2 intentions) — comportement de secours
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
          const commissionCents = parseInt(intent.metadata?.commission_amount || '0', 10);
          if (intent.status === 'requires_capture' && commissionCents > 0) {
            await stripe.paymentIntents.capture(booking.payment_intent_id, { amount_to_capture: commissionCents });
            captureResult = 'legacy_commission_captured_holding_released';
          } else {
            captureResult = 'legacy_skipped';
          }
        } catch(e) {
          captureResult = 'error: ' + e.message;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, capture: captureResult })
      };
    }

    // ── ACTION: Propriétaire déclare le locataire disparu → capture le holding deposit ──
    // Autorisé UNIQUEMENT si le bail est signé des deux côtés (vérifié ici, pas juste côté front).
    if (action === 'tenant_ghosted') {
      const { booking_id } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
      if (!booking.lease_signed_landlord || !booking.lease_signed_tenant) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Lease must be signed by both parties first' }) };
      }
      if (!booking.payment_intent_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No holding deposit on file for this booking' }) };
      }

      let result = 'skipped';
      let amountCaptured = 0;
      try {
        const intent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
        if (intent.status === 'requires_capture') {
          const captured = await stripe.paymentIntents.capture(booking.payment_intent_id);
          amountCaptured = captured.amount_received / 100;
          result = 'holding_captured';
        } else {
          result = `holding_${intent.status}_not_capturable`;
        }
      } catch(e) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: e.message }) };
      }

      if (result === 'holding_captured') {
        await sb.from('bookings').update({
          status: 'tenant_ghosted',
          holding_captured_at: new Date().toISOString()
        }).eq('id', booking_id);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, result, amount_captured: amountCaptured })
      };
    }

    // ── ACTION: Relâcher le holding — appelée quand le vrai dépôt a été payé directement au propriétaire ──
    if (action === 'release_holding') {
      const { booking_id } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking || !booking.payment_intent_id) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, result: 'nothing_to_release' }) };
      }

      let result = 'skipped';
      try {
        const intent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
        if (intent.status === 'requires_capture') {
          await stripe.paymentIntents.cancel(booking.payment_intent_id);
          result = 'holding_released';
        } else {
          result = `holding_${intent.status}_no_action`;
        }
      } catch(e) {
        result = 'error: ' + e.message;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, result }) };
    }

    // ── ACTION: Landlord refuse → rembourser intégralement (commission + holding) ──
    if (action === 'landlord_decline') {
      const { booking_id, reason } = params;

      let booking = null;
      try {
        const { data } = await sb.from('bookings').select('*').eq('id', booking_id).single();
        booking = data;
      } catch(e) {}

      if (!booking) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };

      for (const intentId of [booking.payment_intent_id, booking.commission_payment_intent_id]) {
        if (!intentId) continue;
        try {
          const intent = await stripe.paymentIntents.retrieve(intentId);
          if (intent.status === 'requires_capture') await stripe.paymentIntents.cancel(intentId);
          else if (intent.status === 'succeeded') await stripe.refunds.create({ payment_intent: intentId });
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

    // ── ACTION: Tenant annule avant acceptation → rembourser (commission + holding) ──
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

      for (const intentId of [booking.payment_intent_id, booking.commission_payment_intent_id]) {
        if (!intentId) continue;
        try {
          const intent = await stripe.paymentIntents.retrieve(intentId);
          if (intent.status === 'requires_capture') await stripe.paymentIntents.cancel(intentId);
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
