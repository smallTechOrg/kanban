/**
 * The board label palette and the card-to-label toggles (Sections 4.3 and 4.5).
 *
 * A label is stored as a `{color, tone}` pair — a palette key plus one of the three tones —
 * never as a hex: `GET /api/meta` publishes the thirty colours and `lib/colors.ts` resolves
 * them, so no component ever writes one down (CLAUDE.md section 3).
 *
 * The two toggle endpoints answer with the card's whole `label_ids` array rather than a
 * `Mutated<Label>`, in the `position` order the chips row renders, so the client patches one
 * array into both the card detail and the board payload's `CardRow`.
 */
import { api } from './client';
import type { CardLabels, Label, LabelColorKey, LabelTone, Mutated } from './types';

/** `POST /api/boards/{board_id}/labels`; `color` is the only required field (Section 4.3). */
export interface CreateLabelInput {
  /** 0-512 characters. May be empty — the six labels every board is seeded with are. */
  name?: string;
  color: LabelColorKey;
  tone?: LabelTone;
}

/**
 * `PATCH /api/labels/{label_id}` (Section 4.3). An absent field is untouched and no field is
 * nullable: "Remove color" sends the `none` palette key, not `null` (Section 2.6.5).
 */
export interface UpdateLabelInput {
  name?: string;
  color?: LabelColorKey;
  tone?: LabelTone;
}

/** `POST /api/boards/{board_id}/labels` — appended at the end of the palette. */
export function createLabel(boardId: number, input: CreateLabelInput): Promise<Mutated<Label>> {
  return api.post<Mutated<Label>>(`/boards/${boardId}/labels`, input);
}

/** `PATCH /api/labels/{label_id}` — the rename and recolour of the Edit label sub-view. */
export function updateLabel(labelId: number, input: UpdateLabelInput): Promise<Mutated<Label>> {
  return api.patch<Mutated<Label>>(`/labels/${labelId}`, input);
}

/** `DELETE /api/labels/{label_id}` — 204, admin only, and it cascades `card_labels`. */
export function deleteLabel(labelId: number): Promise<void> {
  return api.del(`/labels/${labelId}`);
}

/** `PUT /api/cards/{card_id}/labels/{label_id}` — idempotent; sending it twice changes nothing. */
export function attachLabel(cardId: number, labelId: number): Promise<CardLabels> {
  return api.put<CardLabels>(`/cards/${cardId}/labels/${labelId}`);
}

/** `DELETE /api/cards/{card_id}/labels/{label_id}` — a label the card lacks is a no-op. */
export function detachLabel(cardId: number, labelId: number): Promise<CardLabels> {
  return api.delJson<CardLabels>(`/cards/${cardId}/labels/${labelId}`);
}
