exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
  body: JSON.stringify({ docuseal_key: process.env.DOCUSEAL_API_KEY || null })
});
