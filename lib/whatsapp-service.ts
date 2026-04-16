import twilio from 'twilio'

/** Validate E.164 phone format: + followed by 8–15 digits. */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

/** Format the WhatsApp message body with league name prefix. */
export function formatWhatsAppMessage(leagueName: string, content: string): string {
  return `[${leagueName}] ${content}`
}

/** Send a recap to a WhatsApp number via Twilio. Throws on missing env vars or API error. */
export async function sendWhatsAppRecap(
  to: string,
  leagueName: string,
  content: string
): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM

  if (!accountSid || !authToken || !from) {
    throw new Error('Twilio env vars not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)')
  }

  const client = twilio(accountSid, authToken)
  await client.messages.create({
    from: `whatsapp:${from}`,
    to: `whatsapp:${to}`,
    body: formatWhatsAppMessage(leagueName, content),
  })
}
