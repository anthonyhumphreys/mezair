---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/sync/page.tsx","app/pricing/page.tsx","app/what-does-mezair-mean/page.tsx"]
---

# Marketing surfaces: /, /sync, /pricing

Mode: Persuade. Docs, account, workspace, auth and artifact routes are out of scope and keep the light/dark docs world.

## Audience, job, actions
- Developer already paying for one or more coding agents, deciding in seconds whether Mezair Desktop is worth a download.
- Belief to earn: every agent I pay for runs in one free, open-source app, on my own logins, and it does more than a chat window.
- Actions: Download for macOS (Apple silicon), Windows/Linux releases, read the MIT source. Secondary: Sync & Mesh, pricing, docs.
- Proof: real captures of Mezair Desktop with synthetic fixture content (provenance in `public/screens/manifest.json`).

## Direction contract
THESIS: The agents' names are the headline. The homepage owns one claim, every coding agent under one set of reins, and refuses the category page of a vague slogan over a request, work, review walkthrough.
OWN-WORLD: Projection navy ground (oklch 0.135 0.03 266), wide heavy Archivo at title-card scale, app windows as the only lit objects on a cool key light, hairline ruled rows instead of cards, orange only on the download action. Cast-list typography: names in muted ink, the claim in full white.
STORY: I recognise the agents I pay for, learn they run in one free app on my own plans, see the app, then see what a chat window cannot do (work that carries on without me, review evidence in the thread, issue to pull request, my other machines as workers), learn it is local and MIT, and download.
FIRST VIEWPORT: Left two thirds: one h1 of five stacked lines at about 96px, "Codex. Claude Code. Cursor. Devin." in muted ink and "One set of reins." in white. Right column aligned to the lower half: one sentence, the orange Download for macOS button, a Read the source link, then two fine lines (Sync & Mesh price, install note). The app window, about 1100px wide and offset right, rises from the bottom edge. On phones the names stack full width, then copy and action, then a narrow capture.
FORM: Roll call, a film cast list at title-card scale; sixth on the ordered list of seven structures. seed:374f6aa8c62b0c0f. Signature interaction: on load the four names light in turn, then the claim lands white; static under reduced motion.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Homepage sections after the hero
One claim and one real capture each, in this order: sign-in stalls over the full app window; a typographic interlude on background work and companions; review evidence in the thread; software factories (Beta); Sync & Mesh with the price; a three-fact ownership row; the close with the painted mark. Keyboard shortcuts, the other Mezair tools and clone commands live in docs, the Products menu and the footer, not on the homepage.

## Signature interactions
- The mark: one sumi-e entrance painted left to right, then a collected rise as one rigid body; replayable on press. It now sits in the homepage close. A small rigid rise on hover or focus wherever the mark appears in `.mk-hover`.
- The Mesh stage remains on /sync, with chapter summaries, text beats, pause and reduced-motion support.

## Constraints
- No drawn or composited product UI. Product images are real captures with fixture data; motion graphics are diagrams and say so.
- Never call the Mac build unsigned in page copy; the install guide carries the xattr step.
- Keep truthful limits, stated once and beside the thing they qualify: free local Desktop, bring your own provider accounts, hosted Sync invite-only beta, self-host free but the host bills separately, factories in Beta.
- No private financial forecasts. No gradient text, decorative glass, fake metrics or testimonials. No horizontal overflow from 320px.
- Marketing styles live in app/marketing.css, every selector under `.cine`; the mark lives in app/mark.css.
- Voice: short declarative lines, one idea each. Two riding references only (the hero claim and the close). No three-item lists as sentences, no headings that are labels.

## Pricing composition
- Pricing uses a compact, left-aligned "Pricing" heading with a short explanation of the free app and the choice of self-hosted or hosted Sync & Mesh. The comparison board carries the price figures and primary actions.

## Additional confirmed direction
- Homepage price (confirmed by the owner, 2026-11-10): the Sync & Mesh price stays in the hero, as one fine line beside the download action: free to self-host, or £8.99 a month hosted. The Sync & Mesh section does not repeat the figure; it carries the invite-only notice and links to /sync and /pricing.
- The footer links to a playful naming page. Its story is power under precise control. A click-triggered horse-M hop retains the fun.
- Logo motion: "Ink draw + rise", refined to sumi-e brushwork painted smoothly left to right. The silhouette never comes apart.

## Unresolved
- Hero capture: `agents-at-work` (production ChatView with synthetic Acme threads and the open model picker), from the untracked probe `mezair-app/scripts/chat-review-fixture/AgentsAtWorkProbe.tsx`. Its manifest provenance is reproducible only once that probe is committed; re-stamp `appCommit` then.
