# Production deployment plan

Implementation update: fresh Mezair staging and production backends and WorkOS
environments have now been provisioned. See
[the cutover record](hosted-environment-cutover.md) for actual identities and
remaining steps. The inventory below is the historical pre-provisioning snapshot.
The operator subsequently authorized permanent destruction of the old staging
environment, superseding its retention recommendations. The old zone ID belongs
to `anvilstack.dev`; Mezair DNS access remains outstanding. Runtime compatibility
and logging are now preserved by the generator; custom-domain routing is still a
separate configuration step.

Planning snapshot: 31 October 2026, source `60d9c049ba7a8e98c1f69d2b56f657fab1ea5a05`.
This is an internal deployment plan. No resources or live configuration were changed while preparing it.

## Proposed release scope

Launch the website, account area and hosted Sync & Mesh as an invite-only **production beta**. Keep the app and self-hosted Sync & Mesh free. Waitlist approval admits an identity to the paid service; it never grants a subscription. Approved users must complete Stripe checkout, optionally with a manually issued Stripe promotion code. Keep `HOSTED_BILLING_ENFORCEMENT=true` and `MEZAIR_CLOUD_AGENTS_ENABLED=false`. Keep checkout off during bootstrap, then enable it after paid-flow acceptance and before admitting the first cohort.

Managed host tunnels need their own production configuration and acceptance before offering automatic connections across separate networks. They are part of host reachability, not Cloud Agents compute. A production pilot can begin on explicitly configured reachable hosts while tunnel acceptance is completed; invitations must describe the routes actually available.

Stripe is required for this launch. Public mobile distribution, a hosted Registry service and Mezair-operated execution containers have separate rollout requirements. Hosted coding agents will be a separate fixed monthly add-on with its own Stripe product/recurring price and entitlement. The monthly amount and included compute/usage allowance remain to be defined before configuring checkout or enabling execution. The Sync subscription alone does not include this compute. All product status labels remain Beta.

## Current evidence

| Area | Observed state | Consequence |
| --- | --- | --- |
| Website | Vercel project `anvil-stack`, ID `prj_IHYsp7hU6kPpHobt3YebxdZ6kpjP`, has a READY production-slot deployment of the source SHA above: `dpl_GfJAZsd2KE4vmAioWYceS1XmnNah`. `mezair.dev` is attached. | Reuse the project with root directory `mezair-website`; a new hosting platform is unnecessary. |
| Public sign-up | `GET https://mezair.dev/waitlist` returned HTTP 404 with `{"error":"auth not configured"}`. | Restore working sign-up as part of the service cutover. The production-slot label does not establish a working production identity integration. |
| Vercel configuration | The connector could read project/deployment metadata but listing environment variables returned HTTP 403. No local Vercel CLI was available. | Exact configured values and environment scopes still need an authorised operator check. Do not infer which individual variable is missing. |
| Cloudflare access | Wrangler identified account `715060911f9418f1df0f9de0265d8a64`. | Account access is available for inventory; use a dedicated deployment token in CI. |
| Staging backend | The descriptor URL in `hosted-targets.ci.json` returned HTTP 404. Cloudflare also reported that Worker `mezair-sync-hosted-staging` does not exist in the selected account. | Reconcile the target with live resources and restore staging before relying on it for release acceptance. |
| Staging D1 | The pinned ID `9d396edc-2967-4d94-9ca0-51311c2c4f13` exists as `anvil-sync-hosted-staging-billing`, whereas source calls it `mezair-sync-hosted-staging-billing`. The account D1 inventory showed no Mezair production database. | Resolve the namespace discrepancy explicitly. An edited resource name is not a migration or a new database. |
| Artifact storage | R2 inventory showed `anvil-sync-hosted-staging-artifacts`; neither the tracked Mezair staging bucket name nor the proposed production bucket appeared. | Reconcile staging storage deliberately and create a separate production bucket. Retain existing data. |
| Production target | Both tracked hosted target manifests have incomplete production fields. The backend deployment workflow only handles staging. | Complete and validate a production target and add a production deployment workflow. |
| Secret isolation | Production wrapper operations require an independently readable staging secret source; the CI staging target currently uses `backendEnv: "process"`. | The current CI manifest cannot simply be reused for production operations. Preserve the isolation checks. |
| Generated Worker config | `mesh-recipe.ts` generates `workers_dev: true` and does not preserve custom domains/routes or observability settings. | Add explicit supported configuration before relying on a stable production hostname and stored logs. Hand-edits to generated config will be lost. |
| Build runtimes | Website CI uses Node 22; Vercel reports Node 24.x. | Select one supported runtime for the website build and align CI and hosting before release. |

