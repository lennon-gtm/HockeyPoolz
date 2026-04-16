# WhatsApp Daily Recap Opt-In — Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

Players can opt in to receive their personal daily recap as a WhatsApp message. Opt-in is per league — a player in two leagues can use different numbers for each. Phone number and consent are stored on `LeagueMember`. Delivery is triggered by the existing `generate-recaps` cron immediately after each per-member recap is generated.

---

## 1. Schema Changes

Two new fields on `LeagueMember`:

```prisma
whatsappPhone   String?  @map("whatsapp_phone")    // E.164 format, e.g. "+14165551234"
whatsappOptedIn Boolean  @default(false) @map("whatsapp_opted_in")
```

`whatsappPhone` stores the number in E.164 format (e.g. `+14165551234`). `whatsappOptedIn` is a separate flag so a player can store a number without activating delivery, and toggle it independently.

---

## 2. API Changes

### `PATCH /api/leagues/[id]/members/me`

Extend the existing endpoint to accept two new optional body fields:

```ts
whatsappPhone?: string | null   // null clears the number and disables opt-in
whatsappOptedIn?: boolean
```

Validation: if `whatsappPhone` is provided and non-null, it must match `/^\+[1-9]\d{7,14}$/` (E.164). Return 400 with `{ error: 'Invalid phone number format' }` otherwise.

When `whatsappPhone` is set to `null`, also set `whatsappOptedIn = false`.

---

## 3. UI — My Team Page (`/league/[id]/team`)

A `📲 Daily Recap on WhatsApp` card is added below the personal recap card.

### Unenrolled state
- Phone number input field, placeholder: `+1 416 555 1234`
- Consent line below input: *"By saving your number you agree to receive one daily recap message per league."*
- **Save** button — on submit: validates format client-side, calls `PATCH /api/leagues/[id]/members/me` with `{ whatsappPhone, whatsappOptedIn: true }`, shows success state on 200

### Enrolled state
- Masked number display: show first 3 and last 4 digits, mask the middle (e.g. `+1 416 ••• 1234`)
- Green pill: `✓ Active`
- **Remove** button — calls `PATCH` with `{ whatsappPhone: null }`, returns to unenrolled state

### Error state
- Inline error below input: `"Please enter a valid phone number with country code (e.g. +1 416 555 1234)"`

---

## 4. Delivery

### Trigger
In `lib/recap-service.ts`, inside `generateLeagueRecaps(leagueId)`, after a per-member recap is written to the database: if `member.whatsappOptedIn === true` and `member.whatsappPhone` is set, call `sendWhatsAppRecap(phone, leagueName, recapContent)`.

### Message format
```
[{leagueName}] {recapContent}
```

Example:
```
[Champs Pool 2026] What a night, BobsTeam. Makar put up two goals and...
```

### Twilio integration
New file: `lib/whatsapp-service.ts`

```ts
import twilio from 'twilio'

export async function sendWhatsAppRecap(to: string, leagueName: string, content: string) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
    to: `whatsapp:${to}`,
    body: `[${leagueName}] ${content}`,
  })
}
```

Errors are caught and logged per-member — a failed WhatsApp send does not fail recap generation for the rest of the league.

### New env vars required
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=+14155238886
```

`TWILIO_WHATSAPP_FROM` is the Twilio sandbox number during development. Swap for a production WhatsApp Business number once Meta approval is obtained.

### Production constraint
WhatsApp requires pre-approved message templates for proactive outbound messages in production. The Twilio sandbox bypasses this requirement and is fully functional for testing. Obtaining a production WhatsApp Business number and getting a message template approved through Meta is a separate operational step — estimated 2–5 business days.

---

## 5. Files Changed / Created

**Schema:**
- `prisma/schema.prisma` — add `whatsappPhone` and `whatsappOptedIn` to `LeagueMember`

**New files:**
- `lib/whatsapp-service.ts` — Twilio client, `sendWhatsAppRecap()` function

**Modified files:**
- `app/api/leagues/[id]/members/me/route.ts` — accept `whatsappPhone` and `whatsappOptedIn` fields, add E.164 validation
- `lib/recap-service.ts` — call `sendWhatsAppRecap` after each per-member recap is stored
- `app/(app)/league/[id]/team/page.tsx` — add WhatsApp opt-in card

---

## 6. Testing

- Unit test E.164 validation: valid numbers pass, invalid formats return 400
- Unit test `sendWhatsAppRecap`: mock Twilio client, verify message body includes league name prefix and recap content
- Verify delivery skip: `whatsappOptedIn = false` → `sendWhatsAppRecap` not called
- Verify error isolation: Twilio error on one member does not halt recap generation for others
