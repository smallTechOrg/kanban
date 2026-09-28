import { useState, type FormEvent, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import type { ProfileInput } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { User } from '@/api/types';
import { Button, Field, Modal, TextInput } from '@/components/ui';
import { useUpdateProfile } from '@/hooks/useAuth';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/hooks/useToast';
import { fullNameError, hasErrors, passwordError } from '@/lib/authForms';
import styles from './ProfileModal.module.css';

/** Section 2.1.1: the account modal is 400px wide. */
const MODAL_WIDTH = 400;

export interface ProfileModalProps {
  user: User;
  onClose: () => void;
}

interface ProfileFields {
  fullName: string;
  currentPassword: string;
  newPassword: string;
}

type ProfileErrors = Partial<Record<keyof ProfileFields, string>>;

/** Both password fields are optional, but each one requires the other (Section 2.1.1). */
function profileErrors({ fullName, currentPassword, newPassword }: ProfileFields): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = fullNameError(fullName);
  if (name !== undefined) errors.fullName = name;

  if (newPassword !== '') {
    const password = passwordError(newPassword);
    if (password !== undefined) errors.newPassword = password;
    if (currentPassword === '') errors.currentPassword = 'Enter your current password.';
  } else if (currentPassword !== '') {
    errors.newPassword = 'Enter a new password.';
  }
  return errors;
}

/**
 * "Account settings" from the user menu: full name, the eight avatar swatches of
 * `AVATAR_COLORS` (served by `GET /api/meta`), and the optional password change, all saved
 * with one `PATCH /api/auth/me`. A 400 means the current password was wrong, and that
 * belongs under its field rather than in a toast.
 */
export function ProfileModal({ user, onClose }: ProfileModalProps): ReactElement {
  const { data: meta } = useMeta();
  const updateProfile = useUpdateProfile();
  const { show } = useToast();

  const [fullName, setFullName] = useState(user.full_name);
  const [avatarColor, setAvatarColor] = useState(user.avatar_color);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<ProfileErrors>({});

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const found = profileErrors({ fullName, currentPassword, newPassword });
    setErrors(found);
    if (hasErrors(found)) return;

    const patch: ProfileInput = {};
    if (fullName.trim() !== user.full_name) patch.full_name = fullName.trim();
    if (avatarColor !== user.avatar_color) patch.avatar_color = avatarColor;
    if (newPassword !== '') {
      patch.password = newPassword;
      patch.current_password = currentPassword;
    }

    updateProfile.mutate(patch, {
      onSuccess: () => {
        show('Profile saved');
        onClose();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 400) {
          setErrors({ currentPassword: 'Current password is incorrect.' });
          return;
        }
        show("Couldn't save your profile.", 'error');
      },
    });
  };

  return (
    <Modal title="Account settings" onClose={onClose} width={MODAL_WIDTH}>
      <form className={styles.form} onSubmit={save} noValidate>
        <Field label="Full name" error={errors.fullName}>
          {(control) => (
            <TextInput
              {...control}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              invalid={errors.fullName !== undefined}
              autoComplete="name"
            />
          )}
        </Field>

        <div className={styles.swatchField}>
          <span className={styles.label}>Avatar colour</span>
          <div className={styles.swatches} role="group" aria-label="Avatar colour">
            {(meta?.avatar_colors ?? []).map((color, index) => (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                aria-label={`Avatar colour ${index + 1}`}
                aria-pressed={color === avatarColor}
                onClick={() => setAvatarColor(color)}
              >
                {color === avatarColor ? (
                  <Check className={styles.check} aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <Field label="Current password" error={errors.currentPassword}>
          {(control) => (
            <TextInput
              {...control}
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              invalid={errors.currentPassword !== undefined}
              autoComplete="current-password"
            />
          )}
        </Field>

        <Field label="New password" helper="8 characters minimum" error={errors.newPassword}>
          {(control) => (
            <TextInput
              {...control}
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              invalid={errors.newPassword !== undefined}
              autoComplete="new-password"
            />
          )}
        </Field>

        <Button type="submit" variant="primary" loading={updateProfile.isPending}>
          Save
        </Button>
      </form>
    </Modal>
  );
}
