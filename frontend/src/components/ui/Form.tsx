import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cx } from './classNames';
import styles from './Form.module.css';

/** What `Field` hands its control so the label, helper and error stay wired together. */
export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export interface FieldProps {
  /** 12px 700 label above the control (Section 2.1.3). */
  label: string;
  children: (control: FieldControlProps) => ReactNode;
  helper?: ReactNode;
  /** Validation message; renders in `--danger` under the control and sets `aria-invalid`. */
  error?: ReactNode;
}

/**
 * Label + control + helper/error, with the ids and ARIA wiring generated here so no caller
 * repeats it. The control is a render prop because cloning children to inject ids is fragile.
 */
export function Field({ label, children, helper, error }: FieldProps): ReactElement {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== null && error !== false;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': hasError ? errorId : helper === undefined ? undefined : helperId,
        'aria-invalid': hasError ? true : undefined,
      })}
      {hasError ? (
        <p className={styles.error} id={errorId}>
          {error}
        </p>
      ) : helper === undefined ? null : (
        <p className={styles.helper} id={helperId}>
          {helper}
        </p>
      )}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Paints the red border; `Field` passes `aria-invalid` separately. */
  invalid?: boolean;
}

/** The 36px text input of Section 2.9.1. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cx(styles.control, invalid && styles.invalid, className)}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
  invalid?: boolean;
}

/** A native select wearing the input styling. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, invalid = false, className, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cx(styles.control, styles.select, invalid && styles.invalid, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** Checkbox with its label to the right, e.g. "Start with default lists" (Section 2.2). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input ref={ref} type="checkbox" {...rest} />
      {label}
    </label>
  );
});
