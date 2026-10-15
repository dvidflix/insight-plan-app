# Updates for the packaged app

The packaged app (the zip with `Start Insight Plan.cmd`) updates itself from a small web location you control. Nothing about the
user's projects is touched: an update replaces only `dist`, `server-dist`, `scenario-engine` and `docs`.

## How it works for the user
1. The app looks for a new version a few seconds after starting, then every four hours.
2. A newer version is downloaded in the background, checked, and unpacked into `updates/staged`.
3. **Update available** appears in the top bar (the menu at the bottom of the workspace picker) with the release notes.
4. **Restart and update** installs it in about 10 seconds and reloads the page. Or do nothing: `Start Insight Plan.cmd` installs a
   staged update every time it starts.
5. The previous version stays in `updates/backup` until the next update.

If the update needs a newer runtime (Node or Python changed), the user is told to ask for the full package instead.

## Publishing an update
1. Raise the version in `package.json` (`0.1.1`, `0.1.2`, ...). Raise `RUNTIME_LEVEL` in `scripts/package.mjs` only when the
   Node or Python runtime changed.
2. `npm run package` (needs `NODE_OPTIONS=--use-system-ca` on a network that inspects TLS).
3. `npm run release -- --notes "What changed" --notes "Another change"` writes `release/update/`:
   - `InsightPlan-app-<version>.zip`: the app only (a few MB).
   - `latest.json`: version, notes, the zip's SHA-256, signed with `tools/licence-private.jwk`.
4. Upload both to the update location, **the zip first, `latest.json` last**.

Only the holder of `tools/licence-private.jwk` can publish an update: the app ignores a `latest.json` whose signature does not
verify, and discards a zip whose SHA-256 differs from the signed one. Keep that key backed up and private (it is also the licence key).

## Pointing an install at the update location
Either of these (the first wins):
- environment variable `INSIGHT_UPDATE_URL` (and optionally `INSIGHT_UPDATE_TOKEN`) when running `npm run package`: it writes `update.json` into the package;
- or put `update.json` next to `Start Insight Plan.cmd`:

```json
{ "manifest": "https://<account>.blob.core.windows.net/updates/latest.json", "token": "sv=...&sig=..." }
```

`token` is optional: if set, it is added to every request as a query string (an Azure Blob SAS token). The address must be https
(or localhost, for testing).

## Where to host it
Any static https location works. Azure Blob Storage (UK South) costs about £1 a month:
1. Storage account, a container `updates`.
2. For a closed pilot keep the container **private** and give installs a read-only SAS token for it (`token` above); to cut a
   person off, rotate the token. For an open one, allow anonymous read: the files are signed, so reading them is harmless.
3. Upload: `az storage blob upload-batch -d updates -s release/update --account-name <account>` (upload `latest.json` last).

## Testing an update locally
Serve `release/update` with `python -m http.server 8099 --bind 127.0.0.1`, set `update.json` to
`{ "manifest": "http://127.0.0.1:8099/latest.json" }`, and set `INSIGHT_NO_BROWSER=1` to start without opening a window.

## Code
- `server/packageUpdater.ts`: check, download, verify, stage; `/api/app/version` and `/api/app/update`.
- `scripts/Start Insight Plan.cmd`: installs the staged update at start, and restarts when the server exits with code 75.
- `scripts/release.mjs`: builds and signs the update.
- `src/components/PackageUpdateChip.tsx`: the top-bar chip.
