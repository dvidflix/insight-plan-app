// Cloudflare Pages "advanced mode" worker: serves the static site and receives the contact form at /api/contact.
// Uploaded as _worker.js at the top of the published folder (website/publish.mjs puts it there), so it also works with a drag-and-drop upload.
//
// Settings, in the Pages project (Settings > Variables and secrets):
//   RESEND_API_KEY   secret   an API key from resend.com (free plan: 3,000 emails a month)
//   CONTACT_TO       text     the inbox that receives the messages, e.g. support@insight-plan.com
//   CONTACT_FROM     text     a sender on a domain verified in Resend, e.g. "Insight Plan website <forms@insight-plan.com>"
//   TURNSTILE_SECRET secret   optional: the secret key of a Cloudflare Turnstile widget (the site key goes in website/build.mjs)

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'",
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
/** Plain text with the control characters taken out (so a name or subject cannot add mail headers), cut to a length. */
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (value, max) => clean(value, max).replace(/\s+/g, ' ');

export async function handleContact(request, env) {
  // Only the site itself may post here.
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Not allowed.' }, 403);

  let d;
  try { d = await request.json(); } catch { return json({ error: 'The message could not be read.' }, 400); }
  if (d.website) return json({ ok: true }); // the hidden field was filled in: a bot. Say nothing.

  const f = {
    name: oneLine(d.name, 120), email: oneLine(d.email, 200), company: oneLine(d.company, 160), role: oneLine(d.role, 160),
    interest: oneLine(d.interest, 120), users: oneLine(d.users, 40), formats: oneLine(d.formats, 200), data: oneLine(d.data, 300), message: clean(d.message, 5000),
  };
  if (!f.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || !f.message) return json({ error: 'Please give your name, a valid email and a message.' }, 400);

  if (env.TURNSTILE_SECRET) {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(d['cf-turnstile-response'] ?? '') });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) body.set('remoteip', ip);
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!check.success) return json({ error: 'The check that you are not a robot did not pass. Please try again.' }, 403);
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) return json({ error: 'The form is not set up yet.' }, 503);

  const text = [
    `Name: ${f.name}`, `Email: ${f.email}`, `Company: ${f.company}`, `Role: ${f.role}`, `Interested in: ${f.interest}`, `Users: ${f.users}`,
    `Formats: ${f.formats}`, `Data handling: ${f.data}`, '', f.message,
  ].join('\n');
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: f.email, subject: `Insight Plan website: ${f.interest || 'message'} (${f.name})`, text }),
  }).catch(() => null);
  if (!sent || !sent.ok) return json({ error: 'The message could not be sent.' }, 502);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return handleContact(request, env);
    }
    // Everything else is the static site, with the security headers added.
    const response = await env.ASSETS.fetch(request);
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
