/** Validate E.164 phone format: + followed by 8–15 digits. */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

/** Format the WhatsApp message body with league name prefix. */
export function formatWhatsAppMessage(leagueName: string, content: string): string {
  return `[${leagueName}] ${content}`
}

/** Send a recap to a WhatsApp number via Meta Cloud API. Throws on missing env vars or API error. */
export async function sendWhatsAppRecap(
  to: string,
  leagueName: string,
  content: string
): Promise<void> {
  // Hard kill-switch — set to "false" while waiting on Meta business
  // number approval so recap runs don't spew (#131030) sandbox errors.
  if (process.env.WHATSAPP_ENABLED === 'false') return

  const token = process.env.META_WHATSAPP_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID

  if (!token || !phoneNumberId) {
    throw new Error('Meta WhatsApp env vars not configured (META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID)')
  }

  const body = formatWhatsAppMessage(leagueName, content)

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta WhatsApp API error: ${res.status} ${err}`)
  }
}
