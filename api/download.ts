// /download/windows  and  /download/mac
//
// Permanent URLs that survive every version bump. The installer filename
// carries the version (Tiny-Internet-Setup-1.0.1.exe), so linking a page
// straight at an asset breaks on the next release — which is exactly what the
// old landing page would have done.
//
// Mac is served as two separate links because an unsigned universal build is
// not worth the size; see /download/mac?arch=intel.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { latestRelease, assetUrl, NoPublishedRelease } from './_github';

// Matched against asset names in order; first hit wins.
//
// The product name prefix is deliberately loose. Renaming Safe Browser to Tiny
// Internet changed every artifact filename, and a released build cannot be
// renamed after the fact — so a strict prefix would have 502'd every download
// the moment the site deployed, until a new release happened to be cut. Match
// on the shape of the artifact instead of on branding, which is the part that
// is actually stable.
const NAME = '[A-Za-z-]+';
const PATTERNS: Record<string, RegExp> = {
  windows: new RegExp(`^${NAME}-Setup-.*\\.exe$`),
  'windows-portable': new RegExp(`^${NAME}-.*-win\\.zip$`),
  mac: new RegExp(`^${NAME}-.*-arm64\\.dmg$`),
  'mac-intel': new RegExp(`^${NAME}-(?!.*arm64).*\\.dmg$`),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = Array.isArray(req.query['platform']) ? req.query['platform'][0] : req.query['platform'];
  const arch = Array.isArray(req.query['arch']) ? req.query['arch'][0] : req.query['arch'];

  let key = (raw || '').toLowerCase();
  if (key === 'mac' && arch === 'intel') key = 'mac-intel';

  const pattern = PATTERNS[key];
  if (!pattern) {
    res.status(404).send('Unknown platform. Try /download/windows or /download/mac');
    return;
  }

  try {
    const release = await latestRelease();
    const asset = release.assets.find((a) => pattern.test(a.name));
    if (!asset) {
      // A published release with no matching asset is a broken release, not a
      // broken request. Say so rather than 404ing like a bad URL.
      res.status(502).send(`No ${key} build in release ${release.tag_name}`);
      return;
    }

    // Short cache: a new release should reach people quickly, but a burst of
    // downloads should not each cost two GitHub API calls.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.redirect(302, await assetUrl(asset.id));
  } catch (err) {
    if (err instanceof NoPublishedRelease) {
      // Normal state, not a fault: the release workflow uploads to a draft and
      // a human publishes it. Say so, so this is not mistaken for an outage.
      console.warn('[download] no published release yet');
      res.status(404).send('No release has been published yet.');
      return;
    }
    console.error('[download]', err);
    res.status(503).send('Downloads are temporarily unavailable.');
  }
}
