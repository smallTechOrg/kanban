import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip } from 'lucide-react';
import type { Attachment, CardDetail } from '@/api/types';
import { Button, ConfirmPopover, EmptyState, Field, Popover, TextInput, cx } from '@/components/ui';
import {
  useClearCover,
  useDeleteAttachment,
  useRenameAttachment,
  useSetCover,
  useUploadAttachments,
} from '@/hooks/useCardMutations';
import { formatDateTime } from '@/lib/dates';
import { AttachmentPopover } from './AttachmentPopover';
import { UploadProgress } from './UploadProgress';
import styles from './AttachmentsSection.module.css';

const DELETE_BODY = 'Deleting an attachment is permanent. There is no undo.';

/** Section 5.8: the overlay the open card shows while files are dragged over it. */
const DROP_PROMPT = 'Drop files to upload';

/** The 112x80 box of a non-image row: "PDF", "ZIP", or "LINK" for a link (Section 2.6.3). */
function kindLabel(attachment: Pick<Attachment, 'kind' | 'name'>): string {
  if (attachment.kind === 'link') return 'LINK';
  const dot = attachment.name.lastIndexOf('.');
  const extension = dot < 0 ? '' : attachment.name.slice(dot + 1);
  return extension === '' ? 'FILE' : extension.slice(0, 4).toUpperCase();
}

/** Which row popover is open, and on which control it hangs. */
interface RowPopover {
  kind: 'delete' | 'rename';
  attachment: Attachment;
  anchor: HTMLElement;
}

export interface AttachmentsSectionProps {
  boardId: number;
  card: CardDetail;
}

/**
 * The attachments section of Section 2.6.3: the heading with its "Add" button, one 112x80 row per
 * stored attachment with the documented dot-separated actions, a row per file still on the wire,
 * and the empty state before the card has any.
 *
 * It also owns the modal-wide drop zone of Section 5.8 — dropping files anywhere on the open card
 * uploads them, with a dashed outline and "Drop files to upload" while they hover. The listeners
 * go on the enclosing `[role="dialog"]` rather than on a wrapper of this section, because the
 * documented target is the whole dialog and this is the only part of it that owns uploads; the
 * overlay is portalled into that same element so the outline traces the dialog, not the section.
 *
 * Every write is a hook from `useCardMutations`: the upload hook publishes the real
 * `upload.onprogress` fraction per pending file, and "Make cover" / "Remove cover" are the same
 * cover endpoints `CoverPopover` uses, so a row's own button and the popover agree without either
 * knowing about the other (`is_cover` is derived from the card's cover, never stored twice).
 */
