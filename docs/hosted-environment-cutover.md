# Mezair hosted environment cutover

Provisioned on 31 October 2026. This is an internal operations record, not public
website content. The resource and WorkOS client identities are pinned in
`mezair-app/cloud/backend/hosted-targets.example.json` and
`hosted-targets.ci.json`.

## Cloudflare resources

Account: `715060911f9418f1df0f9de0265d8a64`.

| Resource | Staging | Production |
| --- | --- | --- |
| Worker | `mezair-sync-hosted-staging` | `mezair-sync-hosted-production` |
| API origin | `https://mezair-sync-hosted-staging.still-glitter-7d20.workers.dev` | `https://mezair-sync-hosted-production.still-glitter-7d20.workers.dev` |
| D1 database | `mezair-sync-hosted-staging-billing` | `mezair-sync-hosted-production-billing` |
| D1 ID | `ff1ce27d-1d40-4629-ad80-7fa61380ce94` | `2cda230a-489c-442b-964b-6e83fc4f242c` |
| Private R2 bucket | `mezair-sync-hosted-staging-artifacts` | `mezair-sync-hosted-production-artifacts` |
| Descriptor identity | `mezair-hosted-staging-20261031` | `mezair-hosted-production-20261031` |

Both databases have all nine hosted billing migrations after the factory
provider rollout on 1 November 2026. Each Worker owns its
own Account, Session and Machine Endpoint Durable Object namespaces and the
`17 * * * *` reconciliation cron. Runtime compatibility is dated `2026-10-31`,
with `nodejs_compat`, persisted logs and query-string redaction enabled. The
deployment recipe now retains these runtime settings when regenerating configs.

Hosted billing enforcement is enabled. Checkout, hosted coding agents and
managed tunnel allocation are disabled during bootstrap. No Sandbox provisioner
was created for either environment. No legacy account, subscription or encrypted
state was copied into the new resources.

## WorkOS resources

Workspace: **Mezair**, `team_01M27GDXZKJY5PH7A3R0W5KQRV`.
Project: **Mezair**, `project_01M6986VY0EH2E60806Z69RGHG`.

| Resource | Staging | Production |
| --- | --- | --- |
| Environment | `environment_01M6986VYFNWFDZ7KC8S7QHTRC` | `environment_01M6986WE5F21YHFHRJNRSYWCV` |
| Website application | Mezair Web Staging | Mezair Web Production |
| Website client | `client_01M6986W9HRXVYW0XEV61R7AHW` | `client_01M6986WJMYRQA4TP9SDDW2KYE` |
| Desktop application | Mezair Desktop Staging | Mezair Desktop Production |
| Desktop client | `client_01M69BP4G15B6F6GQ4F0JM8GEA` | `client_01M69C8R4SFHSC6YPKRM6JFD2V` |
| AuthKit domain | `top-balloon-28-staging.authkit.app` | `fluid-revelation-59.authkit.app` |
| Membership webhook | `we_01M698JX36NRSWYYE04SEF550V` | `we_01M698JYFFWD3EW1N73YWWQW6Z` |

The current Mezair logo, icon and favicon are installed in both environments.
Production redirects to `https://mezair.dev/auth/callback`. Staging permits
`http://localhost:3000/auth/callback` and
`https://staging.mezair.dev/auth/callback`; the latter hostname still needs a
website deployment and DNS before use.

Each webhook targets `/v1/hosted/workos-webhook` on its own Worker and listens
for organization membership updates/deletions, invitation acceptance/revocation
and organization deletion. The API and webhook credentials differ between
environments. Website-to-Worker HMAC credentials also differ between environments
and use separate operator keys.

Production waitlist access is enabled. Approval permits account creation;
subscription access still comes from Stripe. Staging public signup is disabled,
verified after reloading Authentication → Features. Its waitlist is also disabled:
staging is for internal testing with explicitly provisioned test identities.

## Legacy teardown

The operator authorized permanent removal of the old staging resources:

- `anvil-sync-hosted-staging` and `anvil-sync-hosted-staging-provisioner` Workers.
- Their five Durable Object namespaces, both container applications and their
  container image repositories/tags.
- `anvil-sync-hosted-staging-billing`, D1 ID
  `9d396edc-2967-4d94-9ca0-51311c2c4f13`.
- `anvil-sync-hosted-staging-artifacts`, which was empty at deletion.
- WorkOS staging `environment_01M27GDY0QGK11V516QXBC67F0`, including its test
  organization and test user.

The old WorkOS project is labelled **Legacy Anvil (retired)**. Its old production
environment remains unused. WorkOS does not offer deletion of production
environments through the environment picker; contact WorkOS support if complete
removal of that remaining environment is required. No support message was sent.

Unrelated Eat or Yeet resources were retained. The `anvilstack.dev` DNS zone was
also retained. DNS-record inventory returned a permission error, so stale records
in that zone have not been certified absent.

## Secret custody

Values are not recorded in this document or tracked configuration. Local files
are Git-ignored and owner-readable only:

- `mezair-app/cloud/backend/.wrangler/hosted-secrets/staging/backend-secrets.json`
- `mezair-app/cloud/backend/.wrangler/hosted-secrets/production/backend-secrets.json`
- `mezair-website/.env`, containing the new environment-scoped website settings.

The backend credentials are installed as Worker secrets in their selected
environment. The local deployment manifest is
`mezair-app/cloud/backend/.wrangler/hosted-targets.json`.

