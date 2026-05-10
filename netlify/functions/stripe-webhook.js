const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  let stripeEvent;
  try {
    // Vérification signature Stripe
    const sig = event.headers['stripe-signature'];
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return { statusCode: 400, headers, body: `Webhook Error: ${err.message}` };
  }

  console.log('Stripe webhook event:', stripeEvent.type);

  // ── On écoute uniquement les paiements de commission complétés ──
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const leaseId = session.metadata?.lease_id;
    const role = session.metadata?.role; // 'landlord' ou 'tenant'
    const sessionId = session.id;

    if (!leaseId || !role) {
      console.log('No lease_id or role in session metadata — skipping');
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    console.log(`Commission paid — lease: ${leaseId}, role: ${role}, session: ${sessionId}`);

    // ── Trouver la commission correspondante ──
    const { data: commission } = await sb
      .from('commissions')
      .select('*')
      .eq('lease_id', leaseId)
      .single()
      .catch(() => ({ data: null }));

    if (!commission) {
      console.log(`No commission found for lease ${leaseId}`);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // ── Marquer le paiement du bon côté ──
    const updates = {};
    if (role === 'landlord') {
      updates.landlord_paid = true;
      updates.landlord_paid_at = new Date().toISOString();
      updates.landlord_session_id = sessionId;
    } else if (role === 'tenant') {
      updates.tenant_paid = true;
      updates.tenant_paid_at = new Date().toISOString();
      updates.tenant_session_id = sessionId;
    }

    await sb.from('commissions').update(updates).eq('id', commission.id);

    // ── Relire la commission pour avoir l'état à jour ──
    const { data: updatedCommission } = await sb
      .from('commissions')
      .select('*')
      .eq('id', commission.id)
      .single()
      .catch(() => ({ data: null }));

    const landlordPaid = role === 'landlord' ? true : updatedCommission?.landlord_paid;
    const tenantPaid = role === 'tenant' ? true : updatedCommission?.tenant_paid;

    console.log(`Paiement status — landlord: ${landlordPaid}, tenant: ${tenantPaid}`);

    if (landlordPaid && tenantPaid) {
      // ── LES DEUX ONT PAYÉ commissions — vérifier si paiement dépôt/loyer confirmé aussi ──
      const { data: depoPay } = await sb
        .from('payments')
        .select('status')
        .eq('lease_id', leaseId)
        .eq('type', 'deposit_and_first_month')
        .eq('status', 'paid')
        .limit(1)
        .single()
        .catch(() => ({ data: null }));

      if (depoPay) {
        // Tout est payé — débloquer le PDF
        await unlockLeasePdf(sb, leaseId);
      } else {
        // Commissions OK mais dépôt/loyer pas encore confirmé
        // Marquer commissions comme payées mais garder PDF bloqué
        await sb.from('commissions').update({ status: 'paid' }).eq('lease_id', leaseId);
        await sb.from('leases').update({ commissions_paid_at: new Date().toISOString() }).eq('id', leaseId);
        console.log(`Lease ${leaseId} — commissions paid, waiting for deposit/rent confirmation`);
      }
    } else {
      // ── Un seul a payé — envoyer une relance à l'autre ──
      await sendReminder(sb, leaseId, role, commission);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};

// ─────────────────────────────────────────────────────────────────
// Débloque le PDF et l'envoie aux deux parties
// ─────────────────────────────────────────────────────────────────
async function unlockLeasePdf(sb, leaseId) {
  const { data: lease } = await sb
    .from('leases').select('*').eq('id', leaseId).single()
    .catch(() => ({ data: null }));

  if (!lease || !lease.pdf_url_locked) {
    console.log(`No locked PDF for lease ${leaseId}`);
    return;
  }

  const signedPdfUrl = lease.pdf_url_locked;

  // ── Mettre à jour le bail : PDF débloqué, status final ──
  await sb.from('leases').update({
    pdf_url: signedPdfUrl,
    status: 'signed',
    commissions_paid_at: new Date().toISOString()
  }).eq('id', leaseId);

  // ── Mettre à jour la commission ──
  await sb.from('commissions').update({ status: 'paid' }).eq('lease_id', leaseId);

  const SITE = process.env.URL || 'https://restmalta.com';

  // ── Récupérer les profils ──
  const { data: landlordProfile } = await sb
    .from('profiles').select('*').eq('clerk_id', lease.landlord_id).single()
    .catch(() => ({ data: null }));

  const { data: tenantProfile } = await sb
    .from('profiles').select('*').eq('clerk_id', lease.tenant_id).single()
    .catch(() => ({ data: null }));

  const listingTitle = lease.listing_title || 'your property';

  // ── Email landlord avec le PDF ──
  if (landlordProfile?.email) {
    await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: 'lease_unlocked',
        to: landlordProfile.email,
        data: {
          name: landlordProfile.full_name || 'Landlord',
          role: 'landlord',
          pdfUrl: signedPdfUrl,
          listingTitle,
          dashboardUrl: `${SITE}/landlord-dashboard.html`
        }
      })
    }).catch(() => {});
  }

  // ── Email tenant avec le PDF ──
  if (tenantProfile?.email) {
    await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: 'lease_unlocked',
        to: tenantProfile.email,
        data: {
          name: tenantProfile.full_name || 'Tenant',
          role: 'tenant',
          pdfUrl: signedPdfUrl,
          listingTitle,
          dashboardUrl: `${SITE}/tenant-dashboard.html`
        }
      })
    }).catch(() => {});
  }

  // ── Messages in-app aux deux ──
  if (lease.listing_id) {
    await sb.from('messages').insert({
      listing_id: lease.listing_id,
      sender_id: 'system',
      receiver_id: lease.landlord_id,
      content: `🎉 Both commissions received!\n\n📄 Your signed lease is now available:\n${signedPdfUrl}\n\nThank you for using RestMalta!`
    }).catch(() => {});

    await sb.from('messages').insert({
      listing_id: lease.listing_id,
      sender_id: 'system',
      receiver_id: lease.tenant_id,
      content: `🎉 Both commissions received!\n\n📄 Your signed lease is now available:\n${signedPdfUrl}\n\nWelcome to your new home! 🏠`
    }).catch(() => {});
  }

  console.log(`Lease ${leaseId} — PDF unlocked and sent to both parties`);
}

