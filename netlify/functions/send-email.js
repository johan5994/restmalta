const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'RestMalta <noreply@restmalta.com>';

const templates = {

  // Visit requested — to landlord
  visit_request_landlord: ({ tenantName, visitDate, visitTime, listingTitle, dashboardUrl }) => ({
    subject: `📅 New visit request — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:12px">
        <div style="background:#E05A3A;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">RestMalta</h1>
        </div>
        <div style="background:white;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1a1a1a">📅 New visit request</h2>
          <p style="color:#666">A tenant has requested a visit for your property.</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
            <p style="margin:5px 0"><strong>Property:</strong> ${listingTitle}</p>
            <p style="margin:5px 0"><strong>Tenant:</strong> ${tenantName}</p>
            <p style="margin:5px 0"><strong>Date:</strong> ${visitDate} at ${visitTime}</p>
          </div>
          <p style="color:#666">Please confirm if your property is available on this date.</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#E05A3A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
            Go to my dashboard →
          </a>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px">RestMalta — Malta's rental platform</p>
      </div>
    `
  }),

  // Visit confirmed — to tenant
  visit_confirmed_tenant: ({ tenantName, agentName, visitDate, visitTime, listingTitle, address, dashboardUrl }) => ({
    subject: `✅ Visit confirmed — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:12px">
        <div style="background:#E05A3A;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">RestMalta</h1>
        </div>
        <div style="background:white;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1a1a1a">✅ Your visit is confirmed!</h2>
          <p style="color:#666">Hi ${tenantName}, your visit has been confirmed.</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
            <p style="margin:5px 0"><strong>Property:</strong> ${listingTitle}</p>
            <p style="margin:5px 0"><strong>Address:</strong> ${address}</p>
            <p style="margin:5px 0"><strong>Date:</strong> ${visitDate} at ${visitTime}</p>
            <p style="margin:5px 0"><strong>Agent:</strong> ${agentName}</p>
          </div>
          <div style="background:#fff3cd;padding:15px;border-radius:8px;margin:20px 0;border-left:4px solid #E05A3A">
            <p style="margin:0;color:#856404"><strong>⚠️ No-show policy:</strong> If you do not attend without cancelling at least 24 hours before, a €50 fee will be charged to your registered card.</p>
          </div>
          <a href="${dashboardUrl}" style="display:inline-block;background:#E05A3A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
            Confirm my presence →
          </a>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px">RestMalta — Malta's rental platform</p>
      </div>
    `
  }),

  // Agent selected
  agent_selected: ({ agentName, visitDate, visitTime, listingTitle, address, tenantName, keyInfo, dashboardUrl }) => ({
    subject: `🎉 You are assigned to a visit — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:12px">
        <div style="background:#E05A3A;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">RestMalta</h1>
        </div>
        <div style="background:white;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1a1a1a">🎉 You are assigned to this visit!</h2>
          <p style="color:#666">Hi ${agentName}, you have been selected as the best rated available agent.</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
            <p style="margin:5px 0"><strong>Property:</strong> ${listingTitle}</p>
            <p style="margin:5px 0"><strong>Address:</strong> ${address}</p>
            <p style="margin:5px 0"><strong>Date:</strong> ${visitDate} at ${visitTime}</p>
            <p style="margin:5px 0"><strong>Tenant:</strong> ${tenantName}</p>
            <p style="margin:5px 0"><strong>Key access:</strong> ${keyInfo}</p>
          </div>
          <a href="${dashboardUrl}" style="display:inline-block;background:#E05A3A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
            View visit details →
          </a>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px">RestMalta — Malta's rental platform</p>
      </div>
    `
  }),

  // Lease signed — commission due
  commission_due: ({ name, role, amount, paymentUrl, listingTitle }) => ({
    subject: `💳 Commission due — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:12px">
        <div style="background:#E05A3A;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">RestMalta</h1>
        </div>
        <div style="background:white;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1a1a1a">Your lease has been signed! 🎉</h2>
          <p style="color:#666">Hi ${name}, the lease for ${listingTitle} has been signed by all parties.</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
            <p style="margin:5px 0"><strong>Your RestMalta commission (${role}):</strong> €${amount}</p>
            <p style="margin:5px 0;color:#666">Pay by card or SEPA bank transfer (recommended — lowest fees)</p>
          </div>
          <a href="${paymentUrl}" style="display:inline-block;background:#E05A3A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
            Pay my commission →
          </a>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px">RestMalta — Malta's rental platform</p>
      </div>
    `
  }),

  // Visit date rejected — to tenant
  visit_date_rejected: ({ tenantName, listingTitle, dashboardUrl }) => ({
    subject: `📅 Visit date not available — ${listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:20px;border-radius:12px">
        <div style="background:#E05A3A;padding:20px;border-radius:8px 8px 0 0;text-align:center">
          <h1 style="color:white;margin:0;font-size:24px">RestMalta</h1>
        </div>
        <div style="background:white;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1a1a1a">📅 Requested date not available</h2>
          <p style="color:#666">Hi ${tenantName}, unfortunately the landlord is not available on your requested date for <strong>${listingTitle}</strong>.</p>
          <p style="color:#666">The property is still available — please request a new visit with a different date.</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#E05A3A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:10px">
            Request new date →
          </a>
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:20px">RestMalta — Malta's rental platform</p>
      </div>
    `
  }),

};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  try {
    const { template, to, data } = JSON.parse(event.body);

    if (!templates[template]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown template: ' + template }) };
    }

    const { subject, html } = templates[template](data);

    const result = await resend.emails.send({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, id: result.id })
    };

  } catch (e) {
    console.error('Email error:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
