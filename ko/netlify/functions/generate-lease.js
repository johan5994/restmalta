exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { type, landlord, tenant, listing, start_date, end_date } = JSON.parse(event.body);

    const DOCU_KEY = process.env.DOCUSEAL_KEY;
    const DOCU_TEMPLATES = { sublet: 494242, long: 494370, short: 494242, both: 494370 };
    const templateId = DOCU_TEMPLATES[type] || DOCU_TEMPLATES.sublet;

    const res = await fetch('https://api.docuseal.eu/submissions', {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCU_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_id: templateId,
        send_email: true,
        submitters: [
          { role: 'Première partie', email: landlord.email, name: landlord.name || 'Landlord' },
          { role: 'Deuxième partie', email: tenant.email, name: tenant.name || 'Tenant' }
        ],
        values: {
          landlord_name: landlord.name || '',
          landlord_passport: landlord.passport || '',
          landlord_address: landlord.address || '',
          landlord_phone: landlord.phone || '',
          landlord_iban: landlord.iban || '',
          tenant_name: tenant.name || '',
          tenant_passport: tenant.passport || '',
          tenant_nationality: tenant.nationality || '',
          tenant_dob: tenant.dob || '',
          tenant_address: tenant.address || '',
          tenant_phone: tenant.phone || '',
          property_address: listing.address || '',
          monthly_rent: String(listing.price || ''),
          deposit: String(listing.deposit || ''),
          start_date: start_date || '',
          end_date: end_date || '',
          payment_due_day: listing.payment_due_day || '1',
          notice_period: listing.notice_period || '1 month',
          bills: listing.bills || 'excluded'
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
