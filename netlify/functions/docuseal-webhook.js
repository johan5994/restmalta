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

    // ── Gestion signatures bookings (nouveau flow) ──────────────────────────
    if (eventType === 'form.completed' || eventType === 'submission.completed') {
      const submission = payload.data || payload;
      const submissionId = String(submission.id || submission.submission_id || '');
      if (submissionId) {
        const sb2 = createClient(SUPABASE_URL, SUPABASE_KEY);
        const { data: booking } = await sb2.from('bookings').select('*').eq('lease_submission_id', submissionId).maybeSingle().catch(() => ({ data: null }));
        if (booking) {
          let updateData = {};
          const submitter = (submission.submitters || []).find(s => s.status === 'completed');
          const role = submitter?.role || '';

          if (eventType === 'submission.completed') {
            updateData = { lease_signed_landlord: true, lease_signed_tenant: true };
          } else if (role === 'Lessor') {
            updateData = { lease_signed_landlord: true };
          } else if (role === 'Lessee') {
            updateData = { lease_signed_tenant: true };
          } else if (role.startsWith('Lessee ')) {
            // Co-tenant N a signé — on marque SON entrée précisément dans co_lessees_embed_src,
            // sans jamais considérer le bail "signé" tant que chacun n'a pas fait sa part.
            let coLessees = [];
            try { coLessees = booking.co_lessees_embed_src ? JSON.parse(booking.co_lessees_embed_src) : []; } catch(e) {}
            const idx = coLessees.findIndex(cl => cl.role === role);
            if (idx !== -1) {
              coLessees[idx].signed = true;
              updateData = { co_lessees_embed_src: JSON.stringify(coLessees) };
              if (coLessees[idx].tenant_id) {
                await sb2.from('messages').insert({ listing_id: booking.listing_id, sender_id: 'system', receiver_id: booking.landlord_id, content: `✍️ Co-tenant ${coLessees[idx].name || ''} signed the lease!`, type: 'lease_signed_cotenant' }).catch(() => {});
              }
            }
          }

          if (Object.keys(updateData).length) {
            const { data: updResult, error: updErr } = await sb2.from('bookings').update(updateData).eq('id', booking.id).select();
            if (updErr) {
              console.error('❌ Webhook could not update booking', booking.id, ':', updErr.message);
            } else if (!updResult || !updResult.length) {
              console.error('❌ Webhook update affected 0 rows for booking', booking.id, '— check RLS on the bookings table.');
            }
            // Notifier selon qui a signé
            if (updateData.lease_signed_landlord && !booking.lease_signed_landlord) {
              await sb2.from('messages').insert({ listing_id: booking.listing_id, sender_id: 'system', receiver_id: booking.tenant_id, content: '✍️ The landlord signed the lease!\n\nIt\'s your turn — go to your visits page to sign.', type: 'lease_signed_landlord' }).catch(() => {});
            }
            if (updateData.lease_signed_tenant && !booking.lease_signed_tenant) {
              await sb2.from('messages').insert({ listing_id: booking.listing_id, sender_id: 'system', receiver_id: booking.landlord_id, content: '✍️ The tenant signed the lease!\n\nWaiting on any remaining co-tenants and first payment.', type: 'lease_signed_tenant' }).catch(() => {});
            }

            // Le bail n'est "entièrement signé" que si landlord + tenant principal
            // + TOUS les co-tenants ayant un lien de signature ont signé.
            const landlordDone = updateData.lease_signed_landlord || booking.lease_signed_landlord;
            const tenantDone = updateData.lease_signed_tenant || booking.lease_signed_tenant;
            let coLesseesForCheck = [];
            try {
              coLesseesForCheck = updateData.co_lessees_embed_src
                ? JSON.parse(updateData.co_lessees_embed_src)
                : (booking.co_lessees_embed_src ? JSON.parse(booking.co_lessees_embed_src) : []);
            } catch(e) {}
            const allCoTenantsDone = coLesseesForCheck.every(cl => cl.signed);

            if (landlordDone && tenantDone && allCoTenantsDone) {
              const ibanInfo = booking.landlord_iban ? '\n🏦 IBAN: ' + booking.landlord_iban : '';
              const revInfo = booking.landlord_revolut ? '\n💜 Revolut: ' + booking.landlord_revolut : '';
              await sb2.from('messages').insert({ listing_id: booking.listing_id, sender_id: 'system', receiver_id: booking.tenant_id, content: '🎉 Everyone has signed!\n\nPlease transfer deposit + first month to landlord.' + ibanInfo + revInfo + '\n\nClick "I have paid" in your visits page once done.', type: 'lease_fully_signed' }).catch(() => {});
            }
          }
        }
      }
    }

    // ── Gestion signatures EDL (état des lieux) ─────────────────────────────
    if (eventType === 'form.completed' || eventType === 'submission.completed') {
      const submission = payload.data || payload;
      const submissionId = String(submission.id || submission.submission_id || '');
      if (submissionId) {
        const sb3 = createClient(SUPABASE_URL, SUPABASE_KEY);
        const { data: edlBooking } = await sb3.from('bookings').select('*').eq('edl_submission_id', submissionId).maybeSingle().catch(() => ({ data: null }));
        if (edlBooking) {
          let edlUpdate = {};
          const submitter = (submission.submitters || []).find(s => s.status === 'completed');
          const role = submitter?.role || '';
          if (eventType === 'submission.completed') {
            edlUpdate = { edl_signed_landlord: true, edl_signed_tenant: true };
          } else if (role === 'Lessor') {
            edlUpdate = { edl_signed_landlord: true };
          } else if (role === 'Lessee') {
            edlUpdate = { edl_signed_tenant: true };
          }
          if (Object.keys(edlUpdate).length) {
            // Capturer le vrai PDF signé — rouvrir le lien de signature après
            // coup ne montre pas l'état signé, il faut le vrai document fini
            const pdfUrl = submission.documents?.[0]?.url || submission.audit_log_url || null;
            if (pdfUrl) edlUpdate.edl_pdf_url = pdfUrl;

            await sb3.from('bookings').update(edlUpdate).eq('id', edlBooking.id);
            if (edlUpdate.edl_signed_landlord && !edlBooking.edl_signed_landlord) {
              await sb3.from('messages').insert({ listing_id: edlBooking.listing_id, sender_id: 'system', receiver_id: edlBooking.tenant_id, content: '✍️ The landlord signed the move-in inventory (EDL)! Your turn — go to your visits page to sign.', type: 'edl_signed_landlord' }).catch(() => {});
            }
            if (edlUpdate.edl_signed_tenant && !edlBooking.edl_signed_tenant) {
              await sb3.from('messages').insert({ listing_id: edlBooking.listing_id, sender_id: 'system', receiver_id: edlBooking.landlord_id, content: '✍️ The tenant signed the move-in inventory (EDL)!', type: 'edl_signed_tenant' }).catch(() => {});
            }
          }
        }
      }
    }

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
                  agent_must_create: listing.agent_must_create || false,
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
