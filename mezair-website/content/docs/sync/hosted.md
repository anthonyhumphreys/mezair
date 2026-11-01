---
title: Mezair-hosted sync
navTitle: Mezair-hosted sync
description: Hosted Sync & Mesh availability, pricing, sign-in, devices and billing.
product: Mezair Sync & Mesh
section: Reference
journey: reference
order: 110
---

# Mezair-hosted sync

Mezair-hosted Sync & Mesh runs the backend for you. Access is currently an
invite-only beta. Waitlist approval lets you create an account and subscribe;
hosted Sync & Mesh requires an active subscription. Paid signup and production hosting are not available yet.
[Request beta access](/waitlist) to join.

Planned prices are £8.99 a month or £89.90 a year for one person, and £12 per
team member a month. See [pricing](/pricing) for the current plans.

You can also [run the same backend in your own Cloudflare account](/docs/sync/self-deploy)
without paying Mezair. Your infrastructure provider bills you directly.

## Sign in

- **Desktop:** Open Settings → Sync & Mesh and choose **Sign in to Mezair**.
- **Web:** Open [your account](/account) to manage billing and devices.
- **Headless daemon:** Run the command below, open the sign-in URL on another
  device, and enter the displayed code.

```sh
mezair-daemon sign-in --api-url https://<backend>
```

After signing in, run `mezair-daemon run` to start the host. Add `--worker`
to sign-in only if you want that machine to accept Mesh jobs.

New hosted accounts use automatic device connection by default. A trusted
device must be online to deliver the account key. For an independent code
comparison before each device joins, choose **Verify each device with a code**
in Settings → Sync & Mesh. See [Devices and sign-in](/docs/sync/devices).

Signing in to the website does not enroll a Desktop device. Each device has
its own revocable credential.

## Beta access and billing

Once your waitlist request is approved, follow the invitation email and finish
signup with the approved email address. Choose a subscription on the
[billing page](/account/billing) and complete Stripe checkout. Approval permits
signup; hosted Sync & Mesh starts when the subscription is confirmed.

Signup is invite-only until full public launch. If you have a Stripe promotion
code, apply it during checkout.

When paid signup opens, a personal subscription or an assigned paid team seat
will provide hosted access. Team checkout requires an organisation owner and
at least five seats. Organisation membership does not share workspaces,
devices or Sync data.

Existing subscribers can use the billing portal to review invoices and cancel.
Checkout redirects alone do not activate access; payment must be confirmed.

When access ends, local work, pulls, exports, device revocation and account
deletion remain available. New hosted writes, Mesh job submissions and handoffs
stop. See [Status and limits](/docs/sync/status-and-limits).

## Manage your account

| Page | What you can do |
| --- | --- |
| [Account](/account) | Check access and the limits that apply to your account. |
| [Devices](/account/devices) | Rename and revoke enrolled devices. |
| [Billing](/account/billing) | Choose a subscription, check hosted access and manage payments. |
| [Organisations](/account/organizations) | Manage membership, invitations, roles and team billing. |
| [Data](/account/data) | Export your data or request account deletion. |

Revoking a device from the website disconnects it. A surviving trusted device
rotates the account key when it learns of the revocation; an offline device
waits until it reconnects. See [Devices and sign-in](/docs/sync/devices).

## Related

- [Self-deploy the backend](/docs/sync/self-deploy)
- [Encryption and keys](/docs/sync/encryption)
- [Data portability](/docs/sync/data-portability)