WorkOS production dashboard settings, secret contents, account billing, data residency, production tunnel capacity and live restore coverage have not been verified by this planning audit. Historical staging notes remain historical evidence, not acceptance of this candidate.

## Target services

Names below are proposed production names, not claims of provisioning.

| Service | Production target | Ownership and isolation |
| --- | --- | --- |
| Website and account UI | `https://mezair.dev`, existing Vercel project | Production-scoped WorkOS and backend settings. Keep staging on its own hostname and configuration. |
| Sync/Mesh API and WebSockets | `https://sync.mezair.dev`, Worker `mezair-sync-hosted-production` | Stable descriptor ID, separate Worker, explicit custom-domain configuration and TLS. |
| Coordination state | `ACCOUNT`, `SESSIONS`, `MACHINE_ENDPOINTS` Durable Object bindings | Namespaces attached to the production Worker; retain migration tags and state. |
| Hosted identity, entitlements and billing mirror | D1 `mezair-sync-hosted-production-billing` | A new production database ID, all hosted migrations applied, no staging rows copied. |
| Encrypted Sync snapshots, shares and Mesh artifacts | R2 `mezair-sync-hosted-production-artifacts` | A separate private bucket, retention and recovery checked against application requirements. |
| Human identity | WorkOS production environment | Website and Desktop clients must resolve users within the same production identity environment. Neither client ID may reuse a staging client ID. |
| Authentication email | Verified WorkOS email domain under `mezair.dev`, or a supported custom provider | WorkOS handles AuthKit mail; a separate general-purpose email service is not required for this beta. |
| Managed host ingress | Production tunnel credentials and explicitly controlled hostname domain | Separate token from staging and deployment automation. Confirm generated hostname TLS coverage before selecting a nested domain. |
| Operator secrets | Existing production secret-store convention plus GitHub/Vercel/Worker secret stores | Distinct production credentials; website, backend and operator audiences remain separate. |
| Deployment and client delivery | GitHub Actions and `mezair-production` environment | Protected production changes, pinned candidate SHA, serial backend deploys and retained deployment records. |

The initial API does not require Postgres, Redis, Queues, Workers AI, a central model API key, or the Cloud Agents provisioner. External model/sandbox providers remain configured and paid for by users on their own hosts.

## 1. Reconcile the existing environments

1. Inventory Worker names, domains, D1 IDs, R2 buckets, WorkOS client IDs and current website environment selection. Record identifiers and secret names only.
2. Resolve the staging name/ID discrepancy against [the identity cutover contract](mezair-identity-cutover.md). Retain old resources and data while deciding whether to retain an existing staging target or provision a fresh Mezair staging environment. Do not silently reuse old ciphertext, account namespaces or enrollment credentials.
3. Make the chosen staging descriptor return HTTP 200 with `mezair-backend/1`, `sync/2`, `mesh/2` and the intended WorkOS identity. Make staging website sign-in return to the matching candidate.
4. Run [staging acceptance](../mezair-app/docs/runbooks/hosted-sync/staging-acceptance.md) on the source revision intended for release, including two physical machines on separate WANs. An older successful workflow is insufficient.

Exit: a recorded staging resource map, functioning identity flow and current acceptance results. Do not switch the public website to production services to work around broken staging.

## 2. Prepare deployment code and automation

