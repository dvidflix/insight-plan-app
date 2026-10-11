import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error the worker is plain JavaScript that Cloudflare runs; it has no type declarations
import worker, { handleContact } from '../../website/cloudflare/worker.js';

const env = { RESEND_API_KEY: 're_test', CONTACT_TO: 'support@insight-plan.com', CONTACT_FROM: 'Insight Plan website <forms@insight-plan.com>' };
const good = { name: 'Ada Planner', email: 'ada@example.com', company: 'Acme', role: 'Planner', interest: 'A free trial', users: '2 to 4', formats: 'XER, IFC', data: '', message: 'Hello' };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://insight-plan.com/api/contact', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

afterEach(() => vi.unstubAllGlobals());

describe('contact form worker', () => {
  it('sends a good message through Resend, replying to the visitor', async () => {
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', send);
    const res = await handleContact(post(good), env);
    expect(res.status).toBe(200);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const mail = JSON.parse(init.body);
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(mail).toMatchObject({ from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: 'ada@example.com' });
    expect(mail.subject).toContain('A free trial');
    expect(mail.text).toContain('Hello');
  });

  it('rejects a missing name, a bad email or an empty message, without sending', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    for (const bad of [{ ...good, name: '' }, { ...good, email: 'nope' }, { ...good, message: '  ' }]) {
      expect((await handleContact(post(bad), env)).status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('pretends to accept a bot that filled the hidden field, but sends nothing', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const res = await handleContact(post({ ...good, website: 'http://spam' }), env);
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps line breaks out of the subject', async () => {
    const send = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', send);
    await handleContact(post({ ...good, name: 'Eve\r\nBcc: victim@example.com' }), env);
    expect(JSON.parse(send.mock.calls[0][1].body).subject).not.toMatch(/[\r\n]/);
  });

  it('refuses a post from another website', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await handleContact(post(good, { Origin: 'https://evil.example' }), env)).status).toBe(403);
  });

  it('says so when it is not set up, and when Resend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    expect((await handleContact(post(good), {})).status).toBe(503);
    expect((await handleContact(post(good), env)).status).toBe(502);
  });

  it('checks Turnstile when a secret is set', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => (url.includes('turnstile') ? new Response(JSON.stringify({ success: false })) : new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    expect((await handleContact(post(good), { ...env, TURNSTILE_SECRET: 's' })).status).toBe(403);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('api.resend.com'))).toBe(false);
  });

  it('serves the static site with security headers, and only accepts POST on the API', async () => {
    const assets = { fetch: vi.fn().mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } })) };
    const page = await worker.fetch(new Request('https://insight-plan.com/pricing.html'), { ...env, ASSETS: assets });
    expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(await page.text()).toBe('<html></html>');
    const get = await worker.fetch(new Request('https://insight-plan.com/api/contact'), { ...env, ASSETS: assets });
    expect(get.status).toBe(405);
  });
});
