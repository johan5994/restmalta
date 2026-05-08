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
                  tenant_email: tenantProfile.email || '',
                  tenant_name: tenantProfile.full_name || '',
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
                // ── Sauvegarder la commission en base ──
                await sb.from('commissions').insert({
                  lease_id: lease.id,
                  landlord_amount: commissionData.landlord.amount,
                  tenant_amount: commissionData.tenant.amount,
                  agent_amount: commissionData.agent_amount,
                  landlord_payment_url: commissionData.landlord.payment_url,
                  tenant_payment_url: commissionData.tenant.payment_url,
                  landlord_session_id: commissionData.landlord.session_id,
                  tenant_session_id: commissionData.tenant.session_id,
                  landlord_paid: false,
                  tenant_paid: false,
                  status: 'pending'
                }).catch(() => {});

                const listingTitle = listing.title || 'your property';

                // ── Message landlord : lien de paiement, PAS de PDF ──
                await sb.from('messages').insert({
                  listing_id: lease.listing_id,
                  sender_id: 'system',
                  receiver_id: lease.landlord_id,
                  content: `✅ Your lease has been signed by all parties!\n\n💳 Please pay your RestMalta commission of €${commissionData.landlord.amount} to unlock your signed lease PDF:\n${commissionData.landlord.payment_url}\n\n🔒 Your signed lease PDF will be sent to you automatically once both parties have paid.\n\nYou can pay by card or SEPA bank transfer.`
                }).catch(() => {});

                // ── Message tenant : lien de paiement, PAS de PDF ──
                await sb.from('messages').insert({
                  listing_id: lease.listing_id,
                  sender_id: 'system',
                  receiver_id: lease.tenant_id,
                  content: `✅ Your lease has been signed!\n\n💳 Please pay your RestMalta commission of €${commissionData.tenant.amount} to unlock your signed lease PDF:\n${commissionData.tenant.payment_url}\n\n🔒 Your signed lease PDF will be sent to you automatically once both parties have paid.\n\nYou can pay by card or SEPA bank transfer (recommended — lowest fees).`
                }).catch(() => {});

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
