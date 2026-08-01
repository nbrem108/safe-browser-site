// /updates/<file>  — the electron-updater feed (D-02).
//
// The app uses electron-builder's "generic" provider pointed at this path
// rather than its GitHub provider. That is deliberate: the GitHub provider
// would need a token to read a private repo, and a shipped app must never
// carry one. Pointing at our own domain also means the update channel survives
// the repo going public, private, or moving entirely.
//
// electron-updater asks for latest.yml, reads the filename inside it, then
// asks for that file. Both requests land here.
//
// TRUST MODEL — read before assuming this is a secure channel. Windows builds
// are unsigned, so nothing verifies a code signature on the downloaded update.
// What is verified is the sha512 recorded in latest.yml. Since this endpoint
// serves BOTH latest.yml and the installer, anyone who can compromise this
// deployment or the GitHub account can serve a matched pair and the client
// will accept it. The anchor is TLS plus account security, not a certificate
// we hold. That is why D-02 stays open in the app repo's PARKING-LOT.md.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { latestRelease, assetUrl, assetText } from './_github';

// latest.yml is small and must be served as bytes, not a redirect —
// electron-updater parses the body. Everything else is a redirect.
const INLINE = /\.yml$/;

// Refuse anything that is not a release artifact name. Keeps this from being a
// general-purpose reader of the repo's release assets.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = Array.isArray(req.query['file']) ? req.query['file'][0] : req.query['file'];
  const name = raw || '';

  if (!name || !SAFE_NAME.test(name)) {
    res.status(400).send('bad request');
    return;
  }

  try {
    const release = await latestRelease();
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) {
      // 404 is meaningful to electron-updater: it means "no update here" and
      // the client goes quiet, which is the correct behaviour for a platform
      // we do not publish a feed for (macOS, until signing lands).
      res.status(404).send('not found');
      return;
    }

    if (INLINE.test(name)) {
      const body = await assetText(asset.id);
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      res.status(200).send(body);
      return;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.redirect(302, await assetUrl(asset.id));
  } catch (err) {
    console.error('[updates]', err);
    // 503 rather than 500: electron-updater treats this as transient and simply
    // tries again next launch, which is what we want. A child sees nothing.
    res.status(503).send('unavailable');
  }
}
