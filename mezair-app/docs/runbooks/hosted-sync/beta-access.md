# Hosted waitlist admission and Stripe checkout

Waitlist approval permits signup to the paid hosted service. It does not grant
Sync or Mesh writes, a subscription, or an automatic discount. Local Desktop
and self-hosted Sync & Mesh remain free.

## Admit a customer

1. Apply the hosted billing migrations through the selected deployment target.
2. Configure and verify this environment's Stripe prices, secrets, webhooks and
   fixed account/billing return URLs. Enable checkout only after the payment
   acceptance checks pass.
3. Approve the exact email on the same environment's WorkOS waitlist. WorkOS
   sends the invitation to complete signup. The backend verifies the configured
   client and the user's verified email before creating their hosted account.
4. The customer completes signup and opens `/account/billing`. An approved
   account can reach checkout without enrolling a Desktop device first.
5. The customer chooses a plan and completes Stripe checkout. Hosted writes
   become available only after confirmed subscription/invoice evidence reaches
   the backend. Account creation and checkout redirects grant no entitlement.

The planned end of closed signup is the end of November 2026. It is not a free
subscription deadline. Opening signup requires coordinated WorkOS and backend
admission configuration; merely changing public copy does not remove the
backend's approval check.

## Manual Stripe discounts

Create coupons and customer-facing promotion codes manually in the Stripe
dashboard for the selected environment. The operator chooses which recipients
receive them. Checkout enables Stripe's promotion-code field; discounts are
applied there as part of subscription signup. Waitlist approval does not
create, send or redeem a coupon.

Configure discount duration, applicable products, redemption deadlines and
customer/redemption limits deliberately. A promotion code's redemption deadline
is distinct from how long a subscription discount lasts. Stripe remains the
subscription authority, including when a discount reduces an invoice to zero.
See [Stripe checkout parameters](https://docs.stripe.com/api/checkout/sessions/create).

## Configure paid signup

Non-secret Worker variables:

- `STRIPE_PRICE_SYNC_MONTHLY` and `STRIPE_PRICE_SYNC_ANNUAL`, GBP £8.99 and £89.90.
- `STRIPE_PRICE_TEAM_MONTHLY` and `STRIPE_PRICE_TEAM_ANNUAL`, GBP £12 and £120 per seat.
- `HOSTED_CHECKOUT_SUCCESS_URL`, `HOSTED_CHECKOUT_CANCEL_URL` and
  `HOSTED_PORTAL_RETURN_URL`, all fixed HTTPS URLs returning to account billing.

Install matching-environment `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as
secrets. Only then set `HOSTED_CHECKOUT_ENABLED=true` in the reviewed target vars.
Keep `HOSTED_BILLING_ENFORCEMENT=true`. Automatic staging CI deliberately keeps
checkout off; use a separate reviewed Stripe test-mode deployment to rehearse
the paid flow. Never reuse staging credentials or prices in production.

Only confirmed paid invoice state advances `paid_through` and paid seat quantity.
Team checkout requires an active owner and 5 to 50 seats. Membership is not
shared workspace access. Existing subscriptions remain manageable through the
portal; this rollout does not cancel or refund them.

## Existing beta-code records

The former Mezair beta-code flow is no longer part of website signup. Existing
redeemed grants retain their recorded expiry and revocation behaviour for
compatibility. Do not issue new Mezair codes for this signup flow; use Stripe
promotion codes when a discount is intended. The old global preview flag does
not grant access.
