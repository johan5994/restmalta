exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { tenant, listing, holding_amount, commission_amount, total_amount, booking_id } = JSON.parse(event.body);
    const DOCU_KEY = process.env.DOCUSEAL_KEY;

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #1a1410; margin: 0; padding: 40px; line-height: 1.6; }
  .header { background: #C9553A; color: white; padding: 16px 24px; margin: -40px -40px 30px -40px; display: flex; justify-content: space-between; align-items: center; }
  .header-title { font-size: 14pt; font-weight: bold; }
  h1 { font-size: 16pt; text-align: center; color: #C9553A; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #6B5F52; font-size: 9pt; margin-bottom: 24px; }
  .section-title { background: #C9553A; color: white; padding: 6px 10px; font-weight: bold; font-size: 10pt; margin: 18px -10px 10px -10px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10.5pt; }
  .info-table .label { font-weight: bold; color: #6B5F52; width: 45%; }
  .info-table .value { color: #1a1410; }
  p { font-size: 10.5pt; margin: 6px 0; text-align: justify; }
  .warning { background: #FFF8E6; border: 1px solid #D4A847; padding: 10px 14px; margin: 16px 0; font-size: 9.5pt; }
  .sig-section { margin-top: 30px; }
  .sig-row { display: flex; gap: 20px; margin-bottom: 24px; }
  .sig-block { flex: 1; border-top: 1px solid #6B5F52; padding-top: 10px; }
  .sig-name { font-weight: bold; font-size: 10pt; margin-bottom: 30px; }
  .sig-line { border-bottom: 1px solid #333; margin-bottom: 6px; height: 40px; }
  .sig-label { font-size: 8.5pt; color: #6B5F52; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 8pt; color: #6B5F52; text-align: center; }
  .total-row { background: #f5f5f5; font-weight: bold; }
</style>
</head>
<body>

<div class="header">
  <div class="header-title">RestMalta</div>
  <div style="font-size:9pt;opacity:.85">Holding Deposit Agreement</div>
</div>

<h1>HOLDING DEPOSIT AGREEMENT</h1>
<p class="subtitle">Property Reservation Document — RestMalta Platform<br>
Generated on ${today}</p>

<p>This Holding Deposit Agreement is entered into on <strong>${today}</strong> between:</p>

<div class="section-title">TENANT (PROSPECTIVE LESSEE)</div>
<table class="info-table">
  <tr><td class="label">Full name</td><td class="value">${tenant.name || '—'}</td></tr>
  <tr><td class="label">ID/Passport No.</td><td class="value">${tenant.passport || '—'}</td></tr>
  <tr><td class="label">Nationality</td><td class="value">${tenant.nationality || '—'}</td></tr>
  <tr><td class="label">Email</td><td class="value">${tenant.email || '—'}</td></tr>
  <tr><td class="label">Phone</td><td class="value">${tenant.phone || '—'}</td></tr>
</table>

<div class="section-title">PROPERTY</div>
<table class="info-table">
  <tr><td class="label">Property</td><td class="value">${listing.title || '—'}</td></tr>
  <tr><td class="label">Address</td><td class="value">${listing.address || listing.zone || 'Malta'}</td></tr>
  <tr><td class="label">Monthly rent</td><td class="value">€${listing.price || '—'}/month</td></tr>
  <tr><td class="label">Lease type</td><td class="value">${listing.type === 'short' ? 'Short-let (max 6 months)' : 'Long-let (min 1 year)'}</td></tr>
  <tr><td class="label">Booking reference</td><td class="value">${booking_id || '—'}</td></tr>
</table>

<div class="section-title">FINANCIAL BREAKDOWN</div>
<table class="info-table">
  <tr><td class="label">Holding Deposit (½ month rent)</td><td class="value">€${holding_amount || '—'}</td></tr>
  <tr><td class="label">RestMalta Service Fee (40% TTC)</td><td class="value">€${commission_amount || '—'}</td></tr>
  <tr class="total-row"><td class="label">TOTAL CHARGED TODAY</td><td class="value">€${total_amount || '—'}</td></tr>
</table>

<p><strong>Note:</strong> The Holding Deposit of €${holding_amount} will be deducted from the first month's rent at lease signing. If the Landlord accepts this application, the RestMalta Service Fee is earned. If the Landlord declines, <strong>both amounts are fully refunded</strong> to the Tenant within 3-5 business days.</p>

<div class="section-title">TERMS & CONDITIONS</div>
<p><strong>1. Reservation Effect:</strong> By signing this agreement and completing payment, the Tenant reserves the above property exclusively. The Landlord agrees to remove the listing from the market during the review period (48 hours).</p>

<p><strong>2. Landlord Review Period:</strong> The Landlord has <strong>48 hours</strong> from receipt of this agreement to accept or decline the Tenant's application. Deadline: <strong>${deadline}</strong>.</p>

<p><strong>3. If Landlord Accepts:</strong> The Holding Deposit (€${holding_amount}) is transferred to the Landlord and deducted from the first month's rent. The lease agreement will be generated and sent for e-signature via DocuSeal within 24 hours.</p>

<p><strong>4. If Landlord Declines:</strong> The Tenant receives a full refund of €${total_amount} (Holding Deposit + RestMalta Service Fee) within 3-5 business days. No questions asked.</p>

<p><strong>5. If Tenant Withdraws (after Landlord acceptance):</strong> The Holding Deposit (€${holding_amount}) is <strong>non-refundable</strong> and kept by the Landlord as compensation for removing the property from the market. The RestMalta Service Fee will not be refunded.</p>

<p><strong>6. Governing Law:</strong> This agreement is governed by the laws of Malta (Private Residential Leases Act, Cap. 604).</p>

<div class="warning">
  ⚠️ <strong>IMPORTANT:</strong> This is a legally binding document. By signing, the Tenant confirms they have read, understood, and agree to all terms above. RestMalta acts as an independent platform and is not a party to the lease agreement.
</div>

<div class="sig-section">
  <div class="sig-row">
    <div class="sig-block">
      <div class="sig-name">TENANT: ${tenant.name || '—'}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: _______________</div>
    </div>
    <div class="sig-block">
      <div class="sig-name">RestMalta Platform</div>
      <div class="sig-line"></div>
      <div class="sig-label">Platform Representative &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ${today}</div>
    </div>
  </div>
</div>

<div class="footer">
  RestMalta — Malta's Digital Rental Platform — restmalta.com<br>
  Booking Reference: ${booking_id || '—'} | Generated: ${today}
</div>

</body>
</html>`;

    // Envoyer à DocuSeal — le tenant signe, RestMalta signe automatiquement
    const res = await fetch('https://api.docuseal.eu/submissions/init', {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        send_email: true,
        submitters: [
          { role: 'Tenant', email: tenant.email, name: tenant.name || 'Tenant' }
        ],
        message: {
          subject: `RestMalta — Please sign your Holding Deposit Agreement`,
          body: `You have reserved ${listing.title || 'a property'} in Malta. Please sign the Holding Deposit Agreement to confirm your reservation. Total charged: €${total_amount}.`
        }
      })
    });

    const data = await res.json();
    const submissionId = data.id || data[0]?.id;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        submission_id: submissionId,
        html
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
