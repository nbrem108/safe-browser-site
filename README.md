# safe-browser-site

Landing page and distribution endpoints for Safe Browser. The app itself lives
in a separate, private repo.

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Landing page |
| `/download/windows` | 302 to the current `Safe-Browser-Setup-*.exe` |
| `/download/mac` | 302 to the current arm64 `.dmg` |
| `/download/mac?arch=intel` | 302 to the current x64 `.dmg` |
| `/updates/latest.yml` | electron-updater feed |
| `/updates/<asset>` | 302 to a named release asset |

## Why these exist

Installers live in GitHub Releases on a private repo, so reading them needs a
token. That token cannot ship inside the Electron app, and a 90 MB installer
cannot stream through a serverless function. So this holds the token, asks
GitHub for a short-lived signed URL, and redirects. No token on any client, no
bandwidth through Vercel.

Download URLs are permanent. Asset filenames carry the version, so linking a
page directly at an asset would break on every release.

`/releases/latest` excludes drafts, so nothing is downloadable until a human
publishes the draft that the app repo's release workflow creates.

## Setup

One environment variable:

```
GH_TOKEN    fine-grained PAT, read-only Contents on nbrem108/safe-browser
```

Optional: `GH_OWNER`, `GH_REPO` to point elsewhere.

Use a **fine-grained** token scoped to that one repo with read-only Contents.
Do not reuse a classic token with `repo` scope — this endpoint is public, and
the blast radius of a leak should be "someone downloads a build they could have
downloaded anyway", not "someone writes to the source".
