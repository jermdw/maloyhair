import type { E164Phone } from '@/types/firestore'

/**
 * Normalizes a US phone number to E.164 (e.g. "+14045551234"). Returns null
 * (rather than throwing) for anything that doesn't reduce to a clean
 * 10-digit US number, so callers can show an inline validation error.
 */
export function normalizePhone(input: string): E164Phone | null {
  let digits = input.replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }

  if (digits.length !== 10) return null

  return `+1${digits}`
}

/** Formats an E.164 US number back to "(404) 555-1234" for display. */
export function formatPhoneDisplay(e164: E164Phone): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  if (!match) return e164
  const [, area, prefix, line] = match
  return `(${area}) ${prefix}-${line}`
}