| Change | Files / surface | Required result |
| --- | --- | --- |
| Production resource target | `mezair-app/cloud/backend/hosted-targets.ci.json` and example/operator manifest | Explicit account, Worker, base URL, bucket, database name/ID, stable descriptor identity, WorkOS client IDs and one secret-input mode. Preserve staging separation. |
| Durable domain/log configuration | `mezair-cloud/packages/cloudflare/src/mesh-recipe.ts`, hosted template, tests | Custom domains, Workers Logs and the intended `workers.dev`/preview exposure survive every plan regeneration. Keep account/DO/R2/D1 bindings and cron intact. |
| Production workflow | New `.github/workflows/sync-backend-production.yml` | Protected `mezair-production` environment, approved source from `main`, candidate SHA and evidence reference, no concurrent deploys, typecheck/tests/dry-run, migrations, deploy, secrets and post-deploy probes. No production `--test-deployment`. |
| Initial bootstrap versus upgrades | Production workflow and runbook | Explicit first-deployment mode; capture and pin created resource IDs. Later runs upgrade the same Worker and storage rather than creating replacements. |
| Secret comparison input | Workflow/operator manifest and secret provisioning | Production CI uses a staging credential fingerprint reference, including individual HMAC secrets. Local operators may still select an independent staging secret source. Never weaken the fresh-secret check. |
| Production client defaults | Release environment variables and build validation | Production Desktop/daemon builds embed the production endpoint and reject missing configuration. Staging candidate previews stay on staging. |
| Website/runtime configuration | Vercel project settings, website CI and environment validation | Aligned supported Node runtime, explicit production selection and complete production-scoped variables. |

The first production bootstrap used a controlled operator session with independent staging and production sources. CI now materializes a SHA-256 comparison reference from the protected production environment's `STAGING_SECRET_FINGERPRINTS_JSON` variable. Refresh it after staging credential rotations. Missing or malformed references fail closed; no complete staging secret bundle is copied into production. Never export a complete backend secret source to Vercel. See [secret inputs](../mezair-app/docs/runbooks/hosted-sync/secret-inputs.md).

Before implementation, review the relevant project `AGENTS.md` and [PATCH.md](../PATCH.md), especially C11. Keep any changed owned behaviour and its intent guide in sync.

## 3. Configure dependencies, credentials and payments

### WorkOS

