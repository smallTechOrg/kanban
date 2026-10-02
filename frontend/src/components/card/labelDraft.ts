/**
 * The label rules the three label surfaces share: how an unnamed label reads, the draft the
 * create and edit views of Section 2.6.5 write, and the sentence shown before a delete.
 *
 * They are not in `lib/` because the draft is typed by the API's own `LabelColorKey`, which `lib/`
 * may not import (it would need a second hard-coded copy of the ten palette keys), and they are
 * not in `LabelForm.tsx` because a module that exports a component may export nothing else. The
 * card modal's `LabelsPopover`, the board menu's Labels panel and the form all read them here.
 */
import type { LabelColorKey, LabelTone } from '@/api/types';
import type { LabelRow } from '@/lib/boardState';
import { FALLBACK_LABEL_KEY } from '@/lib/colors';

/** Section 2.6.5's confirm body, shown by whichever surface asks before deleting. */
export const DELETE_LABEL_BODY = 'This will remove this label from all cards. There is no undo.';

/** A `{name, color, tone}` triple: what both the create and the edit view write. */
export interface LabelDraft {
  name: string;
  color: LabelColorKey;
  tone: LabelTone;
}

/** The draft "Create a new label" opens with: no name and no colour. */
export const NEW_LABEL: LabelDraft = { name: '', color: FALLBACK_LABEL_KEY, tone: 'normal' };

/** The six labels every board is seeded with are unnamed, so they show their colour key. */
export function labelName(label: Pick<LabelRow, 'name' | 'color'>): string {
  return label.name === '' ? label.color : label.name;
}

/**
 * One stored label as an editable draft. `labels.color` is one of the keys `GET /api/meta`
 * publishes, which is exactly the ten of `LabelColorKey` (Section 4.3).
 */
export function draftOf(label: LabelRow): LabelDraft {
  return { name: label.name, color: label.color as LabelColorKey, tone: label.tone };
}
