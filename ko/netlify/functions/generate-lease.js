exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { type, landlord, tenant, coTenants, listing, start_date, end_date, submitters } = JSON.parse(event.body);

    const DOCU_KEY = process.env.DOCUSEAL_KEY;
    const DOCU_TEMPLATES = { long: 520700, short: 520701, sublet: 520701, both: 520700 };
    const templateId = DOCU_TEMPLATES[type] || DOCU_TEMPLATES.long;

    const finalSubmitters = submitters || [
      { role: 'Lessor', email: landlord.email, name: landlord.name || 'Landlord' },
      { role: 'Lessee1', email: tenant.email, name: tenant.name || 'Tenant' }
    ];

    if (coTenants && coTenants.length && !submitters) {
      coTenants.forEach((ct, i) => {
        finalSubmitters.push({
          role: 'Lessee1',
          email: ct.email || '',
          name: ct.name || 'Co-Tenant'
        });
      });
    }

    const values = {
      landlord_name: landlord.name || '',
      landlord_passport: landlord.passport || '',
      landlord_address: landlord.address || '',
      landlord_phone: landlord.phone || '',
      landlord_iban: landlord.iban || '',
      landlord_email: landlord.email || '',
      tenant_name: tenant.name || '',
      tenant_passport: tenant.passport || '',
      tenant_nationality: tenant.nationality || '',
      tenant_dob: tenant.dob || '',
      tenant_address: tenant.address || '',
      tenant_phone: tenant.phone || '',
      tenant_email: tenant.email || '',
      property_address: listing.address || '',
      monthly_rent: String(listing.price || ''),
      deposit: String(listing.deposit || ''),
      start_date: start_date || '',
      end_date: end_date || '',
      payment_due_day: listing.payment_due_day || '1',
      notice_period: listing.notice_period || '1 month',
      bills: listing.bills || 'excluded',
    };

    if (coTenants && coTenants.length) {
      coTenants.forEach((ct, i) => {
        const n = i + 2;
        values[`tenant${n}_name`] = ct.name || '';
        values[`tenant${n}_passport`] = ct.passport || '';
        values[`tenant${n}_nationality`] = ct.nationality || '';
        values[`tenant${n}_dob`] = ct.dob || '';
        values[`tenant${n}_email`] = ct.email || '';
      });
    }

    const res = await fetch('https://api.docuseal.eu/submissions', {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCU_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_id: templateId,
        send_email: true,
        submitters: finalSubmitters,
        values
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
          audit_log_url: data.audit_log_url || null,
          signing_url: data.submitters?.[1]?.embed_src || null
        })
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: data.error || 'DocuSeal error', raw: data })
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
