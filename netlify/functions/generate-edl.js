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
      landlord, tenant, listing,
      meter_water, meter_electricity,
      rooms = [], // [{ name, items: [{item, qty, condition_arrival, notes}] }]
      general_notes,
      phase = 'arrival' // 'arrival' ou 'departure'
    } = JSON.parse(event.body);

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const phaseLabel = phase === 'departure' ? 'upon Departure' : 'on Arrival';

    // Sections officielle de l'inventaire maltais
    const officialSections = [
      {
        name: 'Exterior Items',
        items: ['Mailbox','Fences & Gates','Pool/Spa & Equip','Lawn, Trees & Shrubs','Roof','Water tank','Photovoltaic panels','Garage','Bicycle storage','Bins/Waste','Other exterior']
      },
      {
        name: 'Common Areas / Entrance',
        items: ['Main door','Letterbox','Lift/Elevator','Staircase','Corridor/Hallway','Security system','Other common areas']
      },
      {
        name: 'Living Room / Dining Room',
        items: ['Sofa / Armchairs','Coffee table','Dining table','Dining chairs','TV / TV unit','Curtains / Blinds','Rug / Carpet','Bookshelf','Artwork','Air conditioning unit','Lights / Fixtures','Walls & Ceiling','Floor','Windows & Doors']
      },
      {
        name: 'Kitchen',
        items: ['Kitchen cabinets','Worktop','Sink & Taps','Oven / Stove','Microwave','Refrigerator / Freezer','Dishwasher','Washing machine','Dryer','Extractor fan','Kettle / Toaster','Other appliances','Floor','Walls & Tiles']
      },
      {
        name: 'Master Bedroom',
        items: ['Bed frame & Mattress','Wardrobe / Closet','Bedside tables','Chest of drawers','Desk / Chair','Curtains / Blinds','Mirror','Lights','Walls & Ceiling','Floor','Windows & Door']
      },
      {
        name: 'Bedroom 2',
        items: ['Bed frame & Mattress','Wardrobe','Furniture','Curtains','Lights','Walls & Ceiling','Floor','Windows & Door']
      },
      {
        name: 'Bedroom 3',
        items: ['Bed frame & Mattress','Wardrobe','Furniture','Curtains','Lights','Walls & Ceiling','Floor','Windows & Door']
      },
      {
        name: 'Bathroom / WC',
        items: ['Bath / Shower enclosure','WC / Toilet','Sink & Taps','Mirror / Cabinet','Towel rails','Tiles / Walls','Floor','Ventilation','Lights']
      },
      {
        name: 'Bathroom 2 (if applicable)',
        items: ['Bath / Shower','WC / Toilet','Sink & Taps','Tiles / Walls','Floor','Lights']
      },
      {
        name: 'Balcony / Terrace',
        items: ['Garden furniture','Plant pots','BBQ / Grill','Outdoor lighting','Floor / Tiles','Railings']
      },
      {
        name: 'Storage / Utility Room',
        items: ['Water heater / Boiler','Electrical panel / Fuse box','Storage shelving','Other items']
      },
      {
        name: 'Keys & Access',
        items: ['Main door keys','Mailbox key','Garage remote / key','Other keys / access cards']
      }
    ];

    // Fusionner avec les rooms fournis par l'agent
    const mergeRooms = (official, provided) => {
      return official.map(sec => {
        const found = provided.find(r => r.name === sec.name);
        return {
          name: sec.name,
          items: sec.items.map(itemName => {
            const found_item = found?.items?.find(i => i.item === itemName);
            return {
              item: itemName,
              qty: found_item?.qty || '',
              condition: found_item?.condition_arrival || '',
              notes: found_item?.notes || ''
            };
          })
        };
      });
    };

    const allRooms = mergeRooms(officialSections, rooms);

    const renderTable = (section) => `
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
      </table>`;

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
  </table>
</div>

${allRooms.map(renderTable).join('')}

${general_notes ? `
<div style="margin-top:15px;background:#fff9db;border:1px solid #f6d860;border-radius:5px;padding:10px">
  <strong>📝 General Observations / Additional Notes:</strong>
  <p>${general_notes}</p>
</div>` : ''}

<div class="sig-block">
  <div class="sig-box">
    <p><strong>LESSOR (Landlord)</strong></p>
    <p>${landlord?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:8pt;color:#666">Signature &amp; Date</p>
  </div>
  <div class="sig-box">
    <p><strong>LESSEE (Tenant)</strong></p>
    <p>${tenant?.name || '_______________'}</p>
    <div class="sig-line"></div>
    <p style="font-size:8pt;color:#666">Signature &amp; Date</p>
  </div>
</div>

</body>
</html>`;

    // Envoyer à DocuSeal
    const res = await fetch(DOCU_URL, {
      method: 'POST',
      headers: { 'X-Auth-Token': DOCU_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        send_email: true,
        submitters: [
          { role: 'Lessor', email: landlord?.email, name: landlord?.name || 'Landlord' },
          { role: 'Lessee', email: tenant?.email, name: tenant?.name || 'Tenant' }
        ],
        message: {
          subject: `Property Inventory & Condition Form — ${listing?.address || 'Malta'} — Please sign`,
          body: `Please find attached the property inventory and condition form for ${listing?.address || 'the property'}. Please review and sign at your earliest convenience.`
        }
      })
    });

    const data = await res.json();
    const submissionId = data.id || data[0]?.id;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, submission_id: submissionId })
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
