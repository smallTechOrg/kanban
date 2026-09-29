import type { ReactElement } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import type { CardDetail } from '@/api/types';
import { CHECKLIST_DRAG_TYPE, checklistsDropId } from '@/lib/cardDnd';
import { ActivitySection } from './ActivitySection';
import { AttachmentsSection } from './AttachmentsSection';
import { ChecklistSection } from './ChecklistSection';
import { DescriptionEditor } from './DescriptionEditor';
import { QuickBadgesRow } from './QuickBadgesRow';
import styles from './CardModalMain.module.css';

export interface CardModalMainProps {
  boardId: number;
  card: CardDetail;
  /** The checklists with "Hide checked items" on; the modal owns it (`ChecklistSection`). */
  hiddenChecklistIds: readonly number[];
  onToggleHideChecked: (checklistId: number) => void;
}

/**
 * The 552px main column of Section 2.6.3, in the documented order: the quick badges, the
 * description, one `ChecklistSection` per checklist in `position` order, then the activity.
 *
 * The checklists sit in the card's one `CHECKLIST` droppable — the sections are reordered by
 * dragging their headers — and each of them holds its own `CHECKLIST_ITEM` droppable, so the two
 * types never mix (Section 2.6.3). The `DragDropContext` both belong to is in `CardDetailModal`.
 *
 * `AttachmentsSection` sits between the description and the checklists, as Section 2.6.3 orders
 * them, and renders even with no attachments: it owns the modal-wide drop zone of Section 5.8, so
 * a card with nothing attached still has to say that dropping files on it uploads them
 * (CLAUDE.md section 8).
 */
export function CardModalMain({
  boardId,
  card,
  hiddenChecklistIds,
  onToggleHideChecked,
}: CardModalMainProps): ReactElement {
  return (
    <div className={styles.main}>
      <QuickBadgesRow boardId={boardId} card={card} />
      <DescriptionEditor boardId={boardId} card={card} />
      <AttachmentsSection boardId={boardId} card={card} />

      <Droppable droppableId={checklistsDropId(card.id)} type={CHECKLIST_DRAG_TYPE}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {card.checklists.map((checklist, index) => (
              <ChecklistSection
                key={checklist.id}
                boardId={boardId}
                cardId={card.id}
                checklist={checklist}
                index={index}
                hideChecked={hiddenChecklistIds.includes(checklist.id)}
                onToggleHideChecked={() => onToggleHideChecked(checklist.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      <ActivitySection boardId={boardId} cardId={card.id} />
    </div>
  );
}
