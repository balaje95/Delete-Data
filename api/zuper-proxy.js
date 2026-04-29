/**
 * /api/zuper-proxy.js — Vercel serverless function
 *
 * Forwards browser requests to the Zuper API server-to-server, sidestepping
 * CORS issues on production regions. Whitelisted to *.zuperpro.com only.
 *
 * Client usage:
 *   fetch('/api/zuper-proxy?target=' + encodeURIComponent(zuperUrl), {
 *     method: 'GET' | 'DELETE' | ...,
 *     headers: { 'x-api-key': '...' }
 *   })
 *
 * The proxy preserves method, status, content-type, and forwards x-api-key.
 */

export default async function handler(req, res) {
  // CORS — same-origin in normal use, but be permissive for preview deploys
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Accept');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const targetUrl = req.query.target;
  if (!targetUrl || typeof targetUrl !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "target" query parameter.' });
    return;
  }

  // Security whitelist: only allow Zuper hosts
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid target URL.' });
    return;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.zuperpro.com')) {
    res.status(403).json({ error: 'Target host not allowed. Only *.zuperpro.com over HTTPS.' });
    return;
  }

  // Forward only the headers we need
  const fwdHeaders = {};
  const apiKey = req.headers['x-api-key'];
  if (apiKey) fwdHeaders['x-api-key'] = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  const ct = req.headers['content-type'];
  if (ct) fwdHeaders['content-type'] = Array.isArray(ct) ? ct[0] : ct;
  fwdHeaders['accept'] = 'application/json';

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders
      // No body forwarding — current use cases (GET list, DELETE single) don't need it
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const text = await upstream.text();

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: 'Proxy upstream failure.',
      message: String((err && err.message) || err)
    });
  }
}
