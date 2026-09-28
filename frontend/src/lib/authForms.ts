/**
 * The client-side rules of the auth forms (Section 2.1.3) and the copy every server error
 * maps to. Pure, so both auth pages and `ProfileModal` share one copy of each rule and the
 * mirror of Section 4.2 lives in exactly one place.
 */

/** Section 4.2: 8-128 characters. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** Section 4.2: `full_name` is 1-128 characters. */
const FULL_NAME_MAX = 128;

/** Section 2.1.3: lowercase letters, numbers and `_` only, 3-32. */
const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

/** Shown instead of the register form when `meta.signup_enabled === false`. */
export const SIGNUP_CLOSED_MESSAGE = 'Sign-ups are closed. Ask the board admin for an account.';

/** One message per field name, absent when the field is valid. */
export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export type LoginField = 'identifier' | 'password';
export type RegisterField = 'fullName' | 'email' | 'username' | 'password';

export interface LoginFields {
  identifier: string;
  password: string;
}

export interface RegisterFields {
  fullName: string;
  email: string;
  username: string;
  password: string;
}

function isBlank(value: string): boolean {
  return value.trim() === '';
}

/** The 8-128 rule, shared by the register form and the "New password" of `ProfileModal`. */
export function passwordError(value: string): string | undefined {
  if (value.length < PASSWORD_MIN) return 'Password must be at least 8 characters.';
  if (value.length > PASSWORD_MAX) return 'Password must be at most 128 characters.';
  return undefined;
}

/** The 1-128 rule of `full_name`, shared with the "Full name" of `ProfileModal`. */
export function fullNameError(value: string): string | undefined {
  if (isBlank(value)) return 'Full name is required.';
  if (value.trim().length > FULL_NAME_MAX) return 'Full name must be at most 128 characters.';
  return undefined;
}

/** Checked on blur as well as on submit (Section 2.1.3). */
export function usernameError(value: string): string | undefined {
  if (isBlank(value)) return 'Username is required.';
  if (!USERNAME_PATTERN.test(value)) {
    return 'Use lowercase letters, numbers and _ only, 3-32 characters.';
  }
  return undefined;
}

/** The server validates with `EmailStr`; the client only insists on an `@` (Section 2.1.3). */
function emailError(value: string): string | undefined {
  if (isBlank(value)) return 'Email is required.';
  if (!value.includes('@')) return 'Enter an email address.';
  return undefined;
}

/** Both login fields are simply required. */
export function loginErrors({ identifier, password }: LoginFields): FieldErrors<LoginField> {
  const errors: FieldErrors<LoginField> = {};
  if (isBlank(identifier)) errors.identifier = 'Enter your email or username.';
  if (password === '') errors.password = 'Enter your password.';
  return errors;
}

/** Every register rule of the Section 2.1.3 table. */
export function registerErrors(fields: RegisterFields): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  const fullName = fullNameError(fields.fullName);
  const email = emailError(fields.email);
  const username = usernameError(fields.username);
  const password = passwordError(fields.password);
  if (fullName !== undefined) errors.fullName = fullName;
  if (email !== undefined) errors.email = email;
  if (username !== undefined) errors.username = username;
  if (password !== undefined) errors.password = password;
  return errors;
}

/** Whether a rules object reported anything. */
export function hasErrors(errors: Readonly<Record<string, string | undefined>>): boolean {
  return Object.values(errors).some((message) => message !== undefined);
}

/**
 * The server-error copy of Section 2.1.3. It takes the status and the envelope code rather
 * than the `ApiError` itself, because lib/ never imports api/.
 */
export function authServerMessage(status: number, code: string): string {
  if (status === 401) return 'Incorrect email/username or password.';
  if (status === 403 && code === 'signup_disabled') return SIGNUP_CLOSED_MESSAGE;
  if (status === 409) return 'That email or username is already taken.';
  if (status === 429) return 'Too many attempts. Try again in a few minutes.';
  return 'Something went wrong. Please try again.';
}
