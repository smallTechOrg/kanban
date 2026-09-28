import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui';
import styles from './AuthCard.module.css';

export interface AuthCardSubmit {
  /** "Log in" / "Sign up". */
  label: string;
  loading?: boolean;
  onSubmit: () => void;
}

export interface AuthCardProps {
  /** "Log in to continue" / "Sign up to continue" (Section 2.1.3). */
  heading: string;
  /** Server-error copy, shown above the fields (Section 2.1.3). */
  error?: string;
  children: ReactNode;
  /** The link to the other auth page. */
  footer: ReactNode;
  /** Wraps the children in a form with a full-width primary button. Omitted by the
   *  "Sign-ups are closed" card, which has no form to submit. */
  submit?: AuthCardSubmit;
}

/**
 * The frame both auth pages share (Section 2.1.3): the page background, a centred 400px
 * white card, the brand wordmark, the heading, the stacked fields and the footer link.
 */
export function AuthCard({
  heading,
  error,
  children,
  footer,
  submit,
}: AuthCardProps): ReactElement {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.wordmark}>Kan Ban</p>
        <h1 className={styles.heading}>{heading}</h1>
        {error === undefined ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {submit === undefined ? (
          children
        ) : (
          <form
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit.onSubmit();
            }}
          >
            {children}
            <Button type="submit" variant="primary" fullWidth loading={submit.loading ?? false}>
              {submit.label}
            </Button>
          </form>
        )}
        <p className={styles.footer}>{footer}</p>
      </div>
    </main>
  );
}
