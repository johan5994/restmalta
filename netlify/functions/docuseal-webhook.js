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

    // DocuSeal sends event_type when submission is completed
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

      // Initialize Supabase
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

      // Find the lease with this docuseal_id
      const { data: lease } = await sb
        .from('leases')
        .select('*')
        .eq('docuseal_id', String(submissionId))
        .single()
        .catch(() => ({ data: null }));

      if (lease && pdfUrl) {
        // Download the signed PDF from DocuSeal
        const pdfResponse = await fetch(pdfUrl);
        if (pdfResponse.ok) {
          const pdfBuffer = await pdfResponse.arrayBuffer();
          const fileName = `leases/${lease.id}/signed_lease.pdf`;

          // Upload to Supabase Storage
          const { data: uploadData, error: uploadError } = await sb.storage
            .from('listings')
            .upload(fileName, pdfBuffer, {
              contentType: 'application/pdf',
              upsert: true
            });

          if (!uploadError) {
            const { data: urlData } = sb.storage
              .from('listings')
              .getPublicUrl(fileName);

            const signedPdfUrl = urlData?.publicUrl;

            // Update lease record
            await sb.from('leases').update({
              pdf_url: signedPdfUrl,
              status: 'signed',
              signed_at: new Date().toISOString(),
              signed_landlord: true,
              signed_tenant: true
            }).eq('id', lease.id);

            // ── Trigger commission payments ──────────────────
            // Get full lease details with profiles
            const { data: fullLease } = await sb
              .from('leases')
              .select('*, listings(*, profiles!listings_landlord_id_fkey(*))')
              .eq('id', lease.id)
              .single()
              .catch(() => ({ data: null }));

            if (fullLease) {
              const { data: landlordProfile } = await sb
                .from('profiles')
                .select('*')
                .eq('clerk_id', fullLease.landlord_id)
                .single()
                .catch(() => ({ data: null }));

              const { data: tenantProfile } = await sb
                .from('profiles')
                .select('*')
                .eq('clerk_id', fullLease.tenant_id)
                .single()
                .catch(() => ({ data: null }));

              const { data: listing } = await sb
                .from('listings')
                .select('*')
                .eq('id', fullLease.listing_id)
                .single()
                .catch(() => ({ data: null }));

              if (landlordProfile && tenantProfile && listing) {
                // Create commission payment links
                const commissionRes = await fetch(`${process.env.URL}/.netlify/functions/create-commission`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    lease_id: lease.id,
                    monthly_rent: fullLease.rent || listing.price || 0,
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
                  // Save commission links to Supabase
                  await sb.from('commissions').insert({
                    lease_id: lease.id,
                    landlord_amount: commissionData.landlord.amount,
                    tenant_amount: commissionData.tenant.amount,
                    agent_amount: commissionData.agent_amount,
                    landlord_payment_url: commissionData.landlord.payment_url,
                    tenant_payment_url: commissionData.tenant.payment_url,
                    status: 'pending'
                  }).catch(() => {});

                  // Send payment link to landlord via message
                  await sb.from('messages').insert({
                    listing_id: fullLease.listing_id,
                    sender_id: 'system',
                    receiver_id: fullLease.landlord_id,
                    content: `✅ Your lease has been signed by all parties!\n\n📄 Download your signed lease: ${signedPdfUrl}\n\n💳 Please pay your RestMalta commission of €${commissionData.landlord.amount}:\n${commissionData.landlord.payment_url}\n\nYou can pay by card or SEPA bank transfer.`
                  }).catch(() => {});

                  // Send payment link to tenant via message
                  await sb.from('messages').insert({
                    listing_id: fullLease.listing_id,
                    sender_id: 'system',
                    receiver_id: fullLease.tenant_id,
                    content: `✅ Your lease has been signed!\n\n📄 Download your signed lease: ${signedPdfUrl}\n\n💳 Please pay your RestMalta commission of €${commissionData.tenant.amount}:\n${commissionData.tenant.payment_url}\n\nYou can pay by card or SEPA bank transfer (recommended — lowest fees).`
                  }).catch(() => {});
                }
              }
            }

            // Notify both parties
            if (lease.landlord_id && lease.listing_id) {
              await sb.from('messages').insert({
                listing_id: lease.listing_id,
                sender_id: 'system',
                receiver_id: lease.landlord_id,
                content: `✅ Lease fully signed! Your signed copy: ${signedPdfUrl}`
              }).catch(() => {});
            }

            if (lease.tenant_id && lease.listing_id) {
              await sb.from('messages').insert({
                listing_id: lease.listing_id,
                sender_id: 'system',
                receiver_id: lease.tenant_id,
                content: `✅ Your lease has been fully signed! Your copy: ${signedPdfUrl}`
              }).catch(() => {});
            }

            console.log(`Lease ${lease.id} signed — commission links sent`);
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    console.error('Webhook error:', e);
    return {
      statusCode: 200, // Always return 200 to DocuSeal
      headers,
      body: JSON.stringify({ ok: true, error: e.message })
    };
  }
};
