const { createClient } = require('@supabase/supabase-js');

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
    const {
      type = 'long', // 'long' ou 'short'
      landlord,      // { name, passport, dob, address, email }
      tenant,        // { name, passport, dob, nationality, address, email }
      coTenants,     // []
      listing,       // { address, price, deposit, payment_due_day, bills, notice_period }
      start_date,
      end_date,
      meter_water,
      meter_electricity,
      inventory_notes,
      short_let_reason // pour short-let: 'work', 'study', 'medical', 'tourism', 'other'
    } = JSON.parse(event.body);

    // Formater les dates
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const startFmt = start_date ? new Date(start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '_______________';
    const endFmt = end_date ? new Date(end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '_______________';
    const meterDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const duration = type === 'short' ? '6 months' : '1 year';
    const diFermo = type === 'short' ? '1 month' : '6 months';

    const shortReasons = {
      work: 'the lessee is required to reside in Malta for work purposes',
      study: 'the lessee is required to reside in Malta for study/educational purposes',
      medical: 'the lessee is required to reside in Malta for medical treatment purposes',
      tourism: 'the lessee is required to reside in Malta temporarily',
      other: 'the lessee requires temporary accommodation in Malta'
    };

    // Générer le HTML du bail officiel maltais
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.6; margin: 2cm; color: #000; }
  h1 { text-align: center; font-size: 13pt; text-transform: uppercase; font-weight: bold; margin-bottom: 20px; }
  h2 { font-size: 11pt; font-weight: bold; margin-top: 16px; margin-bottom: 6px; }
  .details { margin-bottom: 20px; }
  .field { border-bottom: 1px solid #000; display: inline-block; min-width: 150px; }
  .field-long { border-bottom: 1px solid #000; display: inline-block; min-width: 300px; }
  ol { margin: 8px 0; padding-left: 20px; }
  li { margin-bottom: 6px; }
  .italic { font-style: italic; }
  .section { margin-top: 16px; }
  .sig-block { margin-top: 40px; display: flex; justify-content: space-between; }
  .sig-box { width: 45%; }
  .sig-line { border-top: 1px solid #000; margin-top: 60px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #000; padding: 6px 8px; font-size: 10pt; }
  th { background: #f0f0f0; font-weight: bold; text-align: center; }
  .meter-box { background: #f9f9f9; border: 1px solid #ccc; padding: 10px; margin: 10px 0; }
  @media print { body { margin: 1.5cm; } }
</style>
</head>
<body>

<h1>${type === 'long' ? 'LONG' : 'SHORT'} PRIVATE RESIDENTIAL LEASE</h1>

<div class="details">
  <p>This, day of <span class="field-long">${today}</span></p>

  <p>By the present private writing there appear on the one part <span class="field-long">${landlord?.name || '_______________'}</span>, 
  son/daughter of <span class="field">${landlord?.father_name || '_______________'}</span> 
  and <span class="field">${landlord?.mother_name || '_______________'}</span> 
  neè <span class="field">${landlord?.mother_maiden || '_______________'}</span>, 
  born in <span class="field">${landlord?.place_of_birth || '_______________'}</span> 
  and residing at <span class="field-long">${landlord?.address || '_______________'}</span>, 
  holder of a legally valid identification document number <span class="field">${landlord?.passport || '_______________'}</span> 
  and user of e-mail address <span class="field-long">${landlord?.email || '_______________'}</span>, 
  hereinafter referred to as the <strong>lessor</strong>.</p>

  <p>And on the other part <span class="field-long">${tenant?.name || '_______________'}</span>, 
  son/daughter of <span class="field">${tenant?.father_name || '_______________'}</span> 
  and <span class="field">${tenant?.mother_name || '_______________'}</span> 
  neè <span class="field">${tenant?.mother_maiden || '_______________'}</span>, 
  born in <span class="field">${tenant?.place_of_birth || '_______________'}</span> 
  and residing at <span class="field-long">${tenant?.address || '_______________'}</span>, 
  holder of a legally valid identification document number <span class="field">${tenant?.passport || '_______________'}</span> 
  and user of e-mail address <span class="field-long">${tenant?.email || '_______________'}</span>, 
  hereinafter referred to as the <strong>lessee</strong>.</p>

  <p>And hereby the lessor is granting by title of lease to the lessee who under the same title of lease accepts 
  <span class="field-long">${listing?.address || '_______________'}</span> 
  hereinafter referred to as the premises, subject to the following terms and conditions:</p>
</div>

<div class="section">
<h2>Payment &amp; Duration</h2>
<ol type="i">
  <li>The lease shall run for a period of <strong>${duration}</strong> with effect as from the 
  <strong>${startFmt}</strong> up to and including <strong>${endFmt}</strong>.</li>

  ${type === 'short' ? `
  <li>The reason for which the premises is being leased for a short period is because ${shortReasons[short_let_reason] || shortReasons.other}.</li>
  <li>The lessee may be released from the contract after the first compulsory month by giving at least one (1) week's notice to the lessor by means of a registered letter. This contract cannot be renewed.</li>
  ` : `
  <li>After the first compulsory period of <strong>${diFermo}</strong>, the lessee may, at any time, notify the lessor of his/her intention to terminate the agreement, by giving at least one (1) month's written notice to the lessor by means of a registered letter.</li>
  <li>If, within at least three (3) months of the termination of the present agreement, the lessor fails to notify the lessee of his/her intention not to renew the lease, or to renew it under different conditions, the present agreement shall be renewed, under the same conditions, for a period of one (1) year.</li>
  `}

  <li>The monthly rent payable by the lessee to the lessor for the use and enjoyment of the premises is 
  <strong>€${listing?.price || '___'}/month</strong>, 
  payable on or before the <strong>${listing?.payment_due_day || '1st'}</strong> day of each month.</li>

  ${type === 'long' ? `
  <li>After the first year of the agreement the monthly rent may increase in proportion to the yearly adjustment of the Property Price Index (PPI), published by the National Statistics Office (NSO). Any annual increase in rent shall not exceed five percent (5%) of the rent established.</li>
  ` : ''}

  <li class="italic">[add any other clauses, deemed necessary provided that said clauses are in full respect of the laws of Malta].</li>
</ol>
</div>

<div class="section">
<h2>Deposit</h2>
<ol type="i">
  <li>The lessee hereby pays unto the lessor who accepts and issues due receipt, the further sum of 
  <strong>€${listing?.deposit || '___'}</strong> being a deposit paid by the said lessee in security of the payment of such amounts which in terms of law or of this agreement are payable by the lessee.</li>
  <li>The deposit paid in terms of this paragraph is to be retained by the lessor for the duration of the lease and shall be thereafter released by the same lessor, in part or in whole, as the case may be, provided that the premises after having been inspected by the lessor (or his/her agent) is found to be in the same condition (except fair wear and tear) as it was when occupation was effected and upon verification and confirmation of the payment by the lessee of all such amounts which in terms of law or of this agreement are or shall become due by the lessee.</li>
  <li>Annex A shall include an inventory containing all the movables present in the premises. The list shall include photographs of the state in which any of the movables have been delivered to the lessee.</li>
  <li>The payment by the lessee of the deposit set out in this paragraph shall not release the lessee from the obligation to pay such amounts which in terms of law or of this agreement are payable by the lessee.</li>
  <li>The lessor shall be freely entitled to set off and thereafter retain, the deposit or part thereof, against the unpaid portion of any amounts payable by the lessee in terms of the law or of this agreement.</li>
</ol>
</div>

<div class="section">
<h2>Obligations of the Lessee</h2>
<ol type="i">
  <li>The lessee shall use the premises for residential purposes only and shall not without the written consent of the lessor, use them for any other purpose, whether commercial, industrial or otherwise.</li>
  <li>The lessee shall not sublet, transfer or otherwise assign the premises, in whole or in part, without the prior written consent of the lessor.</li>
  <li>The lessee shall be responsible for the payment of all water and electricity bills and all other utilities accruing from the date of commencement of the lease.</li>
  <li>The lessee shall maintain the premises in a clean and tidy state and upon the termination of the lease, shall return the premises to the lessor in the same state and condition as they were found at the commencement of the lease, fair wear and tear excepted.</li>
  <li>All extraordinary structural repairs, save those occasioned or contributed to by the acts or omissions of the lessee shall be executed by the lessor and the expenses incurred or incurable in connection with such repairs shall be borne by the lessor, and the lessee shall not, unless authorised so to do by the lessor, perform or order the performance of any extraordinary repairs except in urgent cases and only in accordance with the law.</li>
  <li>At the termination of the lease, the lessee is to surrender the premises unto the lessor in a good state of repair, clean and tidy, fair wear and tear accepted.</li>
  <li>The lessee shall not, under any circumstance, and without the written consent of the lessor, be entitled to execute and perform any improvements or alterations of whatever nature to the premises.</li>
  <li class="italic">[add any other clauses, deemed necessary provided that said clauses are in full respect of the laws of Malta]</li>
</ol>
</div>

<div class="section">
<h2>Utility Bills &amp; Services</h2>
<ol type="i">
  <li>The lessor shall ensure that all utilities and other fees or bills payable in respect of rent/consumption until the commencement of the lease are duly paid and settled.</li>
  <li>Annex B shall include Automated Revenue and Management Services (ARMS), Form H and Form N duly filled and signed by both parties to this agreement.</li>
  <li>Both parties to this agreement declare that water/electricity meters were read on the day of the entry inventory and key handover. The meter readings shall be recorded in <strong>Annex A (Entry Inventory and Condition Form)</strong>, which forms an integral part of this agreement and shall be annexed hereto on the day of move-in.
    <div class="meter-box" style="background:#fffbeb;border:1px solid #f6d860;padding:10px;border-radius:5px;margin-top:6px">
      <p style="font-weight:700;color:#744210">📋 ANNEX A — To be completed on move-in day:</p>
      <p>Water meter reading: <em>to be annexed on ${start_date ? new Date(start_date).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'}) : 'move-in day'}</em></p>
      <p>Electricity meter reading: <em>to be annexed on ${start_date ? new Date(start_date).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'}) : 'move-in day'}</em></p>
    </div>
  </li>
</ol>
</div>

${type === 'long' ? `
<div class="section">
<h2>Termination &amp; Renewal Notices</h2>
<ol type="i">
  <li>The lessee, may at any time, after the expiration of the compulsory period established by the law, notify the lessor of his/her intention to terminate the agreement, in the manner provided for by the law.</li>
  <li>If, within at least three (3) months of the termination of the present agreement, the lessor fails to notify the lessee of his/her intention not to renew the lease, or to renew it under different conditions, the present agreement shall be renewed, under the same conditions, for a period of one (1) year.</li>
  <li class="italic">[add any other clauses, deemed necessary provided that said clauses are in full respect of the laws of Malta]</li>
</ol>
</div>
` : ''}

${inventory_notes ? `
<div class="section">
<h2>General Observations / Additional Notes</h2>
<p>${inventory_notes}</p>
</div>
` : ''}

<div class="section sig-block">
  <div class="sig-box">
    <p><strong>LESSOR (Landlord)</strong></p>
    <p>${landlord?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:9pt;color:#666">Signature &amp; Date</p>
  </div>
  <div class="sig-box">
    <p><strong>LESSEE (Tenant)</strong></p>
    <p>${tenant?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:9pt;color:#666">Signature &amp; Date</p>
  </div>
</div>

<p style="font-size:8pt;color:#888;margin-top:20px;text-align:center">
  This agreement is drawn up in accordance with the Private Residential Leases Act, Chapter 604 of the Laws of Malta.<br>
  This lease must be registered with the Housing Authority within 30 days from commencement at <a href="https://rentregistration.mt">rentregistration.mt</a>
</p>

</body>
</html>`;

    // Envoyer à DocuSeal
    const submitters = [
      { role: 'Lessor', email: landlord?.email, name: landlord?.name || 'Landlord' },
      { role: 'Lessee', email: tenant?.email, name: tenant?.name || 'Tenant' }
    ];

    const res = await fetch(DOCU_URL, {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        send_email: false,
        submitters
      })
    });

    const data = await res.json();
    const submitters_data = Array.isArray(data) ? data : (data.submitters || []);
    const submissionId = submitters_data[0]?.submission_id || data.id;
    const lessorData = submitters_data.find(s => s.role === 'Lessor') || submitters_data[0];
    const lesseeData = submitters_data.find(s => s.role === 'Lessee') || submitters_data[1];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        submission_id: submissionId,
        type,
        lessor_embed_src: lessorData?.embed_src || null,
        lessee_embed_src: lesseeData?.embed_src || null
      })
    };

  } catch (e) {
    console.error('generate-lease error:', e.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
