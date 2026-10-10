# Insight Plan website

A small static site: Home, Features, Solutions, Pricing, Resources, Contact. No external fonts or scripts, so it also works offline.

## Editing
The pages are generated, so the header, footer and logo live in one place.

1. Edit the text, prices and contact address at the top and in the page sections of `build.mjs`.
2. Run `node website/build.mjs` (writes the six `.html` files next to it).
3. Style changes go in `styles.css`; the logo mark is in `build.mjs` (and `favicon.svg`).

Preview: open `index.html`, or run `npx serve website`.

## Before publishing
- Set `CONTACT` in `build.mjs` (it is `hello@example.com` for now).
- Confirm the `PRICING` values in `build.mjs`: they are indicative placeholders.
- Add screenshots only after removing project, building and client names.
- Check each claim is one you stand behind (offline, no telemetry, planning tool only, what is experimental or in development).

## Publish on a Synology NAS (Web Station)
1. Package Center: install **Web Station**.
2. Copy the `.html` files, `styles.css` and `favicon.svg` (not `build.mjs`) into the shared folder `web/insightplan/`.
3. Web Station > Web Service > Create > *Static website*, document root `web/insightplan`.
4. Web Station > Web Portal > Create: point a port or a domain name at that service.
5. To reach it from the internet, set up HTTPS (Control Panel > Security > Certificate, Let's Encrypt) and forward the port on your router. Prefer a reverse proxy with a domain name over opening raw ports.