The matching `HOSTED_SERVICE_KEYS`, `WORKOS_API_KEY` and
`WORKOS_WEBHOOK_SECRET` are installed in GitHub repository
`anthonyhumphreys/mezair`, under `mezair-staging` and `mezair-production`.
Operator HMAC keys remain local and on their Workers. Production CI uses the
`STAGING_SECRET_FINGERPRINTS_JSON` environment variable to reject reused
credentials without receiving the staging credential bundle. Refresh the
fingerprint reference after any staging credential rotation, including operator
keys. Automatic approval review rejected copying the complete staging bundle to
production; that transfer did not occur.

Vercel project `anvil-stack`, ID `prj_IHYsp7hU6kPpHobt3YebxdZ6kpjP`, root
`mezair-website`, now has `MEZAIR_DEPLOYMENT_ENV` and the matching seven scoped
website settings in Production, Preview and Development. Production selects
production; Preview and Development select staging. API keys, HMAC service
secrets and cookie passwords use Vercel's sensitive Secret type in Production
and Preview. Development uses encrypted Config values, since Vercel does not
support sensitive variables in Development. Production values are absent from
Preview and Development. Preview's registered callback is
`https://staging.mezair.dev/auth/callback`; Development uses localhost.
No website deployment was triggered by these configuration updates.

A staging credential exposed during the initial terminal transfer was expired
immediately in WorkOS and replaced. Only the replacement is stored in the local
secret file and deployed Worker. Production credentials were transferred with
terminal echo disabled and were not included in tool output.

## Verified deployment behavior

Live checks passed for both backends:

- Descriptor identity and desktop client match the selected environment.
- WorkOS device authorization succeeds for each new desktop client.
- WorkOS accepts each environment's API credential.
- Unsigned internal requests and the other environment's HMAC keys are rejected.
- Correct HMAC signatures reach request validation.
- Unsigned webhooks are rejected; correctly signed payloads reach validation.
- Each new D1 database has no outstanding migrations.

Bootstrap results and generated configs are retained locally under
`mezair-app/cloud/backend/.wrangler/bootstrap/`. These checks do not claim a
completed customer sign-in, subscription checkout or physical multi-device Sync
acceptance run.

## Factory provider rollout

On 1 November 2026, source commit
[`4c9eb0c0`](https://github.com/anthonyhumphreys/mezair/commit/4c9eb0c067f8b8719788c7ee33c1d39a09057a26)
was pushed to `main`, migration `0009_factory_issue_ids.sql` was applied to
both databases, and both backends were deployed through the guarded local
deployment commands. The migration preserves existing numeric GitHub claims
as provider-native text IDs. Production had no factory definitions or claims
at the pre-migration check.

| Environment | Worker version | Traffic |
| --- | --- | --- |
| Staging | `04d7f76c-7ab5-4d12-ae12-563c95607aa2` | 100% |
| Production | `97d47250-0a6f-4e26-abe9-4cd080285a32` | 100% |

Both deployment dry runs passed. Ten live smoke checks passed per environment:
descriptor/desktop identity, unsigned service rejection, valid service
signatures reaching payload validation, rejection of the other environment's
service credentials, unsigned webhook rejection, valid webhook signatures
reaching payload validation, WorkOS API credential acceptance, the text claim
schema, migration 0009 history, and the matching successful Worker deployment.
Staging smoke evidence was recorded before production deployment. Cloudflare
deployment history confirmed the version and traffic allocation for each Worker.

These checks do not claim live work item or source control writes, a completed
customer sign-in, subscription checkout, or physical multi-device acceptance.

## Remaining operator steps

1. **GitHub deployment access.** The application credentials are installed.
   Separate Cloudflare deployment API tokens still belong in each environment's
   `CLOUDFLARE_DEPLOY_API_TOKEN` secret.
   Scope the tokens to the account and the permissions needed to deploy Workers
   and manage their D1/R2 resources; follow the current
   [Cloudflare deployment-token setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
   Do not copy an interactive Wrangler OAuth token into CI.
2. **Website cutover.** The Vercel settings are installed for the next deployment.
   Attach `staging.mezair.dev` to the intended staging deployment and configure
   its DNS before using Preview authentication. Deploy the reviewed website
   source, then test production sign-in and waitlist approval, plus internal
   staging sign-in and public-signup rejection. Rebuild whenever AuthKit callback
   settings change.
3. **Stripe.** Configure separate test/live keys, webhook endpoints, recurring
   price IDs and return URLs. Complete approved-but-unsubscribed denial, checkout,
   confirmed subscription, failed-payment and cancellation acceptance before
   enabling `HOSTED_CHECKOUT_ENABLED`. Issue promotion codes manually to chosen
   recipients. Keep hosted coding agents disabled.
4. **DNS and managed host connections.** `mezair.dev` is not an accessible zone
   in this Cloudflare account. Zone `aa52d2318e7bb29a10e3d54c27153ca4` belongs to
   `anvilstack.dev`; it must not be used as a Mezair zone ID. Use the working
   workers.dev origins until the intended Mezair zone/DNS access is supplied.
   Custom domains and managed tunnels need a further explicit configuration and
   cross-network acceptance run. No managed tunnel token is installed.
5. **Release verification.** Review and commit the configuration changes, then
   use the manual production workflow on `main` with a recorded provider-evidence
   reference. Its current bootstrap policy preserves checkout and hosted agents
   as disabled. Complete the full production checklist before customer admission.

The previous planning snapshot is in
[production-deployment-plan.md](production-deployment-plan.md). This record
supersedes its pre-cutover resource inventory and staging-retention assumptions.
