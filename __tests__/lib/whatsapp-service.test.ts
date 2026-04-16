import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock twilio before importing the service
vi.mock('twilio', () => {
  const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM123' })
  const mockMessages = { create: mockCreate }
  const mockClient = { messages: mockMessages }
  return { default: vi.fn(() => mockClient) }
})

import twilio from 'twilio'
import { sendWhatsAppRecap, formatWhatsAppMessage, isValidE164 } from '../../lib/whatsapp-service'

describe('isValidE164', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isValidE164('+14165551234')).toBe(true)
    expect(isValidE164('+447911123456')).toBe(true)
    expect(isValidE164('+12125551234')).toBe(true)
  })

  it('rejects invalid formats', () => {
    expect(isValidE164('4165551234')).toBe(false)    // missing +
    expect(isValidE164('+1')).toBe(false)             // too short
    expect(isValidE164('+1416555')).toBe(false)       // too short
    expect(isValidE164('+')).toBe(false)
    expect(isValidE164('')).toBe(false)
  })
})

describe('formatWhatsAppMessage', () => {
  it('prefixes content with league name in brackets', () => {
    const msg = formatWhatsAppMessage('Champs Pool', 'Great night for BobsTeam!')
    expect(msg).toBe('[Champs Pool] Great night for BobsTeam!')
  })
})

describe('sendWhatsAppRecap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'
    process.env.TWILIO_AUTH_TOKEN = 'authtest'
    process.env.TWILIO_WHATSAPP_FROM = '+14155238886'
  })

  it('calls twilio messages.create with correct params', async () => {
    await sendWhatsAppRecap('+14165551234', 'Champs Pool', 'Great night!')
    const client = (twilio as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(client.messages.create).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+14165551234',
      body: '[Champs Pool] Great night!',
    })
  })

  it('throws if TWILIO_ACCOUNT_SID is missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    await expect(sendWhatsAppRecap('+14165551234', 'Test', 'msg')).rejects.toThrow()
  })
})
