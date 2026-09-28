import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AuthCard } from '@/components/shell/AuthCard';
import { Field, TextInput } from '@/components/ui';
import { useRegister } from '@/hooks/useAuth';
import { useMeta } from '@/hooks/useMeta';
import {
  SIGNUP_CLOSED_MESSAGE,
  authServerMessage,
  hasErrors,
  registerErrors,
  usernameError,
  type FieldErrors,
  type RegisterField,
} from '@/lib/authForms';

/**
 * `/register` (Sections 2.1.3 and 5.2). The form is replaced by the closed message when
 * `GET /api/meta` reports `signup_enabled: false`; the server enforces the same rule with a
 * 403 `signup_disabled`, which maps to the very same sentence.
 */
export function RegisterPage(): ReactElement {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const register = useRegister();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const footer = <Link to="/login">Already have an account? Log in</Link>;

  if (meta !== undefined && !meta.signup_enabled) {
    return (
      <AuthCard heading="Sign up to continue" footer={footer}>
        <p>{SIGNUP_CLOSED_MESSAGE}</p>
      </AuthCard>
    );
  }

  const submit = (): void => {
    const found = registerErrors({ fullName, email, username, password });
    setErrors(found);
    setServerError(undefined);
    if (hasErrors(found)) return;

    register.mutate(
      { full_name: fullName.trim(), email: email.trim(), username, password },
      {
        onSuccess: () => navigate('/', { replace: true }),
        onError: (error) =>
          setServerError(
            error instanceof ApiError
              ? authServerMessage(error.status, error.code)
              : authServerMessage(0, 'network_error'),
          ),
      },
    );
  };

  return (
    <AuthCard
      heading="Sign up to continue"
      error={serverError}
      submit={{ label: 'Sign up', loading: register.isPending, onSubmit: submit }}
      footer={footer}
    >
      <Field label="Full name" error={errors.fullName}>
        {(control) => (
          <TextInput
            {...control}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Enter your full name"
            invalid={errors.fullName !== undefined}
            autoComplete="name"
          />
        )}
      </Field>

      <Field label="Email" error={errors.email}>
        {(control) => (
          <TextInput
            {...control}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            invalid={errors.email !== undefined}
            autoComplete="email"
          />
        )}
      </Field>

      <Field
        label="Username"
        helper="lowercase letters, numbers and _ only, 3-32"
        error={errors.username}
      >
        {(control) => (
          <TextInput
            {...control}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onBlur={() =>
              setErrors((current) => ({ ...current, username: usernameError(username) }))
            }
            invalid={errors.username !== undefined}
            autoComplete="username"
          />
        )}
      </Field>

      <Field label="Password" helper="8 characters minimum" error={errors.password}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={errors.password !== undefined}
            autoComplete="new-password"
          />
        )}
      </Field>
    </AuthCard>
  );
}
