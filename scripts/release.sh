#!/usr/bin/env bash
#
# Builds, signs, notarizes and publishes a release from this machine.
#
#   ./scripts/release.sh patch     # 0.1.0 -> 0.1.1
#   ./scripts/release.sh minor     # 0.1.0 -> 0.2.0
#   ./scripts/release.sh major     # 0.1.0 -> 1.0.0
#   ./scripts/release.sh 0.2.0     # or say it outright
#
# The version is written into package.json, tauri.conf.json and Cargo.toml,
# committed and tagged, then a universal macOS bundle is built and attached to a
# GitHub release along with latest.json — the manifest the app's updater reads.

set -euo pipefail

cd "$(dirname "$0")/.."

# Homebrew and pnpm are not on a non-login shell's PATH, and this script is as
# likely to be run by an agent as by a person.
export PATH="$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:$PATH"

for cmd in pnpm gh jq cargo; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 1; }
done

usage() {
  echo "usage: $0 <patch|minor|major|x.y.z>" >&2
  exit 1
}

# tauri.conf.json is the one the manifest and the bundle are both built from, so
# it is what a bump counts from — the other two files follow it.
CURRENT="$(jq -r .version src-tauri/tauri.conf.json)"
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "tauri.conf.json has a version this script can't bump: $CURRENT" >&2; exit 1; }
IFS=. read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "${1:-}" in
  patch) VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  major) VERSION="$((MAJOR + 1)).0.0" ;;
  *.*.*) VERSION="$1"; [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage ;;
  *)     usage ;;
esac

echo "==> $CURRENT -> $VERSION"

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

# `~` never expands inside a sourced value.
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH/#\~/$HOME}"
[[ -f "$KEY_PATH" ]] || { echo "signing key not found: $KEY_PATH" >&2; exit 1; }

# The bundler prefers TAURI_SIGNING_PRIVATE_KEY — the key's *contents* — over
# the _PATH form, and takes it from the ambient environment. A key exported by
# ~/.zshrc for some other app therefore wins over this repo's, and the mismatch
# surfaces only at the very last step of the build, as "wrong password for that
# key". Read the file here and set the variable the bundler actually reads,
# clearing the one it would ignore, so .env.release is the only thing that
# decides which key signs this app.
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
unset TAURI_SIGNING_PRIVATE_KEY_PATH

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

echo "==> writing version"
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
UPDATER_SIG="$(ls "$BUNDLE_DIR"/macos/*.app.tar.gz.sig)"

# The app verifies each update against the pubkey compiled into it, so a bundle
# signed by any other key is refused at runtime — and because the refusal
# happens on the user's machine, a wrongly-signed release silently ends updates
# for every existing install with no way to push a correction. The bundler only
# *warns* about this, and an ambient TAURI_SIGNING_PRIVATE_KEY left over in a
# shell is enough to cause it, so it is checked here rather than trusted.
#
# Both blobs are base64 files whose second line is itself base64; bytes 2..10 of
# that inner payload are minisign's key id, which is what has to agree.
echo "==> verifying updater signature key"
key_id() { base64 -d 2>/dev/null | sed -n '2p' | base64 -d 2>/dev/null | od -An -tx1 -j2 -N8 | tr -d ' \n'; }
CONF_KEY_ID="$(jq -r '.plugins.updater.pubkey' src-tauri/tauri.conf.json | key_id)"
SIG_KEY_ID="$(key_id < "$UPDATER_SIG")"
if [ -z "$CONF_KEY_ID" ] || [ "$SIG_KEY_ID" != "$CONF_KEY_ID" ]; then
  echo "updater signature was made with the wrong key — refusing to publish" >&2
  echo "  tauri.conf.json pubkey : ${CONF_KEY_ID:-<unreadable>}" >&2
  echo "  signing key used       : ${SIG_KEY_ID:-<unreadable>}" >&2
  echo "check TAURI_SIGNING_PRIVATE_KEY_PATH in .env.release, and make sure no" >&2
  echo "stale TAURI_SIGNING_PRIVATE_KEY is exported in this shell." >&2
  exit 1
fi

# The bundle is named after `productName`, which has a space in it — and GitHub
# rewrites spaces in release asset names to dots on upload. The manifest URL is
# written here, before the upload that would rename the file underneath it, so
# the artifacts are staged under names GitHub will leave alone.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
UPDATER_TAR="$STAGE/quick-notes-$VERSION-universal.app.tar.gz"
DMG="$STAGE/quick-notes-$VERSION-universal.dmg"
cp "$(ls "$BUNDLE_DIR"/macos/*.app.tar.gz)" "$UPDATER_TAR"
cp "$(ls "$BUNDLE_DIR"/dmg/*.dmg)" "$DMG"

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
  }' > "$STAGE/latest.json"

# Committed only now, so a failed build publishes no tag and no release. It does
# leave the bump sitting in the working tree — `git checkout` the four version
# files to undo it before trying again.
echo "==> tagging $TAG"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release $TAG"
git tag "$TAG"
git push origin HEAD "$TAG"

# The .sig is not uploaded: latest.json carries the signature inline, and that
# is the only copy the updater ever reads.
echo "==> publishing release"
gh release create "$TAG" \
  --title "$TAG" \
  --generate-notes \
  "$DMG" "$UPDATER_TAR" "$STAGE/latest.json"

echo
echo "released $TAG"
echo "manifest: https://github.com/yogesharc/quick-notes/releases/latest/download/latest.json"
