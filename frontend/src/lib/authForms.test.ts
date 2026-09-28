import { describe, expect, it } from 'vitest';
import {
  SIGNUP_CLOSED_MESSAGE,
  authServerMessage,
  fullNameError,
  hasErrors,
  loginErrors,
  passwordError,
  registerErrors,
  usernameError,
} from './authForms';

describe('passwordError', () => {
  it('rejects a short password and accepts an eight character one', () => {
    expect(passwordError('short')).toMatch(/at least 8/);
    expect(passwordError('longenough')).toBeUndefined();
  });

  it('rejects a password over the 128 character maximum', () => {
    expect(passwordError('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordError('x'.repeat(128))).toBeUndefined();
  });
});

describe('fullNameError', () => {
  it('requires a non-blank name within 128 characters', () => {
    expect(fullNameError('   ')).toBe('Full name is required.');
    expect(fullNameError('a'.repeat(129))).toMatch(/at most 128/);
    expect(fullNameError('Vivek Sharma')).toBeUndefined();
  });
});

describe('usernameError', () => {
  it('requires the lowercase pattern of Section 2.1.3', () => {
    expect(usernameError('')).toBe('Username is required.');
    expect(usernameError('Vivek')).toMatch(/lowercase/);
    expect(usernameError('ab')).toMatch(/lowercase/);
    expect(usernameError('vivek_1')).toBeUndefined();
  });
});

describe('loginErrors', () => {
  it('reports both fields when the form is empty', () => {
    expect(loginErrors({ identifier: ' ', password: '' })).toEqual({
      identifier: 'Enter your email or username.',
      password: 'Enter your password.',
    });
  });

  it('reports nothing once both are filled in', () => {
    expect(loginErrors({ identifier: 'admin', password: 'hunter22' })).toEqual({});
  });
});

describe('registerErrors', () => {
  it('reports every invalid field at once', () => {
    const errors = registerErrors({ fullName: '', email: 'nope', username: 'NOPE', password: 'x' });

    expect(Object.keys(errors).sort()).toEqual(['email', 'fullName', 'password', 'username']);
  });

  it('requires the email, which the pages only check for an @', () => {
    const errors = registerErrors({
      fullName: 'Vivek Sharma',
      email: '',
      username: 'vivek',
      password: 'hunter22',
    });

    expect(errors).toEqual({ email: 'Email is required.' });
  });

  it('reports nothing for a valid form', () => {
    expect(
      registerErrors({
        fullName: 'Vivek Sharma',
        email: 'vivek@example.com',
        username: 'vivek',
        password: 'hunter22',
      }),
    ).toEqual({});
  });
});

describe('hasErrors', () => {
  it('ignores undefined entries', () => {
    expect(hasErrors({ identifier: undefined })).toBe(false);
    expect(hasErrors({ identifier: undefined, password: 'boom' })).toBe(true);
  });
});

describe('authServerMessage', () => {
  it('maps every status Section 2.1.3 names', () => {
    expect(authServerMessage(401, 'unauthorized')).toBe('Incorrect email/username or password.');
    expect(authServerMessage(403, 'signup_disabled')).toBe(SIGNUP_CLOSED_MESSAGE);
    expect(authServerMessage(409, 'conflict')).toBe('That email or username is already taken.');
    expect(authServerMessage(429, 'rate_limited')).toMatch(/Too many attempts/);
  });

  it('falls back for a status it does not know', () => {
    expect(authServerMessage(403, 'forbidden')).toBe('Something went wrong. Please try again.');
    expect(authServerMessage(500, 'internal_error')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
