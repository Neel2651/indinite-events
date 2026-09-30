/**
 * Company details used in the privacy policy, booking terms and refund policy.
 * Fill in the bracketed values (or set the env vars) before the live launch, and have the policies reviewed
 * by a solicitor.
 */
export const LEGAL = {
  tradingName: "Indinite",
  legalName: process.env.LEGAL_ENTITY_NAME || "[Indinite legal entity name]",
  icoNumber: process.env.LEGAL_ICO_NUMBER || "[ICO registration number]",
  supportEmail: process.env.LEGAL_SUPPORT_EMAIL || "contact@indinite.co.uk",
  privacyEmail: process.env.LEGAL_PRIVACY_EMAIL || "privacy@indinite.co.uk",
  lastUpdated: "1 October 2026",
} as const;