// ─────────────────────────────────────────────────────────────────
// Envoie une relance à la partie qui n'a pas encore payé
// ─────────────────────────────────────────────────────────────────
async function sendReminder(sb, leaseId, paidRole, commission) {
  const { data: lease } = await sb
    .from('leases').select('*').eq('id', leaseId).single()
    .catch(() => ({ data: null }));

  if (!lease) return;

  const unpaidRole = paidRole === 'landlord' ? 'tenant' : 'landlord';
  const unpaidId = unpaidRole === 'landlord' ? lease.landlord_id : lease.tenant_id;
  const unpaidAmount = unpaidRole === 'landlord' ? commission.landlord_amount : commission.tenant_amount;
  const unpaidUrl = unpaidRole === 'landlord' ? commission.landlord_payment_url : commission.tenant_payment_url;

  const { data: unpaidProfile } = await sb
    .from('profiles').select('*').eq('clerk_id', unpaidId).single()
    .catch(() => ({ data: null }));

  const SITE = process.env.URL || 'https://restmalta.com';
  const listingTitle = lease.listing_title || 'your property';
  const dashboardUrl = unpaidRole === 'landlord'
    ? `${SITE}/landlord-dashboard.html`
    : `${SITE}/tenant-dashboard.html`;

  // ── Message in-app ──
  if (lease.listing_id) {
    await sb.from('messages').insert({
      listing_id: lease.listing_id,
      sender_id: 'system',
      receiver_id: unpaidId,
      content: `⏳ The other party has already paid their commission!\n\n🔒 Your signed lease PDF is waiting — it will be unlocked as soon as you complete your payment.\n\n💳 Pay €${unpaidAmount} now:\n${unpaidUrl}`
    }).catch(() => {});
  }

  // ── Email de relance ──
  if (unpaidProfile?.email) {
    await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: 'commission_reminder',
        to: unpaidProfile.email,
        data: {
          name: unpaidProfile.full_name || 'there',
          role: unpaidRole,
          amount: unpaidAmount,
          paymentUrl: unpaidUrl,
          listingTitle,
          dashboardUrl
        }
      })
    }).catch(() => {});
  }

  console.log(`Lease ${leaseId} — reminder sent to ${unpaidRole} (${unpaidProfile?.email})`);
}
