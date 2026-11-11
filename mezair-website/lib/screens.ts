import manifest from "@/public/screens/manifest.json";

/**
 * Real Mezair Desktop captures. Every image is the production UI rendered with
 * synthetic fixture content (the Acme storefront workspace, example devices and
 * jobs). `scripts/capture-screens.mjs` writes the files and the manifest that
 * records each capture's source, fixture and app commit.
 */
export type ScreenId = keyof typeof manifest;

type ScreenText = {
  alt: string;
  /** Short, visible caption. */
  caption: string;
};

const text: Record<ScreenId, ScreenText> = {
  "retry-workflow": {
    alt: "A Mezair thread fixing a checkout retry limit: the request, six completed actions, a change from three attempts to five, 14 passing tests and an inline review with no findings. Review details, command history and the two changed files are available to expand.",
    caption: "A retry fix, test results and review in one thread."
  },
  "retry-workflow-mobile": {
    alt: "The same retry fix and review in Mezair's narrow thread layout: six completed actions, 14 passing tests and no review findings, with command history and changed files available to expand.",
    caption: "The same workflow in a narrow thread."
  },
  "agents-at-work": {
    alt: "Mezair Desktop in the Acme workspace with five storefront threads. Migrate image CDN URLs to the v2 signer is waiting for approval. Two threads are working: a stale cart total after a coupon is removed, and an address form that drops the apartment line. A gift card rounding fix is ready to archive. Each thread shows the access its agent applies: Agent on most, Ask on the address form thread and Full access on the gift card thread. The open thread fixed a search input that lost focus when filters updated, in seven actions with 6 passing search tests and two changed files. Its composer runs Cursor with Composer 2 and the same Agent access, and the open model picker also lists Codex CLI with GPT-6.1 Sol, Claude Code with Opus and Devin CLI.",
    caption: "Several threads at work at once, with the agent chosen per thread."
  },
  "agents-at-work-rail": {
    alt: "Mezair's thread rail with five storefront threads. Migrate image CDN URLs to the v2 signer is waiting for approval. Checkout keeps the stale cart total and Address form drops the apartment line are working. Search input loses focus after filters update is open. Gift card balance rounds half-cents incorrectly is ready to archive. Each thread shows its access level.",
    caption: "Five threads at once: one waiting for you, two working, one ready to archive."
  },
  "agents-at-work-picker": {
    alt: "Close-up of Mezair's open model picker. Under a search field it lists Codex CLI with GPT-6.1 Sol, Claude Code with Opus, and Devin CLI with Auto (Devin default) and SWE-2, then reads 6 models. Run settings follow: Build mode, reasoning set by the Cursor model, subagents on Auto and fast mode off. Beneath the picker, the thread's composer is set to Cursor with Composer 2.",
    caption: "The model picker: every agent and model, chosen per thread."
  },
  "companion-home": {
    alt: "Mezair Companion on an iPhone, following Dana's MacBook Pro in the Acme workspace. Needs attention: a low-risk check waiting for approval, to run the image URL tests against the v2 signer. Running: Checkout keeps the stale cart total after a coupon is removed, working in Codex, and Address form drops the apartment line on autofill, working in Claude Code.",
    caption: "The iPhone companion: approve a waiting agent and watch the rest run."
  },
  "desktop-run-complete": {
    alt: "Mezair Desktop in the Acme workspace. A Codex thread asked to raise the checkout retry limit to five. The run finished in six actions; the answer explains the change, notes that the fifth attempt waits 1.6 seconds, reports 14 passing tests and offers Review these changes for two edited files.",
    caption: "A finished run with the agent's answer and the two files it changed."
  },
  "desktop-run-steps": {
    alt: "The same Mezair thread with the work expanded: read src/lib/retry.ts, searched for withRetry, edited test/retry.test.ts, ran pnpm test -- retry with one failure, edited src/lib/retry.ts, then ran pnpm test with 14 passing.",
    caption: "Each step the agent took, including the failing test it wrote first."
  },
  "factories-line": {
    alt: "Mezair Factories view. A factory line takes labelled GitHub issues through stations from intake to merge; runs are shown at each station with live, waiting, needs approval and blocked states.",
    caption: "A software factory taking labelled GitHub issues through to merge."
  },
  "factories-line-mobile": {
    alt: "A factory's run list. Needs you, 2: issue 475, retry webhook delivery with exponential backoff, waiting at Merge; issue 471, a flaky snapshot in the OrderSummary test, blocked at Verify. In progress, 4: a gift card rounding fix at Merge, the search focus fix at Checks, and two issues at Build. A row of pips under each run marks the station it has reached.",
    caption: "Factory runs grouped by what they need, with the station each has reached."
  },
  "factories-workflows": {
    alt: "Mezair Workflows view showing reusable agent workflow templates, which factories pin, and the option to use a workflow in a factory.",
    caption: "Reusable agent workflows and the factories that use them."
  },
  "mesh-jobs": {
    alt: "Mesh jobs in Settings. A start-session job runs on studio-mac with its live attempt stream: checkout verified, pnpm install, a failing test, an edit and 14 passing tests, with a marked gap in the stream. Other jobs show Needs approval, Completed, Lost contact and Stopping.",
    caption: "Jobs on your other machines, with the output of the running job."
  },
  "mesh-approval": {
    alt: "A Mesh code-task job on build-box waiting for approval of a bootstrap recipe: pnpm install --frozen-lockfile and pnpm exec playwright install chromium, with Approve and Deny buttons and an expiry time.",
    caption: "A worker waiting for approval before it runs a bootstrap recipe."
  },
  "mesh-session": {
    alt: "Two session ownership strips. The first reads Session on this device with Move session open, listing studio-mac and build-box. The second reads Session on moving to studio-mac, source quiescing.",
    caption: "Moving a running session. During a handoff, the strip shows its current state."
  },
  "mesh-devices": {
    alt: "Enrolled devices in Settings, Sync and Mesh: Dana's MacBook Pro marked This device, studio-mac trusted by pairing, build-box trusted by manual approval, and old-imac revoked. Each has Rename, Compare and verify, and Revoke.",
    caption: "Each enrolled device, how it became trusted and a Revoke button."
  },
  "mesh-status": {
    alt: "Sync and Mesh status for this device: connected to the Acme Sync Cloudflare backend, Sync on with the live connection up, and this device allowed to run Mesh jobs.",
    caption: "The connected backend and whether this device runs Mesh jobs."
  },
  "surface-review": {
    alt: "An inline Review surface in a Mezair thread for a working tree: a Blocked verdict followed by findings grouped by severity. Review details is collapsed; it contains the risks, chapter explanations and secondary actions.",
    caption: "A review that leads with the verdict and findings, with supporting detail available on expansion."
  },
  "surface-findings": {
    alt: "A Findings surface from a security audit: one critical, one high, two medium and one low finding, each with a file and line, plus Ask agent to fix top 5.",
    caption: "Security findings with file and line numbers."
  },
  "surface-findings-mobile": {
    alt: "A Security audit panel: one critical credential leak and one high-risk SSRF path, with one critical, one high, two medium, one low and no info findings. The first four: refresh token logged in plaintext at src/gateway/token-gateway.ts line 12; gateway URL read from the environment without validation at line 13; password reset tokens never expire at src/auth/reset.ts line 44; session cookie lacks SameSite at src/http/cookies.ts lines 27 to 31.",
    caption: "Security findings, each with its file and line."
  },
  "surface-pipeline": {
    alt: "A Pipeline surface for CI: workflow, install, lint, test, build and deploy jobs as a graph, with the failing test job and an uncached install called out.",
    caption: "A CI pipeline drawn as a graph, with the slow and failing jobs marked."
  },
  "surface-dependencies": {
    alt: "A Dependencies surface: nine packages with three vulnerable, one restricted licence and two deprecated, plus Ask agent to upgrade 3 vulnerable.",
    caption: "Dependencies with their advisories, licences and deprecations."
  }
};

/** Settings panels captured on a transparent ground; they sit on the page without an extra frame. */
const panels = new Set<ScreenId>(["mesh-jobs", "mesh-approval", "mesh-session", "mesh-devices", "mesh-status"]);

export type Screen = ScreenText & (typeof manifest)[ScreenId] & { id: ScreenId; panel: boolean };

export function screen(id: ScreenId): Screen {
  return { id, ...manifest[id], ...text[id], panel: panels.has(id) };
}
