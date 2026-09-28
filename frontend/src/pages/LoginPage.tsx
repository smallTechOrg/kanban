import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AuthCard } from '@/components/shell/AuthCard';
import { Field, TextInput } from '@/components/ui';
import { useLogin } from '@/hooks/useAuth';
import { useMeta } from '@/hooks/useMeta';
import {
  authServerMessage,
  hasErrors,
  loginErrors,
  type FieldErrors,
  type LoginField,
} from '@/lib/authForms';

/**
 * `/login` (Sections 2.1.3 and 5.2). Redirects to the `next` parameter the shell's guard
 * set, defaulting to `/`. With `KANBAN_SINGLE_USER=1` the identifier is prefilled with
 * `meta.admin_username`.
 */
export function LoginPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const login = useLogin();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({});
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const prefilled = useRef(false);

  // The single-user prefill happens once, so it never overwrites what the user typed.
  useEffect(() => {
    if (prefilled.current || meta === undefined || !meta.single_user) return;
    prefilled.current = true;
    setIdentifier(meta.admin_username);
  }, [meta]);

  const submit = (): void => {
    const found = loginErrors({ identifier, password });
    setErrors(found);
    setServerError(undefined);
    if (hasErrors(found)) return;

    login.mutate(
      { email_or_username: identifier.trim(), password },
      {
        onSuccess: () => navigate(searchParams.get('next') ?? '/', { replace: true }),
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
      heading="Log in to continue"
      error={serverError}
      submit={{ label: 'Log in', loading: login.isPending, onSubmit: submit }}
      footer={<Link to="/register">Create an account</Link>}
    >
      <Field label="Email or username" error={errors.identifier}>
        {(control) => (
          <TextInput
            {...control}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Enter your email or username"
            invalid={errors.identifier !== undefined}
            autoComplete="username"
          />
        )}
      </Field>

      <Field label="Password" error={errors.password}>
        {(control) => (
          <TextInput
            {...control}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            invalid={errors.password !== undefined}
            autoComplete="current-password"
          />
        )}
      </Field>
    </AuthCard>
  );
}
