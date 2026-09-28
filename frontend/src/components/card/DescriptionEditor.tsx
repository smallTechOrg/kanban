import { useState, type ReactElement } from 'react';
import { AlignLeft } from 'lucide-react';
import { Button, MarkdownEditor, MarkdownView } from '@/components/ui';
import { useUpdateCardFields } from '@/hooks/useCardMutations';
import type { CardDetail } from '@/api/types';
import styles from './DescriptionEditor.module.css';

/** Section 2.6.3: the copy on the grey click-to-edit box of an empty description. */
const EMPTY_PROMPT = 'Add a more detailed description…';

export interface DescriptionEditorProps {
  boardId: number;
  card: CardDetail;
  readOnly?: boolean;
}

/**
 * The description section of Section 2.6.3: the heading with its "Edit" button, the grey
 * click-to-edit box while the card has no description, the `MarkdownEditor` while editing and
 * `MarkdownView` once saved.
 *
 * The editor is controlled from here, so Cancel discards the draft and leaves the stored text
 * untouched, and `Ctrl/Cmd+Enter` saves — both of which `MarkdownEditor` and `Textarea` already
 * implement, so this component only decides what a save means: one
 * `PATCH /api/cards/{card_id} {description}` through `useUpdateCardFields`, which patches the
 * card cache, the tile's `CardRow` and the description badge in one pass (Section 5.4.3).
 */
export function DescriptionEditor({
  boardId,
  card,
  readOnly = false,
}: DescriptionEditorProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.description);
  const update = useUpdateCardFields(boardId, card.id);

  function startEditing(): void {
    setDraft(card.description);
    setEditing(true);
  }

  function save(): void {
    setEditing(false);
    if (draft === card.description) return;
    update.mutate({ description: draft });
  }

  const hasText = card.description !== '';

  return (
    <section className={styles.section} aria-labelledby="card-description-heading">
      <div className={styles.header}>
        <AlignLeft className={styles.icon} aria-hidden="true" size={16} />
        <h3 className={styles.heading} id="card-description-heading">
          Description
        </h3>
        {hasText && !editing && !readOnly ? <Button onClick={startEditing}>Edit</Button> : null}
      </div>

      <div className={styles.body}>
        {editing ? (
          <MarkdownEditor
            value={draft}
            label="Description"
            placeholder={EMPTY_PROMPT}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        ) : hasText ? (
          <MarkdownView>{card.description}</MarkdownView>
        ) : readOnly ? (
          <p className={styles.none}>No description</p>
        ) : (
          <button type="button" className={styles.emptyBox} onClick={startEditing}>
            {EMPTY_PROMPT}
          </button>
        )}
      </div>
    </section>
  );
}
