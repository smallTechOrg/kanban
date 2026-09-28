import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import { Button, Field, Popover, TextInput, cx } from '@/components/ui';
import { useCreateLinkAttachment, useUploadAttachments } from '@/hooks/useCardMutations';
import { UploadProgress } from './UploadProgress';
import styles from './AttachmentPopover.module.css';

/** Section 2.6.5, under "Choose a file". */
const DROP_HELPER = 'You can also drag and drop files to upload them.';

export interface AttachmentPopoverProps {
  boardId: number;
  cardId: number;
  /** The control the panel hangs off: the sidebar row, the section's "Add", the quick editor. */
  anchor: HTMLElement | DOMRect;
  onClose: () => void;
}

/**
 * "Attach" (Section 2.6.5): the file picker with its own drop zone, and the link form.
 *
 * Both halves post to `POST /api/cards/{card_id}/attachments`, which the server splits on the
 * request's content-type, so they are two hooks rather than two endpoints: the multipart half
 * cannot be optimistic (the id names the directory the bytes are stored in) and publishes a
 * `PendingUpload` per file carrying the real `upload.onprogress` fraction, which is the bar
 * `UploadProgress` paints; the link half writes a draft row at once.
 *
 * The size limit is stated up front rather than only after a rejection: `max_upload_mb` is
 * server state and `useUploadAttachments` owns both the guard and the one toast it shows
 * (CLAUDE.md section 3), so repeating the check here to render Section 2.6.5's inline
 * "Files must be under 25 MB" would be a second copy of the rule. The same sentence is the
 * picker's helper line instead, with the server's own number in it.
 *
 * The popover closes as soon as a link is inserted or files are handed over: the progress lives
 * in `AttachmentsSection` too, so an upload started here keeps reporting after the panel is gone.
 */
export function AttachmentPopover({
  boardId,
  cardId,
  anchor,
  onClose,
}: AttachmentPopoverProps): ReactElement {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [isOver, setIsOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { upload, pending, maxUploadMb } = useUploadAttachments(boardId, cardId);
  const createLink = useCreateLinkAttachment(boardId, cardId);

  function send(files: readonly File[]): void {
    if (files.length === 0) return;
    upload(files);
    onClose();
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsOver(false);
    send(Array.from(event.dataTransfer.files));
  }

  function insert(): void {
    const link = url.trim();
    if (link === '') return;
    createLink.mutate(name.trim() === '' ? { url: link } : { url: link, name: name.trim() });
    onClose();
  }

  return (
    <Popover anchor={anchor} title="Attach" onClose={onClose}>
      <div className={styles.panel}>
        <p className={styles.subheading}>Attach a file from your computer</p>
        <div
          className={cx(styles.dropzone, isOver && styles.over)}
          onDragOver={(event) => {
            event.preventDefault();
            setIsOver(true);
          }}
          onDragLeave={() => setIsOver(false)}
          onDrop={onDrop}
        >
          <Button fullWidth onClick={() => fileRef.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={fileRef}
            className={styles.file}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              send(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <p className={styles.helper}>{DROP_HELPER}</p>
          {maxUploadMb === null ? null : (
            <p className={styles.helper}>{`Files must be under ${String(maxUploadMb)} MB`}</p>
          )}
        </div>

        {pending.length === 0 ? null : (
          <ul className={styles.uploads}>
            {pending.map((file) => (
              <li key={file.key} className={styles.upload}>
                <span className={styles.uploadName}>{file.name}</span>
                <UploadProgress name={file.name} progress={file.progress} />
              </li>
            ))}
          </ul>
        )}

        <div className={styles.divider} />

        <p className={styles.subheading}>Search or paste a link</p>
        <TextInput
          placeholder="Paste any link here…"
          aria-label="Link"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Field label="Display text (optional)">
          {(control) => (
            <TextInput
              {...control}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Button variant="primary" disabled={url.trim() === ''} onClick={insert}>
          Insert
        </Button>
      </div>
    </Popover>
  );
}