export function AttachmentsSection({ boardId, card }: AttachmentsSectionProps): ReactElement {
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [rowPopover, setRowPopover] = useState<RowPopover | null>(null);
  const [dialog, setDialog] = useState<HTMLElement | null>(null);
  const [isOver, setIsOver] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const { upload, pending } = useUploadAttachments(boardId, card.id);
  const renameAttachment = useRenameAttachment(boardId, card.id);
  const deleteAttachment = useDeleteAttachment(boardId, card.id);
  const setCover = useSetCover(boardId, card.id);
  const clearCover = useClearCover(boardId, card.id);

  useEffect(() => {
    const node = rootRef.current?.closest('[role="dialog"]');
    setDialog(node instanceof HTMLElement ? node : null);
  }, []);

  useEffect(() => {
    if (dialog === null) return undefined;

    function carriesFiles(event: DragEvent): boolean {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }
    function onDragOver(event: DragEvent): void {
      if (!carriesFiles(event)) return;
      // Without this the browser navigates to the dropped file instead of uploading it.
      event.preventDefault();
      setIsOver(true);
    }
    function onDragLeave(event: DragEvent): void {
      const next = event.relatedTarget;
      if (dialog !== null && next instanceof Node && dialog.contains(next)) return;
      setIsOver(false);
    }
    function onDrop(event: DragEvent): void {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setIsOver(false);
      upload(Array.from(event.dataTransfer?.files ?? []));
    }

    dialog.addEventListener('dragover', onDragOver);
    dialog.addEventListener('dragleave', onDragLeave);
    dialog.addEventListener('drop', onDrop);
    return () => {
      dialog.removeEventListener('dragover', onDragOver);
      dialog.removeEventListener('dragleave', onDragLeave);
      dialog.removeEventListener('drop', onDrop);
    };
  }, [dialog, upload]);

  const size = card.cover?.size ?? 'normal';

  function closeRowPopover(): void {
    setRowPopover(null);
  }

  /**
   * The dots between the actions are the separators' own `::before`, not the buttons', so no
   * control's accessible name picks one up (WCAG 2.5.3 reads generated content too).
   */
  function rowActions(attachment: Attachment): ReactElement {
    return (
      <div className={styles.actions}>
        <span className={styles.action}>
          <a
            className={styles.download}
            href={attachment.url}
            download={attachment.kind === 'upload' ? attachment.name : undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download
          </a>
        </span>
        <span className={styles.action}>
          <Button
            variant="link"
            onClick={(event) =>
              setRowPopover({ kind: 'delete', attachment, anchor: event.currentTarget })
            }
          >
            Delete
          </Button>
        </span>
        <span className={styles.action}>
          <Button
            variant="link"
            onClick={(event) =>
              setRowPopover({ kind: 'rename', attachment, anchor: event.currentTarget })
            }
          >
            Edit
          </Button>
        </span>
        {!attachment.is_image ? null : (
          <span className={styles.action}>
            {attachment.is_cover ? (
              <Button variant="link" onClick={() => clearCover.mutate()}>
                Remove cover
              </Button>
            ) : (
              <Button
                variant="link"
                onClick={() =>
                  setCover.mutate({ kind: 'attachment', value: String(attachment.id), size })
                }
              >
                Make cover
              </Button>
            )}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="card-attachments-heading" ref={rootRef}>
      <div className={styles.header}>
        <Paperclip className={styles.icon} aria-hidden="true" size={16} />
        <h3 className={styles.heading} id="card-attachments-heading">
          Attachments
        </h3>
        <Button onClick={(event) => setAddAnchor(event.currentTarget)}>Add</Button>
      </div>

      <div className={styles.body}>
        {card.attachments.length === 0 && pending.length === 0 ? (
          <EmptyState message="No attachments yet. Drop files on this card, or use Add." />
        ) : null}

        <ul className={styles.rows}>
          {card.attachments.map((attachment) => (
            <li key={attachment.id} className={styles.row}>
              <div className={styles.thumb}>
                {attachment.is_image && attachment.thumb_url !== null ? (
                  <img className={styles.image} src={attachment.thumb_url} alt="" />
                ) : (
                  <span className={styles.kind}>{kindLabel(attachment)}</span>
                )}
              </div>
              <div className={styles.details}>
                <a
                  className={styles.name}
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {attachment.name}
                </a>
                <p className={styles.meta}>{`Added ${formatDateTime(attachment.created_at)}`}</p>
                {rowActions(attachment)}
              </div>
            </li>
          ))}

          {pending.map((file) => (
            <li key={file.key} className={cx(styles.row, styles.pendingRow)}>
              <div className={styles.thumb}>
                <span className={styles.kind}>
                  {kindLabel({ kind: 'upload', name: file.name })}
                </span>
                <div className={styles.progress}>
                  <UploadProgress name={file.name} progress={file.progress} />
                </div>
              </div>
              <div className={styles.details}>
                <span className={styles.name}>{file.name}</span>
                <p className={styles.meta}>Uploading…</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {addAnchor === null ? null : (
        <AttachmentPopover
          anchor={addAnchor}
          boardId={boardId}
          cardId={card.id}
          onClose={() => setAddAnchor(null)}
        />
      )}

      {rowPopover === null || rowPopover.kind !== 'delete' ? null : (
        <ConfirmPopover
          anchor={rowPopover.anchor}
          title="Delete attachment?"
          body={DELETE_BODY}
          onConfirm={() => {
            deleteAttachment.mutate(rowPopover.attachment.id);
            closeRowPopover();
          }}
          onClose={closeRowPopover}
        />
      )}

      {rowPopover === null || rowPopover.kind !== 'rename' ? null : (
        <Popover anchor={rowPopover.anchor} title="Edit attachment" onClose={closeRowPopover}>
          <RenameForm
            initial={rowPopover.attachment.name}
            onSubmit={(name) => {
              renameAttachment.mutate({ attachmentId: rowPopover.attachment.id, name });
              closeRowPopover();
            }}
          />
        </Popover>
      )}

      {isOver && dialog !== null
        ? createPortal(
            <div className={styles.dropOverlay} aria-hidden="true">
              <span className={styles.dropPrompt}>{DROP_PROMPT}</span>
            </div>,
            dialog,
          )
        : null}
    </section>
  );
}

interface RenameFormProps {
  initial: string;
  onSubmit: (name: string) => void;
}

/**
 * The "Edit" sub-popover of Section 2.6.3, a component rather than markup inlined above for the
 * reason `LabelsPopover` gives: it owns its draft, so the input is live.
 */
function RenameForm({ initial, onSubmit }: RenameFormProps): ReactElement {
  const [name, setName] = useState(initial);

  return (
    <div className={styles.renameForm}>
      <Field label="Name">
        {(control) => (
          <TextInput {...control} value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      <Button
        variant="primary"
        fullWidth
        disabled={name.trim() === ''}
        onClick={() => onSubmit(name.trim())}
      >
        Save
      </Button>
    </div>
  );
}
