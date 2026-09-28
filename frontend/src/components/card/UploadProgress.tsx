import type { ReactElement } from 'react';
import { cx } from '@/components/ui';
import styles from './UploadProgress.module.css';

export interface UploadProgressProps {
  /** The file being sent; it names the bar for assistive tech. */
  name: string;
  /** `0..1` of the bytes on the wire, or null before the browser reports a total. */
  progress: number | null;
}

/**
 * The 4px bar a `PendingUpload` paints while its bytes are on the wire (Sections 2.6.3 and 5.8).
 *
 * It is one component because the same bar is documented in two places — under the 112x80
 * thumbnail of `AttachmentsSection`'s pending row and inside `AttachmentPopover` — and both read
 * the same `upload.onprogress` fraction from `useUploadAttachments`. A browser that reports no
 * total leaves the fraction null, which is an indeterminate bar rather than a stuck 0%.
 */
export function UploadProgress({ name, progress }: UploadProgressProps): ReactElement {
  const percent = progress === null ? null : Math.round(progress * 100);

  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={`Uploading ${name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={cx(styles.fill, percent === null && styles.indeterminate)}
        // A runtime value, which is the one inline-style exception of CLAUDE.md section 5.
        style={percent === null ? undefined : { width: `${String(percent)}%` }}
      />
    </div>
  );
}
