# Quick task 260913-rp5 (option 2 split) — why the source repo and the
# releases repo are now separate.
#
# The release flow has three actors:
#
#   1. Colonoscopist (private source) — full code + tests + this doc.
#   2. electron-builder @ Windows CI runner — packs out/ into NSIS +
#      portable exes, generates latest.yml (the manifest electron-updater
#      polls at runtime to detect a new release).
#   3. colonoscopist-releases (PUBLIC, no code) — receives the
#      installer artifacts + latest.yml. electron-updater downloads from
#      here at the user's installed workstation.
#
# The split keeps the source code private while letting the auto-updater
# reach end users. A single-token GH Actions workflow in
# .github/workflows/release.yml does the cross-repo publish; the
# `RELEASE_TOKEN` repo secret must be a PAT scoped to the releases
# repo (cross-repo publish isn't possible from the default GITHUB_TOKEN).
#
# Manual runbook:
#
#   # local — package without publishing
#   npm run package          # NSIS only
#   npm run package:portable # portable only
#   npm run publish:dry      # build + publish dry-run (no upload)
#
#   # release via CI (recommended)
#   git tag v0.1.3            # bump version in package.json first
#   git push origin v0.1.3
#   # .github/workflows/release.yml fires; results land in
#   # https://github.com/hussienessam04/colonoscopist-releases/releases
#
#   # ad-hoc rebuild via Actions → Run workflow → optional tag input
#
# Manual download (no CI):
#   1. electron-builder build auto-generates `dist/latest.yml` alongside
#      the installer.
#   2. Upload the `dist/*.exe` + `dist/latest.yml` + `dist/*.blockmap` to
#      the colonoscopist-releases repo's Releases page manually.
