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
            // Get public URL
            const { data: urlData } = sb.storage
              .from('listings')
              .getPublicUrl(fileName);

            const signedPdfUrl = urlData?.publicUrl;

            // Update lease record with signed PDF URL and status
            await sb.from('leases').update({
              pdf_url: signedPdfUrl,
              status: 'signed',
              signed_at: new Date().toISOString(),
              signed_landlord: true,
              signed_tenant: true
            }).eq('id', lease.id);

            // Notify landlord and tenant via messages
            if (lease.landlord_id && lease.listing_id) {
              await sb.from('messages').insert({
                listing_id: lease.listing_id,
                sender_id: 'system',
                receiver_id: lease.landlord_id,
                content: `✅ Lease fully signed! Download your signed lease here: ${signedPdfUrl}`
              }).catch(() => {});
            }

            if (lease.tenant_id && lease.listing_id) {
              await sb.from('messages').insert({
                listing_id: lease.listing_id,
                sender_id: 'system',
                receiver_id: lease.tenant_id,
                content: `✅ Your lease has been fully signed! Download your copy here: ${signedPdfUrl}`
              }).catch(() => {});
            }

            console.log(`Lease ${lease.id} signed PDF stored at ${signedPdfUrl}`);
          } else {
            console.error('Upload error:', uploadError);
            // Still update status even if upload failed
            await sb.from('leases').update({
              pdf_url: pdfUrl,
              status: 'signed',
              signed_at: new Date().toISOString(),
              signed_landlord: true,
              signed_tenant: true
            }).eq('id', lease.id);
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
