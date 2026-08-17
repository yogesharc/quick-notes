# Quick Notes

A small always-on-top notes overlay for macOS. Tauri + React + TypeScript.

```sh
pnpm install
pnpm tauri dev
```

## Releasing

Releases are cut from this machine — there is no CI.

One-time setup: copy `.env.release.example` to `.env.release` and fill in your
Apple ID and an [app-specific password](https://appleid.apple.com). The updater
signing key lives at `~/.tauri/quick-notes.key`; its public half is in
`src-tauri/tauri.conf.json`. **Losing that key means no existing install can
ever be updated again** — back it up somewhere durable.

```sh
./scripts/release.sh 0.2.0
```

That bumps the version in `package.json`, `tauri.conf.json` and `Cargo.toml`,
builds a signed and notarized universal bundle, tags the commit, and publishes a
GitHub release carrying the DMG, the updater bundle, and `latest.json`.

Installed apps read that manifest from
`releases/latest/download/latest.json` on launch and every six hours, download
anything newer in the background, and offer a **Restart to update** bar along
the bottom of the window once the bundle is ready.
