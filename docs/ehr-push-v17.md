# EHR push notifications — v17

Generic Web Push notifications open the authenticated encounter inbox. No Twilio account, SMS sender, phone number or Apple Developer subscription is required. This build is for the synthetic EHR; production use needs its own security, privacy and clinical validation.

## Physician setup

1. Open the EHR preview. On iPhone/iPad, use Safari → Share → Add to Home Screen. Open KidneyCare from that icon and sign in. Desktop Chrome, Firefox and supported Safari can use the site directly.
2. Open **Encounter inbox → EHR push notifications**, or tell the orchestrator **“Open push alerts.”**
3. Check the consent box and select **Enable on this device**. Allow notifications when the browser asks.
4. Select **Send a test notification now**. Allow about a minute for the background sender; check the actual device. The test bypasses automatic quiet hours.
5. Tap the notification to open the inbox. Sign in if your session has ended. Review and approve clinical work inside the EHR.

Notification text is always “A review needs your attention. Sign in to your EHR.” Names, chart details, encounter IDs and approval tokens never enter the push payload or service worker. Browser settings, Focus mode, connectivity and platform delivery can delay or suppress alerts. Provider acceptance does not prove device receipt or physician review. These alerts are not emergency monitoring.

Quiet hours default to 10 PM–7 AM in the selected time zone and apply to automatic alerts. Save changes using **Save settings / reconnect** with the consent box checked. Up to five devices can be connected. **Turn off this device**, **Turn off all my devices**, and explicit sign-out revoke registrations. A notification already accepted by a provider can still arrive within its five-minute TTL. Removing the Home Screen app, clearing browser data or changing platform permissions may require reconnecting.

## Implementation

Private, RLS-enabled tables store clinician preferences, explicitly consented browser subscriptions, delivery state, immutable audit events, short-lived dispatch capabilities and stable VAPID keys. Anonymous and authenticated database roles have no direct grants. VAPID keys are generated once inside an authorized gateway request; only the public key reaches the browser. Subscription endpoints and keys are not returned in gateway responses.

`push-alerts-gated` validates the actual signed-in synthetic clinician and active physician permissions. Device mutations use preference versions, owner checks and a five-device limit. Subscriptions accept valid P-256 keys and HTTPS endpoints only at the exact Google, Mozilla and Apple push hosts; redirects are forbidden. Sign-out revokes the current device before clearing the Auth session where possible and unsubscribes locally. Late permission and API results are discarded after account changes.

The minute cron calls `ehr.dispatch_push_alerts()`. It queues unseen ready/failed/expired revisions of the clinician’s current draft, deduplicates each revision/device and issues a single-use, two-minute capability for `push-alert-worker`. The worker uses custom capability authentication, rejects browser origins and accepts only the exact dispatch ID shape. Before sending, it rechecks active clinician/assignment, current encounter source and job revision, inbox seen state, device consent/version and preference version. Opt-out and these checks share database locks with the send boundary.

Automatic sends honor quiet hours and a per-device limit of one every two minutes, three per hour and ten per day. Tests have a separate one-per-minute limit. A durable sending state precedes the provider request; timeouts become **unknown** with no automatic resend. HTTP 404/410 deactivates expired subscriptions. Clinical alerts expire after 24 hours; tests after five minutes. The pinned `web-push@3.6.7` package creates encrypted RFC 8291 requests; native fetch submits them with a five-minute TTL. Provider acceptance is recorded as **accepted**, never “delivered.”

The scoped service worker has no caching, chart API, credential storage or clinical actions. It ignores incoming payload contents, renders fixed generic text and opens only the same EHR scope with `#inbox`. The manifest and agent-dot icons support Home Screen installation. Both themes include touch-sized notification controls. SMS remains separately available as an optional configured integration; “Open SMS alerts” opens its panel.

## Validation and deployment

CI includes actual PostgreSQL driver tests for ownership, deduplication, concurrent sends, stale encounters, seen revisions, revoked access, device expiration, sign-out settings and dispatch replay. DOM tests cover consent, permission/account races and iPhone installation guidance. Chromium checks actual service-worker installation, themes and 1440/760/390/320-pixel layouts. The Deno runtime test generates actual P-256/VAPID keys and encrypted requests; network delivery is mocked. No real push is sent by automated tests.

Deploy `push-alerts-v17.sql`, the gateway with JWT verification enabled, and the worker with JWT verification disabled but mandatory single-use capability authentication. The function-local dependency lock is committed. After worker verification, apply `push-alerts-scheduler-v17.sql`. Publish the exact tested preview tree. Confirm clinical state counts/digest are unchanged and subscriptions remain zero until the physician opts in. Actual phone receipt must be checked using the on-device test after consent.

Platform documentation: [WebKit: Web Push for iOS/iPadOS Home Screen apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [MDN: PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [web-push reference](https://github.com/web-push-libs/web-push), [Supabase dependency management](https://supabase.com/docs/guides/functions/dependencies).
