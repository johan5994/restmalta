const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://clfqftbvohwybkrtvylo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const payload = JSON.parse(event.body);
    console.log('DocuSeal webhook:', JSON.stringify(payload));

    const eventType = payload.event_type || payload.event;

    if (eventType === 'submission.completed' || eventType === 'form.completed') {
      const submission = payload.data || payload.submission || payload;
      const submissionId = submission.id || payload.id;
      const auditLogUrl = submission.audit_log_url || payload.audit_log_url;
      const pdfUrl = submission.documents?.[0]?.url || submission.pdf_url || auditLogUrl;

      if (!submissionId) {
        console.log('No submission ID found in payload');
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

      const { data: lease } = await sb
        .from('leases')
        .select('*')
        .eq('docuseal_id', String(submissionId))
        .single()
        .catch(() => ({ data: null }));

      if (lease && pdfUrl) {
        const pdfResponse = await fetch(pdfUrl);
        if (pdfResponse.ok) {
          const pdfBuffer = await pdfResponse.arrayBuffer();
          const fileName = `leases/${lease.id}/signed_lease.pdf`;

          const { error: uploadError } = await sb.storage
            .from('listings')
            .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });

          if (!uploadError) {
            const { data: urlData } = sb.storage.from('listings').getPublicUrl(fileName);
            const signedPdfUrl = urlData?.publicUrl;

            // ── Statut : signé mais PDF bloqué jusqu'au double paiement ──
            await sb.from('leases').update({
              pdf_url_locked: signedPdfUrl,   // URL stockée mais non communiquée
              pdf_url: null,                   // Restera null jusqu'au double paiement
              status: 'signed_awaiting_payment',
              signed_at: new Date().toISOString(),
              signed_landlord: true,
              signed_tenant: true
            }).eq('id', lease.id);

            // ── Récupérer les profils et le listing ──
            const { data: landlordProfile } = await sb
              .from('profiles').select('*').eq('clerk_id', lease.landlord_id).single()
              .catch(() => ({ data: null }));

            const { data: tenantProfile } = await sb
              .from('profiles').select('*').eq('clerk_id', lease.tenant_id).single()
              .catch(() => ({ data: null }));

            const { data: listing } = await sb
              .from('listings').select('*').eq('id', lease.listing_id).single()
              .catch(() => ({ data: null }));

            if (landlordProfile && tenantProfile && listing) {
              const SITE = process.env.URL || 'https://restmalta.com';

              // ── Créer les liens de paiement Stripe ──
              const commissionRes = await fetch(`${SITE}/.netlify/functions/create-commission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lease_id: lease.id,
                  monthly_rent: lease.rent || listing.price || 0,
                  landlord_email: landlordProfile.email || '',
                  landlord_name: landlordProfile.full_name || '',
                  landlord_stripe_customer_id: landlordProfile.stripe_customer_id || null,
                  tenant_email: tenantProfile.email || '',
                  tenant_name: tenantProfile.full_name || '',
                  tenant_stripe_customer_id: tenantProfile.stripe_customer_id || null,
                  property_address: listing.full_address || listing.zone || '',
                  has_agent: listing.wants_agent && listing.agent_service === 'full',
                  exclusive_mandate: listing.exclusive_mandate || false,
                  has_escrow: listing.escrow_enabled || false,
                  agent_email: '',
                  agent_name: ''
                })
              });

              const commissionData = await commissionRes.json();

              if (commissionData.success) {
                const landlordDirect = commissionData.landlord.method === 'direct_charge';
                const tenantDirect   = commissionData.tenant.method === 'direct_charge';

                // ── Sauvegarder la commission en base ──
                await sb.from('commissions').insert({
                  lease_id: lease.id,
                  landlord_amount: commissionData.landlord.amount,
                  tenant_amount: commissionData.tenant.amount,
                  agent_amount: commissionData.agent_amount,
                  landlord_payment_url: commissionData.landlord.payment_url || null,
                  tenant_payment_url: commissionData.tenant.payment_url || null,
                  landlord_session_id: commissionData.landlord.session_id || null,
                  tenant_session_id: commissionData.tenant.session_id || null,
                  landlord_paid: landlordDirect,
                  tenant_paid: tenantDirect,
                  status: (landlordDirect && tenantDirect) ? 'paid' : 'pending'
                }).catch(() => {});

                const listingTitle = listing.title || 'your property';

                // ── Si les deux ont été prélevés directement → débloquer le PDF immédiatement ──
                if (landlordDirect && tenantDirect) {
                  await sb.from('leases').update({
                    pdf_url: lease.pdf_url_locked,
                    status: 'signed',
                    commissions_paid_at: new Date().toISOString()
                  }).eq('id', lease.id);

                  await sb.from('messages').insert({
                    listing_id: lease.listing_id,
                    sender_id: 'system',
                    receiver_id: lease.landlord_id,
                    content: `🎉 Your lease is signed and commissions have been collected!\n\n📄 Your signed lease: ${lease.pdf_url_locked}\n\n✅ RestMalta commission of €${commissionData.landlord.amount} has been automatically charged to your card.`
                  }).catch(() => {});

                  await sb.from('messages').insert({
                    listing_id: lease.listing_id,
                    sender_id: 'system',
                    receiver_id: lease.tenant_id,
                    content: `🎉 Your lease is signed and commissions have been collected!\n\n📄 Your signed lease: ${lease.pdf_url_locked}\n\n✅ RestMalta commission of €${commissionData.tenant.amount} has been automatically charged to your card.\n\n🏠 Welcome to your new home!`
                  }).catch(() => {});

                } else {
                  // ── Message landlord ──
                  const landlordMsg = landlordDirect
                    ? `✅ Your lease has been signed!\n\n💳 RestMalta commission of €${commissionData.landlord.amount} has been automatically charged to your card.\n\n🔒 Your signed lease PDF will be sent once the tenant completes their payment.`
                    : `✅ Your lease has been signed by all parties!\n\n💳 Please pay your RestMalta commission of €${commissionData.landlord.amount} to unlock your signed lease PDF:\n${commissionData.landlord.payment_url}\n\n🔒 PDF sent automatically once both parties have paid.`;

                  await sb.from('messages').insert({
                    listing_id: lease.listing_id,
                    sender_id: 'system',
                    receiver_id: lease.landlord_id,
                    content: landlordMsg
                  }).catch(() => {});

                  // ── Message tenant avec fiche de paiement ──
                  const revTag = landlordProfile.revolut_tag || landlordProfile.bank_details || '';
                  const deposit = listing.deposit || 0;
                  const firstMonth = listing.price || 0;
                  const totalDue = deposit + firstMonth;
                  const revLink = revTag && revTag.startsWith('@')
                    ? `\n\n💜 Pay via Revolut:\nhttps://revolut.me/${revTag.replace('@','')}?amount=${totalDue}`
                    : revTag ? `\n\n💜 Revolut: ${revTag}` : '';

                  const commissionMsg = tenantDirect
                    ? `✅ Your lease has been signed!\n\n💳 RestMalta commission of €${commissionData.tenant.amount} has been automatically charged to your card.`
                    : `✅ Your lease has been signed!\n\n💳 Please pay your RestMalta commission of €${commissionData.tenant.amount}:\n${commissionData.tenant.payment_url}`;

                  const tenantMsg = `${commissionMsg}\n\n━━━━━━━━━━━━━━━━━━━━━━\n💶 PAYMENT DUE TO LANDLORD BEFORE MOVE-IN\n━━━━━━━━━━━━━━━━━━━━━━\n🔐 Security deposit: €${deposit}\n🏠 First month rent: €${firstMonth}\n💰 Total: €${totalDue}\n\n🏦 Bank transfer (IBAN):\n${landlordProfile.iban || '—'}\nName: ${landlordProfile.full_name || '—'}${revLink}\n\nOnce you have paid, click "I've paid" below to notify the landlord.`;

                  await sb.from('messages').insert({
                    listing_id: lease.listing_id,
                    sender_id: 'system',
                    receiver_id: lease.tenant_id,
                    content: tenantMsg,
                    type: 'payment_due'
                  }).catch(() => {});
                }

                // ── Email landlord avec lien de paiement ──
                await fetch(`${SITE}/.netlify/functions/send-email`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    template: 'commission_due',
                    to: landlordProfile.email,
                    data: {
                      name: landlordProfile.full_name || 'Landlord',
                      role: 'landlord',
                      amount: commissionData.landlord.amount,
                      paymentUrl: commissionData.landlord.payment_url,
                      listingTitle
                    }
                  })
                }).catch(() => {});

                // ── Email tenant avec lien de paiement ──
                await fetch(`${SITE}/.netlify/functions/send-email`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    template: 'commission_due',
                    to: tenantProfile.email,
                    data: {
                      name: tenantProfile.full_name || 'Tenant',
                      role: 'tenant',
                      amount: commissionData.tenant.amount,
                      paymentUrl: commissionData.tenant.payment_url,
                      listingTitle
                    }
                  })
                }).catch(() => {});

                console.log(`Lease ${lease.id} signed — payment links sent, PDF locked`);
              }
            }
          }
        }
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('Webhook error:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, error: e.message }) };
  }
};
