const DOCU_KEY = process.env.DOCUSEAL_KEY || process.env.DOCUSEAL_API_KEY;

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
      landlord, tenant, listing,
      coTenants = [], // même structure que generate-lease.js : [{name,email,...}]
      meter_water, meter_electricity,
      rooms = [], // [{ name, items: [{item, qty, condition_arrival, notes}] }]
      photos = {}, // { room_0: [{url,name}], meter_water: [{url,name}], ... } — sans ça, les photos prises pendant la création de l'EDL n'apparaissaient jamais dans le document réellement signé
      general_notes,
      phase = 'arrival' // 'arrival' ou 'departure'
    } = JSON.parse(event.body);

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const phaseLabel = phase === 'departure' ? 'upon Departure' : 'on Arrival';

    // IMPORTANT — la liste "officielle" précédente (12 sections à noms fixes,
    // ex. "Exterior Items", "Common Areas / Entrance") ne correspondait à
    // AUCUN des noms envoyés par les 3 interfaces (ex. "Exterior", "Entrance")
    // : la fusion par égalité de nom ne trouvait donc jamais rien, et toutes
    // les données saisies (état, quantité, notes) disparaissaient
    // silencieusement du document réellement signé — exactement le décalage
    // entre "ce qu'on fait" et "ce qu'on signe" qu'on cherche à corriger ici.
    // On utilise désormais exactement ce que le client a rempli, tel quel.
    const allRooms = (rooms || []).map(r => ({
      name: r.name,
      items: (r.items || []).map(it => ({
        item: it.item,
        qty: it.qty || '',
        condition: it.condition_arrival || '',
        notes: it.notes || ''
      }))
    }));

    const photoRow = (pics) => {
      if (!pics || !pics.length) return '';
      return `<div style="margin-top:6px">${pics.map(p => `<img src="${p.url}" style="width:110px;height:110px;object-fit:cover;border-radius:4px;border:1px solid #ccc;margin-right:6px;margin-bottom:6px" />`).join('')}</div>`;
    };

    const renderTable = (section, roomIndex) => `
      <h2 style="font-size:11pt;background:#2c5282;color:white;padding:6px 10px;margin-top:20px">${section.name}</h2>
      <table>
        <thead>
          <tr>
            <th style="width:35%">Item</th>
            <th style="width:10%">Qty</th>
            <th style="width:30%">Condition ${phaseLabel}</th>
            <th style="width:25%">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${section.items.map(item => `
          <tr>
            <td>${item.item}</td>
            <td style="text-align:center">${item.qty || ''}</td>
            <td>${item.condition ? `<span style="color:${item.condition==='Good'?'green':item.condition==='Fair'?'orange':'red'}">${item.condition}</span>` : '&nbsp;'}</td>
            <td style="font-size:9pt">${item.notes || '&nbsp;'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${photoRow(photos[`room_${roomIndex}`])}`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.4; margin: 1.5cm; color: #000; }
  h1 { text-align: center; font-size: 14pt; font-weight: bold; color: #2c5282; margin-bottom: 5px; }
  h2 { font-size: 11pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 9.5pt; }
  th, td { border: 1px solid #ccc; padding: 5px 7px; vertical-align: top; }
  th { background: #ebf4ff; font-weight: bold; }
  .info-box { background: #f7faff; border: 1px solid #bee3f8; border-radius: 5px; padding: 10px 15px; margin-bottom: 15px; }
  .meter-box { background: #fffbeb; border: 1px solid #f6d860; border-radius: 5px; padding: 10px 15px; margin: 10px 0; }
  .sig-block { display: flex; justify-content: space-between; margin-top: 30px; }
  .sig-box { width: 45%; }
  .sig-line { border-top: 1px solid #000; margin-top: 50px; }
  .note { font-size: 8.5pt; color: #666; font-style: italic; }
</style>
</head>
<body>

<h1>Sample Property Inventory and Condition Form<br>for Private Residential Leases</h1>
<p style="text-align:center;font-size:9pt;color:#666">Housing Authority Malta — Official Form — Chapter 604, Laws of Malta</p>

<div class="info-box">
  <table style="border:none">
    <tr>
      <td style="border:none;width:50%;padding:3px"><strong>Property address:</strong><br>${listing?.address || '_______________'}</td>
      <td style="border:none;width:50%;padding:3px"><strong>Date of inventory:</strong><br>${today}</td>
    </tr>
    <tr>
      <td style="border:none;padding:3px"><strong>Lessor (Landlord):</strong><br>${landlord?.name || '_______________'}</td>
      <td style="border:none;padding:3px"><strong>Lessee (Tenant):</strong><br>${tenant?.name || '_______________'}</td>
    </tr>
    <tr>
      <td style="border:none;padding:3px"><strong>Phase:</strong> ${phase === 'departure' ? '⬆️ Entry inventory (Move-out / Departure)' : '⬇️ Entry inventory (Move-in / Arrival)'}</td>
      <td style="border:none;padding:3px"><strong>Monthly rent:</strong> €${listing?.price || '___'}/month</td>
    </tr>
  </table>
</div>

<p class="note">This inventory is referred to as Annex A/B in the lease agreement and serves as documentary evidence and attests the condition of the tenement to be leased by the lessee as well as the state of the furniture and domestic appliances that are being supplied by the lessor. This inventory should be filled in by the lessor and the lessee prior to the commencement of the lease. A signed copy should be held by both parties. Items that do not apply are to be crossed out. The same form should be used upon the dissolution of the lease.</p>

<div class="meter-box">
  <strong>🔌 Utility Meter Readings — ${today}</strong><br>
  <table style="margin-top:8px;border:none">
    <tr>
      <td style="border:none;padding:3px;width:50%">💧 <strong>Water meter:</strong> ${meter_water || '_______________'}</td>
      <td style="border:none;padding:3px;width:50%">⚡ <strong>Electricity meter:</strong> ${meter_electricity || '_______________'}</td>
    </tr>
    <tr>
      <td style="border:none;padding:3px;vertical-align:top">${photoRow(photos.meter_water)}</td>
      <td style="border:none;padding:3px;vertical-align:top">${photoRow(photos.meter_electricity)}</td>
    </tr>
  </table>
</div>

${allRooms.map((r, i) => renderTable(r, i)).join('')}

${general_notes ? `
<div style="margin-top:15px;background:#fff9db;border:1px solid #f6d860;border-radius:5px;padding:10px">
  <strong>📝 General Observations / Additional Notes:</strong>
  <p>${general_notes}</p>
</div>` : ''}

<div class="sig-block">
  <div class="sig-box">
    <p><strong>LESSOR (Landlord)</strong></p>
    <p>${landlord?.name || '_______________'}</p>
    <p>Signature: <text-field name="Lessor Signature" role="Lessor" required="true" type="signature" style="width: 180px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
    <p>Date: <text-field name="Lessor Date" role="Lessor" required="true" type="date" style="width: 110px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  </div>
  <div class="sig-box">
    <p><strong>LESSEE${coTenants?.length ? ' 1' : ''} (Tenant)</strong></p>
    <p>${tenant?.name || '_______________'}</p>
    <p>Signature: <text-field name="Lessee Signature" role="Lessee" required="true" type="signature" style="width: 180px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
    <p>Date: <text-field name="Lessee Date" role="Lessee" required="true" type="date" style="width: 110px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  </div>
</div>

${(coTenants || []).map((ct, i) => `
<div class="sig-block" style="margin-top:20px">
  <div class="sig-box">
    <p><strong>LESSEE ${i + 2} (Co-tenant)</strong></p>
    <p>${ct?.name || '_______________'}</p>
    <p>Signature: <text-field name="Lessee ${i + 2} Signature" role="Lessee ${i + 2}" required="true" type="signature" style="width: 180px; height: 50px; display: inline-block; margin-bottom: -4px"> </text-field></p>
    <p>Date: <text-field name="Lessee ${i + 2} Date" role="Lessee ${i + 2}" required="true" type="date" style="width: 110px; height: 16px; display: inline-block; margin-bottom: -4px"> </text-field></p>
  </div>
  <div class="sig-box"></div>
</div>`).join('')}

</body>
</html>`;

    // Envoyer à DocuSeal — même procédé en 2 étapes que le bail/renouvellement :
    // 1) créer un template depuis le HTML, 2) créer une soumission à partir de ce template.
    // L'ancien code appelait directement /submissions/init en un seul appel, ce qui ne
    // renvoyait jamais de vrais liens de signature exploitables.
    if (!DOCU_KEY) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, edl_html: html, message: 'EDL generated — DocuSeal not configured' }) };
    }

    const tplRes = await fetch('https://api.docuseal.eu/templates/html', {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Move-in Inventory — ' + (listing?.address || 'Malta'),
        documents: [{ name: 'Annex A - Inventory', html }]
      })
    });

    if (!tplRes.ok) {
      const errText = await tplRes.text();
      console.error('DocuSeal template error:', errText);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, edl_html: html, message: 'DocuSeal template error: ' + errText.slice(0, 200) }) };
    }

    const tplData = await tplRes.json();
    const templateId = tplData.id;
    if (!templateId) {
      console.error('No template ID returned:', JSON.stringify(tplData));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, edl_html: html, message: 'No template ID' }) };
    }

    const submitters = [
      { role: 'Lessor', email: landlord?.email || '', name: landlord?.name || 'Landlord' },
      { role: 'Lessee', email: tenant?.email || '', name: tenant?.name || 'Tenant' },
      ...(coTenants || []).map((ct, i) => ({
        role: `Lessee ${i + 2}`,
        email: ct?.email || '',
        name: ct?.name || `Co-tenant ${i + 2}`
      }))
    ];

    const res = await fetch('https://api.docuseal.eu/submissions', {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        send_email: false,
        submitters
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('DocuSeal submission error:', errText);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, submission_id: null, lessor_embed_src: null, lessee_embed_src: null, edl_html: html, message: 'DocuSeal submission error: ' + errText.slice(0, 200) }) };
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
        lessor_slug: lessorData?.slug || null,
        lessee_slug: lesseeData?.slug || null,
        co_lessees_embed_src: coLesseeData.map(s => ({ role: s.role, embed_src: s.embed_src, email: s.email }))
      })
    };

  } catch (e) {
    console.error('generate-edl error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
