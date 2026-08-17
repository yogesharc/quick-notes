#!/usr/bin/env bash
#
# Builds, signs, notarizes and publishes a release from this machine.
#
#   ./scripts/release.sh 0.2.0
#
# The version is written into package.json, tauri.conf.json and Cargo.toml,
# committed and tagged, then a universal macOS bundle is built and attached to a
# GitHub release along with latest.json — the manifest the app's updater reads.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <version>   e.g. $0 0.2.0" >&2
  exit 1
fi

# Homebrew and pnpm are not on a non-login shell's PATH, and this script is as
# likely to be run by an agent as by a person.
export PATH="$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"

for cmd in pnpm gh jq cargo; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

# Credentials live outside the repo's history. Everything below is checked as a
# set, so a half-filled file names all of its gaps in one run rather than one
# per attempt.
if [[ -f .env.release ]]; then
  set -a; source .env.release; set +a
fi

MISSING=()
for var in TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
           APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${!var:-}" ]] || MISSING+=("$var")
done
if (( ${#MISSING[@]} )); then
  echo "missing in .env.release: ${MISSING[*]}" >&2
  echo "see .env.release.example" >&2
  exit 1
fi

# The bundler reads the key's contents, not its path, when both are set — and
# `~` in a path never expands inside a sourced value.
TAURI_SIGNING_PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH/#\~/$HOME}"
[[ -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]] || {
  echo "signing key not found: $TAURI_SIGNING_PRIVATE_KEY_PATH" >&2; exit 1; }
export TAURI_SIGNING_PRIVATE_KEY_PATH

gh auth status >/dev/null 2>&1 || { echo "gh is not logged in — run: gh auth login" >&2; exit 1; }

# A universal bundle needs both halves; rustup only ever installs the host's.
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target list --installed | grep -qx "$target" || {
    echo "missing rust target — run: rustup target add $target" >&2; exit 1; }
done

[[ -z "$(git status --porcelain)" ]] || { echo "working tree is dirty" >&2; exit 1; }

TAG="v$VERSION"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG already exists" >&2
  exit 1
fi

echo "==> bumping to $VERSION"
jq --arg v "$VERSION" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
# Anchored to the [package] block's own key, so a dependency pinned to the same
# string is never rewritten.
/usr/bin/sed -i '' "1,/^\[/ s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
# Rewrites Cargo.lock's own record of the version, so the commit below isn't
# immediately followed by a dirty tree.
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 >/dev/null

echo "==> building universal bundle (this signs and notarizes; expect several minutes)"
pnpm tauri build --target universal-apple-darwin

APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/$(jq -r .productName src-tauri/tauri.conf.json).app"

# The bundler *warns* and carries on when notarization is rejected, so a release
# that quietly shipped unnotarized looks exactly like one that worked — until a
# user's Mac refuses to open it. `stapler validate` is what tells the two apart.
echo "==> verifying notarization"
xcrun stapler validate "$APP"
spctl --assess --verbose=2 --type exec "$APP"

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle"
UPDATER_TAR="$(ls "$BUNDLE_DIR"/macos/*.app.tar.gz)"
UPDATER_SIG="$(ls "$BUNDLE_DIR"/macos/*.app.tar.gz.sig)"
DMG="$(ls "$BUNDLE_DIR"/dmg/*.dmg)"

# The updater matches on this exact platform key for a universal build running
# on Apple silicon; x86_64 is listed too so an Intel Mac finds the same bundle.
echo "==> writing latest.json"
DOWNLOAD_URL="https://github.com/yogesharc/quick-notes/releases/download/$TAG/$(basename "$UPDATER_TAR")"
jq -n \
  --arg version "$VERSION" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg signature "$(cat "$UPDATER_SIG")" \
  --arg url "$DOWNLOAD_URL" \
  '{
    version: $version,
    pub_date: $pub_date,
    platforms: {
      "darwin-aarch64": { signature: $signature, url: $url },
      "darwin-x86_64":  { signature: $signature, url: $url }
    }
  }' > latest.json

# Committed only now: a build that fails leaves no version bump to unwind.
echo "==> tagging $TAG"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release $TAG"
git tag "$TAG"
git push origin HEAD "$TAG"

echo "==> publishing release"
gh release create "$TAG" \
  --title "$TAG" \
  --generate-notes \
  "$DMG" "$UPDATER_TAR" "$UPDATER_SIG" latest.json

rm -f latest.json

echo
echo "released $TAG"
echo "manifest: https://github.com/yogesharc/quick-notes/releases/latest/download/latest.json"
