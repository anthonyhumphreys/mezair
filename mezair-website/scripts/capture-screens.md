# Screenshot capture guide

Maintainer instructions for refreshing the website assets. This guide is kept
in the repository and is not part of the public documentation.

Every product image on mezair.dev is a screenshot of Mezair Desktop with sample data. The website draws none of them. The animations on the [Sync & Mesh page](/sync) are diagrams, and the page labels them that way.

## Sources

Captures come from three places, all in `mezair-app`:

| Source | What it renders | Used for |
| --- | --- | --- |
| **Desktop** | The Electron app on an isolated profile, with the development-only processing fixture at `/_dev/processing`. Real shell, preload and transcript components. | The finished run and its expanded steps. |
| **Replay harness** | The standalone Vite preview in `src/renderer/components/chat/replay/`. Production components with an in-memory bridge; no Electron, IPC, provider or backend. | Factories, workflows, Sync & Mesh settings, Mesh jobs, session ownership and inline review surfaces. |
| **ChatView probe** | `scripts/chat-review-fixture/` served by `pnpm exec vite --config scripts/chat-review.vite.config.ts --host 127.0.0.1 --port 4180`. The production `ChatView` (thread rail, transcript, composer) with injected synthetic chat contexts and an inert bridge. | Agents at work (`agents-at-work.html`; `?picker` opens the model picker). |

The source code labels all fixture content as synthetic. The Acme workspace, its `storefront` repository, Dana's devices and every job, commit and finding are invented. No agent, provider, GitHub account or Sync backend is contacted while capturing.

`public/screens/manifest.json` records each image's source route, fixture, pixel size, app commit and capture date. The website reads its sizes from there, so images never shift the layout while loading.

## Homepage captures

The homepage hero uses `agents-at-work`: the production `ChatView` from the ChatView probe in `mezair-app/scripts/chat-review-fixture/` (`agents-at-work.html?picker`), with five synthetic Acme threads and the open model picker. Phones get `agents-at-work-rail`, a crop of the same image. Refresh it with `node scripts/capture-screens.mjs agents-at-work` while the probe is served on port 4180; the derived crops (`agents-at-work-picker`, `agents-at-work-rail`, `surface-findings-mobile`, `factories-line-mobile`) are re-cut automatically when their source is recaptured.

The older `retry-workflow` captures are no longer used on the homepage. A manifest entry with `appWorkingTree: true` was captured from uncommitted source on top of `appCommit`; that commit alone does not reproduce the image.

## Companion captures

`companion-home`, in the "Set them off. Walk away." section, is the real Mezair Companion iPhone app (`mezair-app/mobile`) running in the iOS simulator. It isn't produced by `capture-screens.mjs`: its manifest entry has `source: "simulator"`, and full runs keep it.

1. Build and install a development build once: `pnpm --dir mobile exec expo run:ios` from `mezair-app`.
2. Serve it with the synthetic host. `mobile/lib/sample-host.ts` pairs a fake "Dana's MacBook Pro" and answers its companion routes. It only loads in development builds.

   ```bash
   cd mezair-app/mobile
   EXPO_PUBLIC_MEZAIR_SAMPLE_DATA=1 pnpm exec expo start --port 8081 --clear
   ```

3. Fix the status bar and relaunch the app:

   ```bash
   xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
   xcrun simctl launch booted dev.anthonyhumphreys.mezair.app.companion
   ```

4. Screenshot the Home tab and crop it above the floating tab bar:

   ```bash
   xcrun simctl io booted screenshot /tmp/companion-home.png
   cwebp -q 86 -crop 0 0 1206 1940 /tmp/companion-home.png -o public/screens/companion-home.webp
   ```

To reach another tab, send `xcrun simctl openurl booted mezair-companion:///approvals`. The simulator asks before opening the link, so press Open in DeviceHub.

## Refresh the captures

1. Start the replay harness from `mezair-app`:

   ```bash
   pnpm exec vite --config scripts/chat-replay.vite.config.ts
   ```

2. Start Desktop on a throwaway profile with remote debugging:

   ```bash
   MEZAIR_DEV_USER_DATA_PATH=/tmp/mezair-capture \
   MEZAIR_DEV_PROCESSING_PREVIEW=1 \
     pnpm dev -- --remote-debugging-port=9333
   ```

   If your shell sets `ELECTRON_RUN_AS_NODE`, unset it first. Finish the welcome flow with **Continue without Sync**, set the theme to Dark, and add a fixture workspace named Acme with a small local repository that has at least one commit.

   Website examples use `gpt-6.1-sol` with `xhigh` reasoning (shown as **Extra high** in the composer). Keep the processing, factory, Mesh and chat replay fixtures consistent when refreshing the captures.

3. Capture from `mezair-website`:

   ```bash
   node scripts/capture-screens.mjs            # everything
   node scripts/capture-screens.mjs mesh-jobs  # just one
   ```

The script uses Chrome through the DevTools protocol with no extra dependencies, writes 2× WebP files to `public/screens/` (PNG if `cwebp` is missing), and rewrites the manifest. Set `CHROME_PATH`, `MEZAIR_REPLAY_URL`, `MEZAIR_PROBE_URL` or `MEZAIR_DESKTOP_CDP` if your setup differs. Development-only fixture controls are hidden during capture; nothing else is changed.

Refresh the matching JPEG copies in `app/_og/assets/` too: desktop, desktop steps and factories at 1400 px wide; Mesh jobs and review at 1100 px wide. Preserve their aspect ratio and update the social-card image dimensions if a capture's shape changes.

## Add a capture

Add an entry to the `captures` list in `scripts/capture-screens.mjs` with its source, route, viewport and, for panels, the element to clip. Then add its alt text and caption to `lib/screens.ts`. Write alt text that describes what the screen shows for someone who can't see it.

Derived crops (the `crops` list in the script) are cut with `cwebp -crop` from an already captured file after the captures run, so refreshing a source also recuts its crops; their manifest entries record `source: "crop"`, `cropOf`, the `box` in source pixels, and the source's commit and capture date.

If a screen needs data no fixture provides, add it to a replay fixture in `mezair-app` rather than editing the image. The `?mesh` fixture in `MeshPreview.tsx` is a small example: it installs a typed in-memory bridge and renders the production settings components against it.
