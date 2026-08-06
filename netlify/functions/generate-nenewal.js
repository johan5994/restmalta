const DOCU_KEY = process.env.DOCUSEAL_KEY || process.env.DOCUSEAL_API_KEY;
const DOCU_BASE = 'https://api.docuseal.eu';

// Avenant de renouvellement — pas un nouveau bail complet, juste un document
// court qui confirme le renouvellement d'un bail existant (nouvelle date de
// fin, nouveau loyer si changé), signé électroniquement par les deux parties.
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const {
      landlord,        // { name, passport, email }
      tenant,          // { name, passport, email }
      coTenants,       // []
      listing,         // { address }
      original_start_date,
      original_end_date,
      new_end_date,
      original_rent,
      new_rent
    } = JSON.parse(event.body);

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const origStartFmt = original_start_date ? new Date(original_start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '_______________';
    const origEndFmt = original_end_date ? new Date(original_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '_______________';
    const newEndFmt = new_end_date ? new Date(new_end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '_______________';
    const rentChanged = new_rent && original_rent && Number(new_rent) !== Number(original_rent);

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: Georgia, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; max-width: 700px; margin: 0 auto; padding: 30px">

<h2 style="text-align:center;margin-bottom:4px">LEASE RENEWAL ADDENDUM</h2>
<p style="text-align:center;color:#666;margin-top:0">Private Residential Leases Act, Chapter 604 of the Laws of Malta</p>

<p>Date: <strong>${today}</strong></p>

<p>This addendum renews the private residential lease agreement originally entered into for the property at:</p>
<p style="padding-left:20px"><strong>${listing?.address || '_______________'}</strong></p>

<p>between:</p>
<p style="padding-left:20px"><strong>Lessor:</strong> ${landlord?.name || '_______________'} (ID/Passport: ${landlord?.passport || '_______________'})</p>
<p style="padding-left:20px"><strong>Lessee:</strong> ${tenant?.name || '_______________'} (ID/Passport: ${tenant?.passport || '_______________'})</p>
${(coTenants || []).map(ct => `<p style="padding-left:20px"><strong>Co-Lessee:</strong> ${ct?.name || ''}</p>`).join('')}

<p>Original lease period: <strong>${origStartFmt}</strong> to <strong>${origEndFmt}</strong>.</p>

<h3>Terms of Renewal</h3>
<ol>
  <li>The lease is hereby renewed and shall continue until <strong>${newEndFmt}</strong>, on the same terms and conditions as the original lease agreement, save for the amendments below (if any).</li>
  ${rentChanged ? `<li>The monthly rent is amended from €${original_rent} to <strong>€${new_rent}</strong>, effective from the date of this addendum.</li>` : `<li>The monthly rent remains unchanged at €${original_rent || new_rent || '_______________'}.</li>`}
  <li>All other terms of the original lease agreement (deposit, notice period, bills arrangement, house rules) remain in full force and effect.</li>
  <li>This renewal must be registered with the Housing Authority within 30 days at <a href="https://rentregistration.mt">rentregistration.mt</a>, in line with the original registration.</li>
</ol>

<p>By signing below, both parties confirm their agreement to this renewal.</p>

<div style="margin-top:40px;display:flex;justify-content:space-between">
  <div style="width:45%">
    <p><strong>LESSOR</strong></p>
    <p>Signature: <text-field name="Lessor Signature" role="Lessor" required="true" type="signature" style="width: 200px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
    <p>Date: <text-field name="Lessor Date" role="Lessor" required="true" type="date" style="width: 120px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  </div>
  <div style="width:45%">
    <p><strong>LESSEE</strong></p>
    <p>Signature: <text-field name="Lessee Signature" role="Lessee" required="true" type="signature" style="width: 200px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
    <p>Date: <text-field name="Lessee Date" role="Lessee" required="true" type="date" style="width: 120px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  </div>
</div>

${(coTenants || []).map((ct, i) => `
<div style="margin-top:20px;width:45%">
  <p><strong>CO-LESSEE ${i + 2}</strong> — ${ct?.name || ''}</p>
  <p>Signature: <text-field name="Lessee ${i + 2} Signature" role="Lessee ${i + 2}" required="true" type="signature" style="width: 200px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  <p>Date: <text-field name="Lessee ${i + 2} Date" role="Lessee ${i + 2}" required="true" type="date" style="width: 120px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
</div>`).join('')}

<p style="font-size:8pt;color:#888;margin-top:20px;text-align:center">
  This addendum forms part of the original lease agreement and must be registered with the Housing Authority within 30 days at <a href="https://rentregistration.mt">rentregistration.mt</a>
</p>

</body>
</html>`;

    if (!DOCU_KEY) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          submission_id: null,
          lessor_embed_src: null,
          lessee_embed_src: null,
          renewal_html: html,
          message: 'Renewal generated — DocuSeal not configured'
        })
      };
    }

    const submitters = [
      { role: 'Lessor', email: landlord?.email || '', name: landlord?.name || 'Landlord' },
      { role: 'Lessee', email: tenant?.email || '', name: tenant?.name || 'Tenant' },
      ...(coTenants || []).map((ct, i) => ({
        role: `Lessee ${i + 2}`,
        email: ct?.email || '',
        name: ct?.name || `Co-Tenant ${i + 2}`
      }))
    ];

    const tplRes = await fetch(DOCU_BASE + '/templates/html', {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lease Renewal — ' + (listing?.address || 'Malta'),
        documents: [{ name: 'Renewal Addendum', html }]
      })
    });

    if (!tplRes.ok) {
      const errText = await tplRes.text();
      console.error('DocuSeal template error:', errText);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, renewal_html: html, message: 'DocuSeal template error: ' + errText.slice(0, 200) }) };
    }

    const tplData = await tplRes.json();
    const templateId = tplData.id;
    if (!templateId) {
      console.error('No template ID returned:', JSON.stringify(tplData));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, renewal_html: html, message: 'No template ID' }) };
    }

    const res = await fetch(DOCU_BASE + '/submissions', {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, send_email: false, submitters })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('DocuSeal submission error:', errText);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, renewal_html: html, message: 'DocuSeal submission error: ' + errText.slice(0, 200) }) };
    }

    const data = await res.json();
    const submitters_data = Array.isArray(data) ? data : (data.submitters || []);
    const submissionId = submitters_data[0]?.submission_id || data.id;
    const lessorData = submitters_data.find(s => s.role === 'Lessor') || submitters_data[0];
    const lesseeData = submitters_data.find(s => s.role === 'Lessee') || submitters_data[1];
    const coLesseeData = submitters_data.filter(s => s.role?.startsWith('Lessee ') && s.role !== 'Lessee');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        submission_id: submissionId,
        lessor_embed_src: lessorData?.embed_src || null,
        lessee_embed_src: lesseeData?.embed_src || null,
        co_lessees_embed_src: coLesseeData.map(s => ({ role: s.role, embed_src: s.embed_src, email: s.email }))
      })
    };

  } catch (e) {
    console.error('generate-renewal error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
