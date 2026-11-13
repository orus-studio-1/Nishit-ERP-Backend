// The single password rule for the whole app. The website mirrors it in
// Nishit-erp-fe/src/lib/passwordPolicy.ts — keep the two in step.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_RULE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol.`;

export function passwordValidationMessage(value: unknown): string | null {
  const password = String(value || '');
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_RULE;
  if (!/[a-z]/.test(password)) return PASSWORD_RULE;
  if (!/[A-Z]/.test(password)) return PASSWORD_RULE;
  if (!/\d/.test(password)) return PASSWORD_RULE;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_RULE;
  return null;
}
