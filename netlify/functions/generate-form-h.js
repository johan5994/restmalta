const DOCU_KEY = process.env.DOCUSEAL_API_KEY;
const DOCU_URL = 'https://api.docuseal.eu/submissions/init';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { landlord, tenant, listing, arms_account, residents, meter_water, meter_electricity } = JSON.parse(event.body);

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 10pt; margin: 1.5cm; color: #000; }
  h1 { text-align: center; font-size: 13pt; font-weight: bold; color: #2c5282; }
  h2 { font-size: 11pt; font-weight: bold; color: #2c5282; border-bottom: 2px solid #2c5282; padding-bottom: 3px; margin-top: 20px; }
  .field-box { border: 1px solid #ccc; border-radius: 5px; padding: 8px 12px; margin: 5px 0; background: #f9f9f9; }
  .label { font-size: 9pt; color: #666; margin-bottom: 3px; }
  .value { font-size: 10.5pt; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .info-box { background: #ebf8ff; border: 1px solid #90cdf4; border-radius: 6px; padding: 10px 15px; margin: 10px 0; font-size: 9.5pt; }
  .warning { background: #fffbeb; border: 1px solid #f6e05e; border-radius: 6px; padding: 8px 12px; font-size: 9pt; color: #744210; margin: 10px 0; }
  .sig-block { display: flex; justify-content: space-between; margin-top: 30px; }
  .sig-box { width: 45%; }
  .sig-line { border-top: 1px solid #000; margin-top: 50px; }
</style>
</head>
<body>

<div style="text-align:center;margin-bottom:20px">
  <img src="https://arms.com.mt/wp-content/uploads/2020/01/ARMS-Logo.png" alt="ARMS" style="height:50px;margin-bottom:5px" onerror="this.style.display='none'">
  <h1>FORM H<br><span style="font-size:10pt;font-weight:normal">Declaration of Number of Residents</span></h1>
  <p style="font-size:9pt;color:#666">ARMS Ltd — Automated Revenue and Management Services<br>P.O. Box 63, Marsa, MRS 1000, Malta | Tel: 8077 2222 | customercare@arms.com.mt</p>
</div>

<div class="info-box">
  <strong>Purpose of this form:</strong> This form registers the change in the number of persons residing in the premises. This ensures that the new resident(s) benefit from the <strong>residential tariff</strong> for electricity and water, including eco-reduction and water subsidy.
</div>

<h2>1. Property Details</h2>
<div class="grid">
  <div class="field-box">
    <div class="label">Property address</div>
    <div class="value">${listing?.address || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">ARMS Account Number</div>
    <div class="value">${arms_account || '_______________'}</div>
  </div>
</div>

<div class="grid" style="margin-top:10px">
  <div class="field-box">
    <div class="label">💧 Water meter reading (on arrival)</div>
    <div class="value">${meter_water || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">⚡ Electricity meter reading (on arrival)</div>
    <div class="value">${meter_electricity || '_______________'}</div>
  </div>
</div>

<h2>2. Owner / Lessor Details</h2>
<div class="grid">
  <div class="field-box">
    <div class="label">Full name</div>
    <div class="value">${landlord?.name || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">ID / Passport number</div>
    <div class="value">${landlord?.passport || '_______________'}</div>
  </div>
</div>

<h2>3. New Resident(s) / Lessee Details</h2>
<div class="grid">
  <div class="field-box">
    <div class="label">Full name</div>
    <div class="value">${tenant?.name || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">ID / Passport number</div>
    <div class="value">${tenant?.passport || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">Nationality</div>
    <div class="value">${tenant?.nationality || '_______________'}</div>
  </div>
  <div class="field-box">
    <div class="label">Number of persons now residing</div>
    <div class="value" style="font-size:14pt;color:#2c5282">${residents || 1}</div>
  </div>
</div>

<h2>4. Date of Change</h2>
<div class="field-box" style="max-width:300px">
  <div class="label">Date of occupancy commencement</div>
  <div class="value">${today}</div>
</div>

<div class="warning" style="margin-top:15px">
  <strong>⚠️ Important:</strong> A person may only be registered as a resident in <strong>one premises</strong> for subsidy purposes. By signing this form, the declarant confirms that the information provided is accurate. ARMS, Enemalta plc and Water Services Corporation reserve the right to cancel the service if information provided is incorrect.
</div>

<div style="margin-top:15px;font-size:9pt;color:#666;border:1px solid #ccc;border-radius:5px;padding:10px">
  <strong>How to submit this form:</strong><br>
  • Online: via your ARMS online account at <strong>arms.com.mt</strong><br>
  • In person: at ARMS Customer Contact Centre, Marsa or any ARMS office<br>
  • By email: customercare@arms.com.mt<br>
  • By post: ARMS Ltd, P.O. Box 63, Marsa, MRS 1000, Malta<br><br>
  Required documents: Copy of lease agreement + ID of all residents
</div>

<div class="sig-block">
  <div class="sig-box">
    <p><strong>OWNER / LESSOR</strong></p>
    <p>${landlord?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:8pt;color:#666">Signature &amp; Date</p>
  </div>
  <div class="sig-box">
    <p><strong>NEW RESIDENT / LESSEE</strong></p>
    <p>${tenant?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:8pt;color:#666">Signature &amp; Date</p>
  </div>
</div>

</body>
</html>`;

    const res = await fetch(DOCU_URL, {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        send_email: true,
        submitters: [
          { role: 'Owner', email: landlord?.email, name: landlord?.name || 'Landlord' },
          { role: 'Resident', email: tenant?.email, name: tenant?.name || 'Tenant' }
        ],
        message: {
          subject: `Form H — ARMS Declaration — ${listing?.address || 'Malta Property'} — Please sign`,
          body: `Please find attached the Form H (ARMS Declaration of Number of Residents) for the property at ${listing?.address || 'Malta'}. Both parties must sign and then submit to ARMS within 30 days.`
        }
      })
    });

    const data = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, submission_id: data.id || data[0]?.id })
    };

  } catch (e) {
    console.error('generate-form-h error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
