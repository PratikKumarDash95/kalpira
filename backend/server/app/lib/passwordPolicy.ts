export const PASSWORD_RULE_MESSAGE =
  'Password must be 6-10 characters and include 1 uppercase letter, 1 number, and 1 symbol.';

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 6 || password.length > 10) {
    return PASSWORD_RULE_MESSAGE;
  }

  if (!/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return PASSWORD_RULE_MESSAGE;
  }

  return null;
}
