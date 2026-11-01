---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/sync/page.tsx","app/pricing/page.tsx","app/what-does-mezair-mean/page.tsx"]
---

# Marketing surfaces: /, /sync, /pricing

Mode: Persuade. Docs, account, workspace, auth and artifact routes are out of scope and keep the light/dark docs world.

## Audience, job, actions
- Developer or tech lead deciding whether to try Mezair Desktop today, and whether hosted Sync is worth requesting.
- Actions: Download for Mac (unsigned; install guide), Windows/Linux releases, view MIT source, request hosted Sync beta (invite-only until full public launch), redeem beta code, self-host Sync, read docs.
- Proof: real captures of Mezair Desktop with synthetic fixture content (Electron shell and the mezair-app replay harness; provenance in `public/screens/manifest.json`), plus labelled motion diagrams of Sync & Mesh whose states and ordering follow `cloud/contract`.

## Direction contract
THESIS: Show one complete task clearly. The homepage pairs a short introduction with request → work → review and one readable production transcript capture. Preserve the dark palette, typography and mark; remove the screenshot tour and repeated demonstrations.
OWN-WORLD: Desktop navy ground (oklch ~0.135 0.03 266), app windows as the only lit objects with a cool key light beneath, orange accent only for live/working state and primary action. Archivo wide heavy display, JetBrains Mono only for commands/paths/states. Credits-roll lists (role | value around a centre gutter) replace feature grids.
STORY: Describe a retry fix, see the completed work and test results, then review the change in the same thread. Explain other capabilities and Sync briefly, with links to their full documentation. Download or request beta with honest limits.
FIRST VIEWPORT: Painted horse-M, short H1, lede and Download/Source actions. Below them, three short workflow steps lead into one real transcript capture. Use a narrow capture of the same thread on phones so the product text remains readable.
FORM: Cinematic projection room, selected by the user. Surface seed:9647261274d71f28; the user-pinned cinematic direction governs over generated alternatives.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Signature interactions
- The mark: one sumi-e entrance painted left to right (ground, one continuous stroke through tail and neck, foreleg as the brush passes the shoulder, drying ink), then a collected rise as one rigid body; replayable on press. A small rigid rise on hover or focus wherever the mark appears in `.mk-hover`.
- Homepage workflow: a static, ordered request → work → review sequence and one responsive capture. No autoplay, screenshot tabs or sticky use-case stage.
- The Mesh stage remains on /sync, with chapter summaries, text beats, pause and reduced-motion support. The homepage links to it from a concise Sync section.

## Constraints
- No drawn or composited product UI. Product images are real captures with fixture data; motion graphics are diagrams and say so.
- Keep truthful limits: free local Desktop, unsigned Mac builds need the install guide, bring your own provider accounts, hosted Sync invite-only beta, proposed prices not purchase, self-host free but host bills separately, Cloud Agents unavailable. Chat threads run in the chosen checkout; workflows, helpers, factories and Mesh jobs use worktrees.
- No private financial forecasts. No gradient text, decorative glass, fake metrics or testimonials. No horizontal overflow from 320px.
- Marketing styles live in app/marketing.css, every selector under `.cine`; the mark lives in app/mark.css.

## Pricing composition

- Pricing uses a compact, left-aligned “Pricing” heading with a short explanation of the free app and the choice of self-hosted or hosted Sync & Mesh. The comparison board carries the price figures and primary actions. Beta access and the account are quiet links above the board, not a second set of large buttons.

## Additional confirmed direction
- Pricing is up front and said the same way everywhere, in one or two sentences: the app is free; Sync & Mesh is free on a backend you run (your cloud provider bills you) or £8.99 a month (£89.90 a year) if Mezair hosts it; hosting is an invite-only beta for now. On the homepage it sits in the lede, before the download action.
- The footer links to a playful naming page. Its story is power under precise control: strength, discipline, progression and elegance. The user sets the direction; agents carry out complex, coordinated work. A click-triggered horse-M hop retains the fun.
- Logo motion: "Ink draw + rise", chosen by the user, refined to sumi-e brushwork painted smoothly left to right. The silhouette never comes apart.
