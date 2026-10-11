# Insight Plan website

A static site (home, features, examples, solutions, compare, pricing, documentation, resources, about, contact), generated from a few scripts. It loads nothing from other websites: the font (Open Sans) is stored in `fonts/`, so it also works offline.

## Editing
The pages are generated, so the header, footer and logo live in one place.

1. Edit the text, prices, contact address and form settings at the top and in the page sections of `build.mjs`. The documentation pages are made from the app's own help in `docs/help/*.md`.
2. Run `node website/build.mjs` (writes the `.html` files next to it).
3. Style changes go in `styles.css`. The four text sizes and the one hero size are defined at the top of it.

Preview: open `index.html`, or run `npx serve website`. (The contact form's "send" needs the Cloudflare worker, so when previewing it falls back to opening your email program.)

## Before publishing
- Confirm the `PRICING` values in `build.mjs`.
- Add real screenshots only after removing project, building and client names.
- Fill in the `SOCIAL` profile addresses in `build.mjs` (an icon appears only for the ones you set).
- Check each claim is one you stand behind (offline, no telemetry, planning tool only, what is experimental or in development).

## Publish on Cloudflare (free)
The site is a Cloudflare *Worker with static assets*: the pages are uploaded as files, and a small worker answers the contact form. (A project made by dragging a folder into the dashboard has no worker, so the form cannot send email from it. That is why this uses the command line.)

**First time only**
1. `npx wrangler login` opens a browser to sign in to Cloudflare.
2. Create a free Resend account (resend.com), add your domain, and add the DNS records it shows (see the next section). Create an API key.
3. `npx wrangler secret put RESEND_API_KEY --config website/wrangler.jsonc`, then paste the key when asked.
4. Check `website/wrangler.jsonc`: `name` is the existing Cloudflare project (keep it to update that site), and `CONTACT_TO` / `CONTACT_FROM` are your addresses. `CONTACT_FROM` must be on the domain verified in Resend.

**Every time you change the site**
1. `node website/publish.mjs` builds the pages and puts exactly what the public site needs into `website-dist/`.
2. `npx wrangler deploy --config website/wrangler.jsonc` uploads it. The site updates within seconds.

Add your own domain in the dashboard: the project > *Settings* (or *Domains*) > *Custom domains*. HTTPS is automatic.

On a company network that inspects HTTPS, wrangler fails with `SELF_SIGNED_CERT_IN_CHAIN`. The fix that keeps certificate checking on is to let Node use the Windows certificate store, which already trusts your company's certificate. In PowerShell, before running wrangler: `$env:NODE_USE_SYSTEM_CA = 1` (in Git Bash: `export NODE_USE_SYSTEM_CA=1`). Do not switch certificate checks off.

## The contact form
The form posts to `/api/contact`, which `cloudflare/worker.js` answers by emailing the message to you through Resend (free plan: 3,000 emails a month). If sending is not set up or fails, the form opens the visitor's email program with the message filled in, so no message is lost.

Resend set-up: add your domain in Resend, add the DNS records it shows in the Cloudflare DNS page for that domain, then press *Verify*. Create an API key with permission to send. After the first deploy, send a test message from the Contact page and check it arrives; replying goes to the visitor, as the worker sets *reply-to*.

Optional, to keep out bots: create a free **Turnstile** widget in Cloudflare, put its *site key* in `TURNSTILE_SITEKEY` in `build.mjs`, store its *secret key* with `npx wrangler secret put TURNSTILE_SECRET --config website/wrangler.jsonc`, then publish and deploy again. Without it, the form still has a hidden trap field that catches simple bots.

Receiving mail at your support address needs a mailbox. In Cloudflare, *Email Routing* can forward it to an inbox you already have, for free.

The security headers are in `website-dist/_headers` (written by `publish.mjs`). If you add the live chat (`CHAT_SCRIPT`), add the chat service's address to the `Content-Security-Policy` line in `publish.mjs`, or the browser will block it.

## Publish on a Synology NAS (Web Station)
The NAS can host the pages, but there is no form worker there, so the form uses the email-program fallback (it still works: the visitor's email program opens with the message ready).
1. Package Center: install **Web Station**.
2. Copy the contents of `website-dist/` (the `_headers` file does nothing on the NAS) into the shared folder `web/insightplan/`.
3. Web Station > Web Service > Create > *Static website*, document root `web/insightplan`.
4. Web Station > Web Portal > Create: point a port or a domain name at that service.
5. To reach it from the internet, use HTTPS (Control Panel > Security > Certificate, Let's Encrypt) and prefer a reverse proxy, or a Cloudflare Tunnel, over opening raw router ports.
