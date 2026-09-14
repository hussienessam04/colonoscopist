# Release Pipeline

**Quick task 260913-rp5 — option 2: source-private + releases-public split.**

This repo's source stays **private**. End-user installer artifacts and
the `latest.yml` manifest electron-updater polls at runtime live in a
separate public repo (`hussienessam04/colonoscopist-releases`).

## Why split

- Clinic operators never need to clone or read source code.
- The releases repo can be `public` (electron-updater needs to fetch
  `latest.yml` anonymously at runtime) without leaking the codebase.
- License files / Ed25519 secret material stays in the private repo.

## How to ship a release

1. Bump `package.json#version` (e.g. `0.1.3` → `0.1.4`).
2. Commit + push to `main` on the source repo.
3. Tag and push:
   ```bash
   git tag v0.1.4
   git push origin v0.1.4
   ```
4. `.github/workflows/release.yml` triggers on tag push. It:
   - Builds NSIS + portable on `windows-latest`
   - Runs `electron-builder --publish never` so the build doesn't try
     to publish via the default `GITHUB_TOKEN` (which can only write
     to the source repo, not the cross-repo releases destination).
   - Uploads assets via `gh release` to `colonoscopist-releases` using
     a cross-repo PAT stored as `RELEASE_TOKEN`.
5. Verify at https://github.com/hussienessam04/colonoscopist-releases/releases

## Setup (already done)

The pipeline is one-shot configured:

| Step | Status |
|------|--------|
| `hussienessam04/colonoscopist-releases` public repo | Created via `gh repo create --public --source=.` |
| PAT with `repo` scope on `hussienessam04` | Stored as `RELEASE_TOKEN` secret in source repo via `gh secret set` |
| `package.json#build.publish.repo` | `colonoscopist-releases` |
| `package.json#build.win.artifactName` | `${productName}-Setup-${version}.${ext}` (dashes; see below) |
| `package.json#build.portable.artifactName` | `${productName}-${version}.${ext}` |
| `.github/workflows/release.yml` | Wired to build on `v*` tag push |

## File-name gotcha (and why `artifactName` is pinned)

`gh release upload` silently replaces **spaces** in asset names with
**dots**. electron-builder's `latest.yml` keeps the original spaces
(turned into dashes per its default name template), so without an
explicit `artifactName` the names don't match and `electron-updater`
404s at runtime.

Pin both:

```jsonc
"win":      { "artifactName": "${productName}-Setup-${version}.${ext}" },
"portable": { "artifactName": "${productName}-${version}.${ext}" }
```

Result: `Colonoscopist-Setup-0.1.3.exe` + `Colonoscopist-0.1.3.exe`,
both uploadable and both referenced in `latest.yml` — agree, update
works.

## Bash gotchas on `windows-latest`

Git Bash on the runner is dash-flavored, so two things bit:

1. `${VAR:-default}` is bash-4 syntax — fails with `bad substitution`.
   Use POSIX `[ -n "$VAR" ]` instead.
2. The default shell on `windows-latest` is **PowerShell**, not bash.
   Every step with bash syntax (arrays, `set -euo pipefail`,
   `[[ ... ]]`) needs an explicit `shell: bash` or it'll fail with
   `ParserError: Missing '(' after 'if'`.
3. `${{ ... }}` expressions embedded inside a multi-line bash `run:`
   can be silently stripped to empty on this image — they look like
   `TAG=".tag"` in the rendered command. Route values through the
   step's `env:` block so they land as ordinary shell variables.

## Why not `samuelmeuli/action-electron-builder` or
`softprops/action-gh-release`?

Neither action supports a cross-repo publish — both honor
`GITHUB_REPOSITORY` only, so assets land on the source repo, not the
cross-repo releases destination. Using the `gh` CLI directly with
`GH_TOKEN=${{ secrets.RELEASE_TOKEN }}` is the simplest portable path.

## Local dry-run

```bash
npm run build:installers   # builds to ./dist without publishing
# or
npm run package              # NSIS only
npm run package:portable     # portable only
```

To actually publish from a workstation:

```bash
GH_TOKEN=<your-PAT> gh release create v0.1.3 \
  --repo hussienessam04/colonoscopist-releases \
  --title "Colonoscopist v0.1.3" \
  --notes "..." \
  dist/*.exe dist/*.exe.blockmap dist/latest*.yml
```

## References

- Workflow: `.github/workflows/release.yml`
- electron-builder publish docs: https://www.electron.build/configuration/publish
- electron-updater GitHub provider: https://www.electron.build/auto-update#github
