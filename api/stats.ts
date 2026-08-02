// /api/stats — how many installers have been downloaded, across every release.
//
// This is the only install-side number available without shipping telemetry into
// the app, and shipping telemetry is not on the table: the first screen of the
// app promises "no analytics and no crash reporting" and the privacy page repeats
// it. GitHub already counts asset downloads, so the count is read here, server
// side, with the same token the download endpoint uses. Nothing is added to the
// app and no visitor is tracked to produce it.
//
// What the number is NOT: a count of families. One person downloading twice
// counts twice, and on Windows the auto-updater fetches the installer for each
// version it applies, so an existing family adds to it at every release. Treat it
// as "installers served", which is what the page calls it.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const OWNER = process.env['GH_OWNER'] || 'nbrem108';
const REPO = process.env['GH_REPO'] || 'safe-browser';

// Installers only. latest.yml and .blockmap are update-channel metadata fetched
// on every launch — counting those would report launches as downloads and inflate
// the figure by orders of magnitude.
const INSTALLER = /\.(exe|dmg|zip)$/i;

interface Asset {
  name: string;
  download_count: number;
}
interface Release {
  tag_name: string;
  draft: boolean;
  assets: Asset[];
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // Fifteen minutes. The number is decorative; it does not need to be live, and
  // a cached edge response keeps a busy page off the GitHub API entirely.
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');

  try {
    const token = process.env['GH_TOKEN'];
    if (!token) throw new Error('GH_TOKEN is not set');

    const gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tiny-internet-site',
      },
    });
    if (!gh.ok) throw new Error(`GitHub releases lookup failed: ${gh.status}`);

    const releases = (await gh.json()) as Release[];
    const published = releases.filter((r) => !r.draft);

    let downloads = 0;
    for (const release of published) {
      for (const asset of release.assets) {
        if (INSTALLER.test(asset.name)) downloads += asset.download_count;
      }
    }

    res.status(200).json({
      downloads,
      releases: published.length,
      latest: published[0]?.tag_name ?? null,
    });
  } catch (err) {
    // A missing token or an unpublished repo is the normal state right now, and
    // it must not put an error on the landing page. Answer 200 with a null count
    // so the page simply leaves the counter out.
    console.warn('[stats]', err);
    res.status(200).json({ downloads: null, releases: 0, latest: null });
  }
}
