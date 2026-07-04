/**
 * Normalizes a Brazilian phone number (in whatever format a checkout platform sends it —
 * with/without country code, spaces, dashes, parentheses) into a WhatsApp chat ID.
 * WhatsApp expects `55` + 2-digit DDD + 8/9-digit number = 12 or 13 digits total.
 */
export function normalizeBrazilianPhoneToChatId(rawPhone: string | undefined | null): string | null {
  if (!rawPhone) return null;
  let digits = rawPhone.replace(/\D/g, '');
  if (!digits) return null;

  if (!digits.startsWith('55') || (digits.length !== 12 && digits.length !== 13)) {
    digits = `55${digits}`;
  }

  if (digits.length !== 12 && digits.length !== 13) return null;
  return `${digits}@c.us`;
}
