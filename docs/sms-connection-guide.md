# Connect real phone alerts (Twilio)

The synthetic preview already has the alert worker, secure review links, phone verification, consent controls, quiet hours and delivery history. Activation requires your own Twilio account and a verified mobile number. Enter provider secrets in Supabase, never in chat, the browser configuration, or GitHub.

## 1. Prepare your Twilio account and SMS sender

Sign in at https://console.twilio.com/ (or create an account). Copy the **Account SID** (`AC…`) and **Auth Token** from the account dashboard into your secure credential manager.

Choose an SMS-capable sender. For a US trial account, Twilio's Messaging Services tutorial requires a toll-free number; complete toll-free verification before using it for alerts. A paid account using a US local ten-digit sender requires the applicable A2P 10DLC registration. A trial account can message only verified recipient numbers; verify your own mobile in Twilio's console as well as in the app. Carrier registration can take time, so the app remains usable in preview mode meanwhile.

## 2. Create the alert Messaging Service

In Twilio, open **Messaging → Services → Create Messaging Service**. Name it **KidneyCare clinician alerts**, choose the appropriate notification use case, then open **Sender Pool → Add Senders** and attach your registered SMS-capable number. Save the **Messaging Service SID** (`MG…`).

No inbound webhook or status callback URL is required for this implementation: the worker polls Twilio's message status. Twilio handles STOP suppression for the sender; you can also turn delivery off in the app. This connection does not approve clinical actions by SMS.

## 3. Create a separate Verify Service

Open Twilio's **Verify** console, create a service named **KidneyCare**, and enable SMS verification. The default **6-digit** code length works with the app. Save the **Verify Service SID** (`VA…`). The Verify service sends one-time verification codes; the `MG…` service sends encounter alerts. Verify does not require adding your alert sender to its own service.

## 4. Generate the contact encryption key locally

On Windows PowerShell, run the following to generate a random 32-byte key represented by 64 hexadecimal characters. Paste its output only into the Supabase secret field below, and store a secure backup. Preserve this key; changing it requires users to reverify saved phone contacts.

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
```

## 5. Add the six Supabase secrets

Open https://supabase.com/dashboard/project/excqvjpsmdxzhujsbkmz → **Edge Functions → Secrets**. Add these keys and values. Set `SMS_DELIVERY_MODE` last, when both Twilio services and the sender are ready.

| Secret name | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Your account SID beginning `AC` |
| `TWILIO_AUTH_TOKEN` | Your account Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | The alert service SID beginning `MG` |
| `TWILIO_VERIFY_SERVICE_SID` | The verification service SID beginning `VA` |
| `SMS_CONTACT_ENCRYPTION_KEY` | The 64-character hexadecimal key generated above |
| `SMS_DELIVERY_MODE` | `twilio` |

Click **Save**, then reload the EHR preview. The deployed functions read these secrets at runtime; no application code edit is needed. Until every setting is valid, SMS is unavailable and the app offers preview delivery.

## 6. Verify and opt in through the EHR

1. Open https://kidneycareclinic-star.github.io/mel-test/preview/?v=14 and sign in as your assigned clinician.
2. Open **Encounter inbox → Phone alerts** (or say **“Open phone alerts”**).
3. Enter your US mobile as `+1` followed by ten digits, acknowledge verification-message consent, and press **Send verification code**.
4. Enter the six-digit code and press **Verify phone**.
5. Set **Delivery → Text my verified phone**, enable the alert types you want, acknowledge alert consent, and press **Save alert preferences**.
6. Set your time zone and quiet-hour preference. Quiet hours are 10 p.m.–7 a.m. in the selected zone when enabled.

The current app supports US mobile numbers. On Twilio trial, your recipient must also be verified in Twilio; the in-app check does not remove that trial restriction.

## 7. Test a real alert with synthetic encounter content

Record or type synthetic encounter text, correct it, and save it as a reviewed source. Let the orchestrator prepare the draft; leave it ready for review. The minute scheduler queues eligible ready/paused encounter notifications subject to your preferences, quiet hours, the current job revision, spacing and daily/hourly limits.

Check **Phone alerts → Recent alerts**. **Accepted/sent** means Twilio accepted or sent it; **delivered** appears only after a carrier delivery status is reported and polled. Open the secure link, sign in, and verify that it opens the current authorized encounter. The alert contains generic status and a secure link, with no patient name, lab result or note text. Signing remains inside the EHR.

**Run alert preview always displays a preview and never sends a text**, even when SMS delivery is enabled. Use a new eligible synthetic encounter job to test real alert delivery. Verification itself sends a real one-time code once the provider is configured and you submit its consent form.

## Troubleshooting

- **Connection controls are missing:** reload after saving all six secrets; confirm the exact names and SID prefixes.
- **Code does not arrive:** check the mobile format, Twilio's verified-recipient list on trial, Verify SMS settings, account balance and Twilio Verify logs. The app accepts four- to ten-digit Verify codes.
- **Alerts do not arrive:** confirm a sender is attached to the `MG…` service and its registration is approved; verify the phone, select SMS delivery, save consent, check quiet hours and inspect delivery history/Twilio messaging logs. A rate-limited alert waits; a stale encounter revision is not sent.
- **History says sent:** wait for carrier status polling; sent is not proof of delivery.
- **Stop alerts:** change Delivery to preview/off and save preferences, or reply STOP to Twilio's sender. Clearing the saved phone also returns the app to preview mode.

This remains a synthetic demonstration. Clinical deployment and use of real patient data require a separate production privacy, security and clinical validation process.

## Primary documentation (checked October 5, 2026)

- Messaging Service creation and sender setup: https://www.twilio.com/docs/messaging/tutorials/send-messages-with-messaging-services
- Trial account restrictions: https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account
- Verify Service creation and code length: https://www.twilio.com/docs/verify/quickstarts/node-express
- US local-number registration: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart
- Supabase server secrets: https://supabase.com/docs/guides/functions/secrets
