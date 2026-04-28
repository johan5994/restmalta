exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { type, landlord, tenant, coTenants, listing, start_date, end_date } = JSON.parse(event.body);

    const DOCU_KEY = process.env.DOCUSEAL_KEY;

    const typeLabel = {
      long: 'Long Private Residential Lease',
      short: 'Short Private Residential Lease',
      sublet: 'Subletting Agreement',
      both: 'Private Residential Lease'
    }[type] || 'Private Residential Lease';

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const startFormatted = start_date ? new Date(start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const endFormatted = end_date ? new Date(end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    // Build co-lessees HTML
    let coLesseesHtml = '';
    if (coTenants && coTenants.length) {
      coTenants.forEach((ct, i) => {
        coLesseesHtml += `
          <div class="section-title">CO-LESSEE ${i + 2}</div>
          <table class="info-table">
            <tr><td class="label">Full name</td><td class="value">${ct.name || '—'}</td></tr>
            <tr><td class="label">ID/Passport</td><td class="value">${ct.passport || '—'}</td></tr>
            <tr><td class="label">Nationality</td><td class="value">${ct.nationality || '—'}</td></tr>
            <tr><td class="label">Date of birth</td><td class="value">${ct.dob || '—'}</td></tr>
            <tr><td class="label">Email</td><td class="value">${ct.email || '—'}</td></tr>
          </table>`;
      });
    }

    // Build co-lessees signature blocks
    let coSigHtml = '';
    if (coTenants && coTenants.length) {
      coTenants.forEach((ct, i) => {
        coSigHtml += `
          <div class="sig-block">
            <div class="sig-name">CO-LESSEE ${i + 2}: ${ct.name || '—'}</div>
            <div class="sig-line"></div>
            <div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</div>
          </div>`;
      });
    }

    const diFormoText = listing.di_fermo && listing.di_fermo !== 'none'
      ? `The Lessee agrees to remain in the premises for a compulsory Di Fermo period of <strong>${listing.di_fermo}</strong>.`
      : 'No Di Fermo (compulsory period) applies to this lease.';

    const shortLetCategory = type === 'short' ? `
      <div class="section-title">LESSEE CATEGORY (SHORT-LET)</div>
      <p>The reason for which the premises is being leased for a short period is because the lessee is a:</p>
      <p>☐ (a) Non-resident worker employed for less than 6 months<br>
      ☐ (b) Non-resident student enrolled in courses for less than 6 months<br>
      ☐ (c) Resident needing alternative primary residence for less than 6 months<br>
      ☐ (d) Non-resident not seeking to establish long residence in Malta</p>
      <p><em>Supporting documentation attached as Annex A.</em></p>` : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #1a1410; margin: 0; padding: 40px; line-height: 1.6; }
  .header { background: #C9553A; color: white; padding: 16px 24px; margin: -40px -40px 30px -40px; display: flex; justify-content: space-between; align-items: center; }
  .header-title { font-size: 14pt; font-weight: bold; }
  .header-sub { font-size: 9pt; opacity: 0.85; }
  h1 { font-size: 16pt; text-align: center; color: #C9553A; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #6B5F52; font-size: 9pt; margin-bottom: 24px; }
  .section-title { background: #C9553A; color: white; padding: 6px 10px; font-weight: bold; font-size: 10pt; margin: 18px -10px 10px -10px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10.5pt; }
  .info-table .label { font-weight: bold; color: #6B5F52; width: 35%; }
  .info-table .value { color: #1a1410; }
  p { font-size: 10.5pt; margin: 6px 0; text-align: justify; }
  .clause-title { font-weight: bold; margin-top: 8px; }
  .warning { background: #FFF8E6; border: 1px solid #D4A847; padding: 10px 14px; margin: 16px 0; font-size: 9.5pt; }
  .sig-section { margin-top: 30px; }
  .sig-row { display: flex; gap: 20px; margin-bottom: 24px; }
  .sig-block { flex: 1; border-top: 1px solid #6B5F52; padding-top: 10px; }
  .sig-name { font-weight: bold; font-size: 10pt; margin-bottom: 30px; }
  .sig-line { border-bottom: 1px solid #333; margin-bottom: 6px; height: 40px; }
  .sig-label { font-size: 8.5pt; color: #6B5F52; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 8pt; color: #6B5F52; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <div class="header-title">RestMalta</div>
  <div class="header-sub">${typeLabel}</div>
</div>

<h1>${typeLabel.toUpperCase()}</h1>
<p class="subtitle">In accordance with the Private Residential Leases Act, Chapter 604 of the Laws of Malta (SL 604.02)<br>
Generated on ${today} by RestMalta — restmalta.com</p>

<p>This, <strong>${today}</strong></p>
<p>By the present private writing there appear on the one part:</p>

<div class="section-title">LESSOR (LANDLORD)</div>
<table class="info-table">
  <tr><td class="label">Full name</td><td class="value">${landlord.name || '—'}</td></tr>
  <tr><td class="label">ID/Passport No.</td><td class="value">${landlord.passport || '—'}</td></tr>
  <tr><td class="label">Address in Malta</td><td class="value">${landlord.address || '—'}</td></tr>
  <tr><td class="label">Phone</td><td class="value">${landlord.phone || '—'}</td></tr>
  <tr><td class="label">Email</td><td class="value">${landlord.email || '—'}</td></tr>
  <tr><td class="label">IBAN</td><td class="value">${landlord.iban || '—'}</td></tr>
</table>
<p>hereinafter referred to as the <strong>Lessor</strong>.</p>

<div class="section-title">LESSEE (TENANT) — PRIMARY</div>
<table class="info-table">
  <tr><td class="label">Full name</td><td class="value">${tenant.name || '—'}</td></tr>
  <tr><td class="label">ID/Passport No.</td><td class="value">${tenant.passport || '—'}</td></tr>
  <tr><td class="label">Nationality</td><td class="value">${tenant.nationality || '—'}</td></tr>
  <tr><td class="label">Date of birth</td><td class="value">${tenant.dob || '—'}</td></tr>
  <tr><td class="label">Home address</td><td class="value">${tenant.address || '—'}</td></tr>
  <tr><td class="label">Phone</td><td class="value">${tenant.phone || '—'}</td></tr>
  <tr><td class="label">Email</td><td class="value">${tenant.email || '—'}</td></tr>
</table>
<p>hereinafter referred to as the <strong>Lessee</strong>. All lessees are jointly and severally liable.</p>

${coLesseesHtml}

<div class="section-title">PREMISES</div>
<p>The Lessor grants by title of lease to the Lessee who accepts: <strong>${listing.address || '—'}, Malta</strong></p>
${shortLetCategory}

<div class="section-title">PAYMENT &amp; DURATION</div>
<table class="info-table">
  <tr><td class="label">Lease start date</td><td class="value">${startFormatted}</td></tr>
  <tr><td class="label">Lease end date</td><td class="value">${endFormatted}</td></tr>
  <tr><td class="label">Monthly rent</td><td class="value"><strong>€${listing.price || '—'}</strong></td></tr>
  <tr><td class="label">Security deposit</td><td class="value">€${listing.deposit || '0'}</td></tr>
  <tr><td class="label">Rent due day</td><td class="value">${listing.payment_due_day || '1'}st of each month</td></tr>
  <tr><td class="label">Payment method</td><td class="value">Bank transfer to IBAN: ${landlord.iban || '—'}</td></tr>
  <tr><td class="label">Bills</td><td class="value">${listing.bills || 'Excluded'}</td></tr>
  ${listing.notice_period ? `<tr><td class="label">Notice period</td><td class="value">${listing.notice_period}</td></tr>` : ''}
</table>
<p>${diFormoText}</p>
${type === 'short' ? '<p><strong>This agreement shall NOT be renewed.</strong> A new contract must be signed for any continued occupancy.</p>' : ''}
${type === 'long' ? '<p>After the first year, rent may increase in proportion to the Property Price Index (PPI), not exceeding 5% per year.</p>' : ''}

<div class="section-title">DEPOSIT</div>
<p>(i) The Lessee pays unto the Lessor a security deposit of <strong>€${listing.deposit || '0'}</strong> in security of all obligations under this lease.</p>
<p>(ii) The deposit shall be returned within <strong>10 days</strong> of vacating, subject to deductions for damages beyond fair wear and tear, as evidenced by the inventory (Annex A).</p>
<p>(iii) An inventory of the property's contents is annexed as Annex A and forms an integral part of this agreement.</p>

<div class="section-title">USE OF PREMISES</div>
<p>(i) The Lessee shall exclusively utilise the premises as a private residence. No other use is permitted.</p>
<p>(ii) The Lessor will not recognise any other person than the Lessee for complete responsibility of the property.</p>

<div class="section-title">CONDITION &amp; MAINTENANCE</div>
<p>(i) The Lessee acknowledges having examined the premises and declares there are no apparent defects except those noted in the inventory.</p>
<p>(ii) The Lessee shall maintain the premises with the care of a bonus paterfamilias and perform all ordinary maintenance.</p>
<p>(iii) All extraordinary structural repairs shall be borne by the Lessor. The Lessee shall notify the Lessor promptly of any structural issues.</p>
<p>(iv) At termination, the Lessee shall surrender the premises in good repair, clean and tidy, fair wear and tear accepted.</p>
<p>(v) No improvements or alterations may be made without the written consent of the Lessor.</p>

<div class="section-title">UTILITY BILLS &amp; SERVICES</div>
<p>(i) The Lessor ensures all utilities are paid until lease commencement.</p>
<p>(ii) Annex B includes ARMS Form H and Form N signed by both parties.</p>

<div class="section-title">TERMINATION &amp; RENEWAL</div>
${type === 'long' ? `
<p>(i) After expiry of the Di Fermo period, the Lessee may terminate by giving ${listing.notice_period || '1 month'} written notice by registered letter.</p>
<p>(ii) If the Lessor fails to notify non-renewal at least 3 months before expiry, the lease renews automatically for 1 year under the same conditions.</p>` : `
<p>(i) After 1 month from commencement, the Lessee may terminate by giving 1 week's notice by registered letter. No penalty applies.</p>
<p>(ii) This agreement expires automatically on the end date and shall NOT be renewed.</p>`}

<div class="section-title">MISCELLANEOUS</div>
<p>(i) <strong>Registration:</strong> The Lessor undertakes to register this lease with the Housing Authority of Malta within 10 days of commencement. An unregistered lease is null and void under Cap. 604.</p>
<p>(ii) <strong>Governing Law:</strong> This agreement is governed by the Private Residential Leases Act, Cap. 604, and the laws of Malta.</p>
<p>(iii) Additional clauses: _______________________________________________</p>

<div class="warning">
  ⚠️ <strong>IMPORTANT:</strong> This lease must be registered with the Housing Authority of Malta within 10 days of commencement (rentregistration.mt). An unregistered lease is null and void. Both parties should retain a copy of the registration confirmation.
</div>

<div class="section-title">SIGNATURES</div>
<p>Both parties confirm they have read, understood and agree to all terms of this lease agreement.</p>

<div class="sig-section">
  <div class="sig-row">
    <div class="sig-block">
      <div class="sig-name">LESSOR: ${landlord.name || '—'}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</div>
      <p style="font-size:9pt;margin-top:6px">ID/Passport: ${landlord.passport || '—'}</p>
    </div>
    <div class="sig-block">
      <div class="sig-name">LESSEE 1: ${tenant.name || '—'}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</div>
      <p style="font-size:9pt;margin-top:6px">ID/Passport: ${tenant.passport || '—'}</p>
    </div>
  </div>
  ${coSigHtml ? `<div class="sig-row">${coSigHtml}</div>` : ''}
</div>

<div class="footer">
  This contract is based on the official ${typeLabel} template — Housing Authority of Malta (SL 604.02)<br>
  Generated by RestMalta — restmalta.com | ${today}
</div>

</body>
</html>`;

    // Build submitters
    const finalSubmitters = [
      { role: 'Lessor', email: landlord.email, name: landlord.name || 'Landlord' },
      { role: 'Lessee1', email: tenant.email, name: tenant.name || 'Tenant' }
    ];

    if (coTenants && coTenants.length) {
      coTenants.forEach((ct, i) => {
        finalSubmitters.push({
          role: 'Lessee1',
          email: ct.email || '',
          name: ct.name || 'Co-Tenant'
        });
      });
    }

    // Send to DocuSeal as HTML submission
    const res = await fetch('https://api.docuseal.eu/submissions/init', {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCU_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_id: type === 'short' || type === 'sublet' ? 520701 : 520700,
        send_email: true,
        submitters: finalSubmitters,
        message: {
          subject: `RestMalta — ${typeLabel} to sign`,
          body: `Please review and sign your ${typeLabel} for ${listing.address || 'your property'} in Malta. Monthly rent: €${listing.price}. Start date: ${startFormatted}.`
        },
        values: {
          landlord_name: landlord.name || '',
          tenant_name: tenant.name || '',
          property_address: listing.address || '',
          monthly_rent: String(listing.price || ''),
          start_date: startFormatted,
          end_date: endFormatted,
        }
      })
    });

    const data = await res.json();

    if (data.id) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          submission_id: data.id,
          html,
          signing_url: data.submitters?.[1]?.embed_src || null
        })
      };
    } else {
      // Fallback — return HTML for download
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          submission_id: null,
          html,
          fallback: true,
          docuseal_error: data
        })
      };
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
