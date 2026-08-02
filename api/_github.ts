// Shared GitHub Releases lookup for the download and update endpoints.
//
// Why this exists at all: the app repo is private, so its release assets need
// an auth token. A token must never ship inside the Electron app, and a 90MB
// installer must never stream through a serverless function (Vercel caps
// response bodies well below that). So the token stays here, and we hand the
// browser a short-lived signed URL and step out of the way. No bandwidth cost,
// no token on any client.

const OWNER = process.env['GH_OWNER'] || 'nbrem108';
const REPO = process.env['GH_REPO'] || 'safe-browser';

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}

export interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

function token(): string {
  const t = process.env['GH_TOKEN'];
  if (!t) throw new Error('GH_TOKEN is not set');
  return t;
}

/**
 * The current published release. /releases/latest excludes drafts and
 * prereleases, which is the behaviour we want: the release workflow uploads to
 * a DRAFT, so nothing is downloadable until a human publishes it. That human
 * step is the release gate, and this endpoint must not route around it.
 */
export class NoPublishedRelease extends Error {}

export async function latestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tiny-internet-site',
    },
  });

  // 404 here is ambiguous and the ambiguity costs real debugging time: it means
  // either "every release is still a draft" or "the token cannot see this repo".
  // Distinguish them, because the first is a normal state waiting on a human
  // and the second is a misconfiguration.
  if (res.status === 404) {
    const probe = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, {
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tiny-internet-site',
      },
    });
    if (probe.ok) {
      throw new NoPublishedRelease('repo is visible; no published (non-draft) release yet');
    }
    throw new Error(`cannot see ${OWNER}/${REPO} with this token (status ${probe.status})`);
  }

  if (!res.ok) {
    throw new Error(`GitHub release lookup failed: ${res.status}`);
  }
  return (await res.json()) as Release;
}

/**
 * Resolves an asset to a signed, time-limited URL on GitHub's CDN.
 * Requesting an asset with Accept: octet-stream returns a 302 rather than the
 * bytes, so we read the Location and never touch the payload.
 */
export async function assetUrl(assetId: number): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${assetId}`,
    {
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'tiny-internet-site',
      },
    }
  );
  const location = res.headers.get('location');
  if (!location) {
    throw new Error(`no redirect for asset ${assetId} (status ${res.status})`);
  }
  return location;
}

/** Fetches a small asset's contents. Only for latest.yml — never for installers. */
export async function assetText(assetId: number): Promise<string> {
  const res = await fetch(await assetUrl(assetId));
  if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
  return await res.text();
}