Use the production environment with its own billing setup, API key, clients, users, waitlist, webhook and branding. WorkOS environments have separate resources; staging users and webhook settings do not carry over. See [WorkOS environment setup](https://workos.com/docs/authkit/environments).

- Register the website callback `https://mezair.dev/auth/callback` and the corresponding application/sign-out settings used by the integration. Configure only the origins and redirect paths actually used.
- Verify the existing Desktop/daemon [device authorization flow](https://workos.com/docs/authkit/cli-auth) using the production descriptor's public client ID. Keep the API key on the backend and website server.
- Enable the intended sign-in methods and configure production OAuth credentials where those methods require them. Complete the verified-email and waitlist-admission flow with a real mailbox.
- Configure `https://sync.mezair.dev/v1/hosted/workos-webhook` with a new signing secret. Subscribe to the events consumed by the current handler: `organization_membership.updated`, `organization_membership.deleted`, `invitation.accepted`, `invitation.revoked`, and `organization.deleted`.
- Verify email delivery for sign-in, verification, recovery and invitations. WorkOS recommends a custom email domain or provider for production traffic; keep its verification records DNS-only. A branded AuthKit domain such as `auth.mezair.dev` is optional and has a separate WorkOS cost. Follow [email domain setup](https://workos.com/docs/custom-domains/email) and [Cloudflare DNS/proxy instructions](https://workos.com/docs/custom-domains).
- Keep the current AuthKit API issuer `https://api.workos.com/user_management`. A custom hosted sign-in domain does not justify changing that pinned issuer or switching to WorkOS Connect endpoints.

### Website configuration

In Vercel's Production environment, set `MEZAIR_DEPLOYMENT_ENV=production` and the following seven selected variables:

```text
MEZAIR_PRODUCTION_WORKOS_API_KEY
MEZAIR_PRODUCTION_WORKOS_CLIENT_ID
MEZAIR_PRODUCTION_WORKOS_COOKIE_PASSWORD
MEZAIR_PRODUCTION_WORKOS_REDIRECT_URI=https://mezair.dev/auth/callback
MEZAIR_PRODUCTION_BACKEND_ORIGIN=https://sync.mezair.dev
MEZAIR_PRODUCTION_HOSTED_KEY_ID
MEZAIR_PRODUCTION_HOSTED_SERVICE_SECRET
```

The cookie password needs at least 32 characters; the hosted service secret needs at least 32 bytes. Keep secret values in sensitive server-side variables. The key ID and secret must match one entry in the Worker's `HOSTED_SERVICE_KEYS` map. Set the public canonical origin to `NEXT_PUBLIC_SITE_URL=https://mezair.dev`. Keep Preview/development on their explicit staging configuration. A rebuild is required after changing AuthKit callback settings because the public callback is embedded at build time.

### Cloudflare and GitHub

- Confirm the account plan, capacity, storage jurisdiction and usage budget for Workers, SQLite Durable Objects, D1 and R2. Use the proposed production names only after checking for collisions.
- Provision production-only `HOSTED_SERVICE_KEYS`, `WORKOS_API_KEY` and `WORKOS_WEBHOOK_SECRET`. Add separate `HOSTED_OPERATOR_KEYS` only for the operator features being used. Do not reuse HMAC values between service/operator audiences or environments.
- Keep credential values in [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), not Wrangler vars, manifests or command arguments. Install a deployment token scoped to the actual account/resources in the protected GitHub environment.
- Configure the API [Worker custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Permit authenticated WebSocket upgrades and provider webhooks without browser-only bot challenges; bypass caching on API/auth/account traffic. Test the actual routes rather than applying a blanket zone rule.
- Preserve `HOSTED_BILLING_ENVIRONMENT=production`, enforcement on, checkout off, Cloud Agents off and managed endpoints off for the closed bootstrap. Exclude development spike/admin-token settings, `STRIPE_API_BASE` and `HOSTED_ALLOW_EARLY_CHECKOUT`.
- Preserve all three Durable Object migrations and the `17 * * * *` reconciliation cron. Apply all eight currently checked-in hosted D1 migrations, including beta codes, factories and skill recommendations; use the actual release's full migration set if it changes.
- Protect the backend workflow's source and deployment credentials while retaining the tag access required by the existing `app-v*` release workflow. Pin the tested source SHA in the deployment record.

Complete the required Stripe configuration below before enabling checkout or inviting the production cohort. Coupons and promotion codes are created manually in Stripe and sent only to recipients the operator chooses; no approval-triggered coupon automation is needed.

## 4. Bootstrap the closed production backend

After the preparation above, use the selected target wrapper in this order. These are execution steps for the later rollout, not commands run by this plan.

1. Build the local deployment CLI and run backend typecheck, tests, hosted-deploy guard tests and hosted-config verification. Review the generated production target and manifest.
2. Generate `plan --first-deploy`; provision the new R2/D1 resources with `provision --first-deploy`. Record the returned IDs, add the D1 ID to the reviewed manifest and regenerate without changing identities.
3. Apply hosted D1 migrations, then run `apply --dry-run`. Check generated domains, logging, bindings, auth, feature flags and cron.
4. Deploy with `apply --evidence <reviewed-reference>` and install the selected production secrets through `secrets`. The production gate forbids `--test-deployment`. Keep customer admission closed while this first Worker is being configured.
5. Verify the production domain and descriptor. Check deployed secret names and vars, production WorkOS clients, D1 binding, R2 bucket and cron. Confirm unsigned service requests are rejected and staging credentials are rejected. A public descriptor alone does not prove account access.
6. Register/verify the production WorkOS webhook delivery and check membership removal/reconciliation using a disposable production pilot identity.

Invoke each operation through `pnpm hosted:deploy -- --environment production --manifest <reviewed-manifest> ...` from `mezair-app/cloud/backend`. Generated files are build outputs; configuration changes belong in their source inputs.

## 5. Cut over the website and clients

1. Build a private candidate with the complete production configuration. Test sign-in, callback, sign-out, account creation, Stripe checkout, confirmed subscription entitlement and denied access before promoting it to the public hostname. Any temporary production callback hostname must be explicitly registered and removed after use.
2. Deploy the production-configured website to `mezair.dev`. Confirm `/waitlist` starts the intended WorkOS flow, the callback returns to `mezair.dev`, and account requests reach only the production backend. Record the previous Vercel deployment and environment selection for recovery.
3. Set `MEZAIR_PRODUCTION_HOSTED_BACKEND_URL=https://sync.mezair.dev` in the relevant release configuration. Production releases already select `MEZAIR_DEPLOYMENT_ENV=production`; verify that the built artifacts actually contain the intended endpoint. Do not use the candidate-preview builder for this check: it intentionally forces staging.
4. After a confirmed subscription, give production users fresh enrollment, recovery setup and explicit Sync consent. Do not copy staging account rows, device tokens, cursor state or encryption keys into production. Existing local data stays available.
5. Use one approved pilot identity and two physical hosts to verify bidirectional Sync, approval/denial, reconnect, recovery and revocation within 60 seconds. Test website device management, account/data controls, browser workspace approval and share audiences for the capabilities being exposed.
6. Before enabling managed host ingress, install the dedicated production Tunnel/DNS token and set the reviewed hostname domain. Verify allocation, TLS, connector startup, cross-WAN access, route loss, revocation, restart recovery and complete DNS/tunnel cleanup. Then enable `MEZAIR_MESH_MANAGED_ENDPOINTS=true`; keep the Cloud Agents flag false.

Website and backend environment changes need a coordinated release. Rolling the website back to a staging-configured build after admitting production users is not a recovery strategy.

## 6. Establish operations, then invite the first cohort

- Assign a release owner and incident responder. Add an external descriptor check and a website/auth availability check. Alert on runtime failures, failed WorkOS deliveries, service-auth failures, D1 errors, quota/storage growth and account spend. Verify a test notification reaches the responder; saved log queries alone are not alerts. Follow [metrics and alerts](../mezair-app/docs/runbooks/hosted-sync/metrics.md).
- Rehearse recovery for each store. D1 billing data has [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/); SQLite Durable Objects have a separate [PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/). D1 recovery does not restore coordinator state or R2 objects. Agree recovery objectives and implement/test the operator path for all three stores before claiming restore coverage.
- Preserve verified Sync snapshots and required journal/tombstone history. Set R2 cleanup only after checking the application retention contract; a blanket seven-day bucket expiry would destroy longer-lived Sync state. See [Sync/Mesh decisions](../mezair-app/docs/plans/sync-mesh/decisions.md).
- Record a known-good Worker version, Vercel deployment, schema/migration state and protected recovery artifacts. Rehearse [rollback and restore](../mezair-app/docs/runbooks/hosted-sync/rollback.md) on disposable data. Worker rollback does not reverse D1, R2, Durable Object state or identity-provider changes. See [Cloudflare rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
- Enable reviewed production checkout, approve each tester in WorkOS, and have them complete Stripe checkout through [hosted signup](../mezair-app/docs/runbooks/hosted-sync/beta-access.md). Approval permits signup; confirmed subscription/invoice state permits hosted writes. Discounts, when intended, use manually issued Stripe promotion codes. No automatic free-access grant or Mezair redemption code is part of signup.
- Start with a small named cohort. Observe authentication, reconnect traffic, coordinator/storage growth and actual provider usage before expanding. Capture failures and rollback triggers against the deployed source SHA.

The release record needs the candidate SHA, actual resource IDs/versions, deployed settings, pilot results, restore/alert results and remaining user-visible limitations. Production invitations begin after those checks pass, not merely after an upload succeeds.

## Required Stripe configuration

Complete this as part of dependency setup, before paid-flow acceptance and production invitations. Create new live-mode recurring prices and configure:

Set `STRIPE_PRICE_SYNC_MONTHLY`, `STRIPE_PRICE_SYNC_ANNUAL`,
`STRIPE_PRICE_TEAM_MONTHLY` and `STRIPE_PRICE_TEAM_ANNUAL` to the selected live
recurring price IDs. Keep financial configuration in Stripe rather than this
repository document.

Install live `STRIPE_SECRET_KEY` and endpoint-specific `STRIPE_WEBHOOK_SECRET`. Configure fixed billing success/cancel/portal return URLs. Set up `/v1/hosted/stripe-webhook` with the snapshot payload shape and compatible API version expected by the current handler; source currently requests `2026-08-26.dahlia`. Use the events the handler consumes: checkout completion/expiry, subscription creation/update/deletion and paid/succeeded/failed invoice events. See [Stripe webhook configuration](https://docs.stripe.com/webhooks).

Verify approved-but-unsubscribed restrictions, purchase, manual promotion-code redemption, failed payment, cancellation, renewal, duplicate/out-of-order webhook delivery, portal access, team seat quantities and reconciliation before setting `HOSTED_CHECKOUT_ENABLED=true`. A checkout redirect must not grant entitlement. Keep webhook delivery working when disabling checkout or rolling back. Decide merchant billing/tax presentation and update public availability copy for the actual activation date; the end-of-November date governs the planned end of closed signup, not free access or automatic checkout activation.

## Opening signup after November

The planned public-signup transition is 1 December 2026, following the closed
period through 30 November. Disable the WorkOS waitlist and change backend
admission together. The current backend requires an approved entry for every
new identity, so this transition needs an explicit reviewed public-admission
mode that still verifies the configured client and verified user email. Do not
remove identity checks or treat an account row as subscription evidence.
Paid entitlement, checkout and Stripe webhooks remain required after signup
opens. No subscriber automatically loses or gains a discount at this transition.

## Dependencies with separate release paths

| Dependency / product | Treatment for this production beta |
| --- | --- |
| Desktop signing and downloads | Deliver tested `app-v*` artifacts. macOS notarisation needs the Apple credentials in the existing protected release workflow; label unsigned artifacts accurately if that remains the selected path. |
| Automatic updates | Separate `mezair-desktop-updates` Worker and `mezair-desktop-releases` R2 bucket. Auto-update publication is currently parked; do not make it a dependency of the Sync launch. |
| npm and GHCR | Confirm `@mezairstack` publishing and renamed CLI/image artifacts before advertising public install commands. Desktop's bundled CLI preparation does not prove public package publication. |
| Registry hosting | A separate gateway/worker/admin stack with Postgres, object storage, and Redis/BullMQ in Compose or AWS queue/storage equivalents. It is not part of this Worker backend and has no shared database requirement with Sync. |
| Cloud Agents / Cloud execution | Separate credential brokerage, persistent control plane, execution-provider acceptance and container lifecycle work. Do not deploy the Sandbox provisioner or enable the Cloud Agents flag for this release. |
| Mobile / Raycast | Validate against the selected production backend before distribution. Mobile retains its native receive-buffer and physical-device release gates from [release readiness](release-readiness.md). |
| Model and sandbox integrations | Credentials stay in users' configured providers/hosts. Production Sync requires no central OpenAI, Azure, AWS or Vercel model credential. |

## First implementation slice

Reconcile staging inventory and restore its descriptor/sign-in flow, then prepare one reviewed change containing the completed production target, persistent domain/logging configuration and guarded production workflow. Provision WorkOS, Stripe and the closed backend after that change is validated. Website/client cutover, paid-flow acceptance, checkout activation, managed-route acceptance and invitations follow the dependency order above.
