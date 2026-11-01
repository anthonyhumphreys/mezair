# Hosted Sync deployment

The fresh Mezair staging and production resources were provisioned on
31 October 2026. Current identities, verified bootstrap behavior and remaining
operator steps are recorded in
[the environment cutover record](../../../../docs/hosted-environment-cutover.md).
The tracked hosted target manifests point to the new isolated environments.

Use the guarded staging workflow for internal Sync and Mesh testing.
Staging public signup and its waitlist are disabled; provision test identities
explicitly. Automatic staging deployment keeps checkout disabled. Production
waitlist approval permits signup; a valid subscription is required for new hosted
write access. The workflow deploys the existing staging backend
and applies D1 migrations. It does not
deploy the Mezair Cloud Agents provisioner or container image. Cloud Agents
remain disabled by default. Start with
[staging-next-steps.md](staging-next-steps.md) for the current
candidate and action sequence.

## Default staging deployment

The workflow is
[Hosted Sync staging backend](../../../../.github/workflows/sync-backend-staging.yml).
Pushes to `develop` deploy the backend when one of its configured paths changes.
Manual `workflow_dispatch` also supports `main` and uses
`managed_endpoint_pilot: false` by default. Both paths preserve the saved
staging managed endpoint setting, set checkout off,
force `MEZAIR_CLOUD_AGENTS_ENABLED` to false, review the guarded deployment
plan, migrate the existing staging D1 database, and apply the Worker.

The workflow uses the tracked `cloud/backend/hosted-targets.ci.json`, which
pins the existing staging Worker, D1 id, R2 bucket, descriptor, and WorkOS
clients. The staging database is not created by this procedure. The deployment
does not add a provisioner binding, build a container image, or start a
managed environment. Do not run `provisioner` commands for this release.

The local convenience template `cloud/backend/hosted-targets.example.json`
also defaults the managed provisioner off. It is not the staging workflow
manifest, which pins the exact staging target. Keep the provisioner disabled
for this release.

## Managed host tunnel staging setup

Managed host reachability is a separate feature from Mezair Cloud Agents. To
run the current staging rehearsal, save `MEZAIR_MESH_MANAGED_ENDPOINTS: "true"`
in `MEZAIR_STAGING_WORKER_VARS_JSON`. The protected `mezair-staging` environment must
provide `CLOUDFLARE_TUNNEL_ACCOUNT_ID`, `CLOUDFLARE_TUNNEL_ZONE_ID`, and
`CLOUDFLARE_TUNNEL_API_TOKEN`, with the token scoped to the required tunnel
operations in that account and zone. Required API permissions are account
Cloudflare Tunnel Edit and zone DNS Edit. Use a dedicated staging token.
Add the operator-controlled hostname domain as
the non-secret `MACHINE_ENDPOINT_DOMAIN` value in
`MEZAIR_STAGING_WORKER_VARS_JSON`. The workflow validates that domain and turns
on `MEZAIR_MESH_MANAGED_ENDPOINTS` in the staging Worker. Later automatic pushes
preserve the saved choice. The manual `managed_endpoint_pilot: true` input
also enables a single deployment without changing the saved configuration.

The selected Cloudflare account is `715060911f9418f1df0f9de0265d8a64`.
The previously documented zone `aa52d2318e7bb29a10e3d54c27153ca4` actually belongs
to `anvilstack.dev`, not `mezair.dev`. No Mezair zone is currently accessible to
this deployment login. Leave managed allocation disabled until the correct zone,
DNS permissions and controlled `MACHINE_ENDPOINT_DOMAIN` are configured. Each
allocation creates one host subdomain; existing website records are retained.
Account and zone IDs are identifiers, not authentication credentials, but the
deployment wrapper deliberately accepts them through the protected secret
source alongside the API token.

The dispatch updates backend configuration and supplies credentials to the
backend deployment. Desktop and daemon host connections are available by
default once the signed-in Sync scope is active. Supply
a trusted `cloudflared` binary installed through the host's normal software
process. The resolver does not download the binary or verify its file owner.
Without the controlled domain, scoped tunnel token, and trusted connector,
leave backend allocation off. Desktop previews target staging and discover
normal macOS Homebrew installations. See [host connections](host-connections.md) for host
setup and acceptance limits.

Do not put the tunnel token or other credentials in Worker variables, command
arguments, generated source, or this repository. Backend secret source
options are documented in [secret-inputs.md](secret-inputs.md).

## Verify staging

The workflow checks the deployed descriptor after applying the Worker. It
must advertise `mezair-backend/1`, `sync/2`, and `mesh/2`, along with the
current staging `workos-device` identity. A successful workflow proves
deployment and descriptor shape only. Complete the live gates in
[staging-acceptance.md](staging-acceptance.md), including two physical hosts
on separate WANs.

Keep automatic staging checkout disabled and hosted billing enforcement enabled.
Use a separately reviewed Stripe test-mode checkout deployment for the new paid
signup acceptance. Provision internal testers through WorkOS and have them
complete checkout using [hosted signup](beta-access.md). Admission is not a subscription entitlement.
Existing redeemed grants retain their expiry; the former global preview flag
does not grant access.
See [entitlement incidents](entitlement-incidents.md) for denied-write recovery.

## Production

Use `.github/workflows/sync-backend-production.yml` from `main` with the protected
`mezair-production` environment and a reviewed provider-evidence reference. The
production target is complete and distinct from staging. The bootstrap workflow
preserves billing enforcement and keeps checkout, hosted agents and managed
tunnels disabled. Configure and verify Stripe before changing that policy or
admitting customers. See the environment cutover record for credential setup and
the remaining website, DNS and release acceptance steps.

The production workflow needs `STAGING_SECRET_FINGERPRINTS_JSON` in the protected
environment's variables, rather than staging credential values. Regenerate this
comparison reference whenever staging credentials rotate; see
[secret inputs](secret-inputs.md). Production's three application credentials
are already installed. The separate Cloudflare deployment token is still needed.
