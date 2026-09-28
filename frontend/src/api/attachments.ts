/**
 * Attachments and the card cover (Sections 4.5, 4.6 and 5.8).
 *
 * They share a module because they share a row: a cover of kind `attachment` is nothing but an
 * `attachments` id this card owns, `PUT /api/cards/{card_id}/cover` refuses an id that is not
 * one of them or has no thumbnail, and deleting the attachment that is the cover clears the
 * cover in the same transaction (Section 3.7). "Upload a cover image" is exactly
 * `uploadAttachment` followed by `setCover`.
 *
 * `POST /api/cards/{card_id}/attachments` has two branches decided by the request's
 * content-type, so it has two functions here: `uploadAttachment` sends multipart through the
 * `XMLHttpRequest` transport of `client.ts`, which is the only way `upload.onprogress` can
 * drive the progress bar of Section 2.6.3, and `createLinkAttachment` sends JSON like every
 * other call. Both answer `Mutated<Attachment>`.
 *
 * The size guard of Section 5.8 is not here: `meta.max_upload_mb` is server state the client
 * reads through `['meta']`, so the check lives with the mutation in `hooks/useCardMutations.ts`
 * and the toast it shows, and this module stays the transport.
 */
import { api, uploadFile, type UploadOptions } from './client';
import type { Attachment, CardSummary, CoverKind, CoverSize, Mutated } from './types';

/** `POST /api/cards/{card_id}/attachments` as JSON: `name` defaults to the URL's host. */
export interface LinkAttachmentInput {
  /** Must be `http(s)`; anything else is 422 (Section 4.6). */
  url: string;
  name?: string;
}

/**
 * `PUT /api/cards/{card_id}/cover` (Section 4.5). `value` is a `cover_colors` key from
 * `GET /api/meta` when `kind` is `color`, and the id of an image attachment of *this* card,
 * as text, when it is `attachment`; `size` defaults to `normal` server-side and is what the
 * two preview tiles of `CoverPopover` write.
 */
export interface CoverInput {
  kind: CoverKind;
  value: string;
  size?: CoverSize;
}

/**
 * `POST /api/cards/{card_id}/attachments`, multipart field `file` — 201 with the stored row.
 * 411 without a `Content-Length`, 413 above `meta.max_upload_mb` (Section 6.9); `onProgress`
 * reports the bytes on the wire, which is all a pending row can show before the id exists.
 */
export function uploadAttachment(
  cardId: number,
  file: File,
  options?: UploadOptions,
): Promise<Mutated<Attachment>> {
  return uploadFile<Mutated<Attachment>>(`/cards/${cardId}/attachments`, file, options);
}

/** The same endpoint as JSON: "Search or paste a link" in `AttachmentPopover` (2.6.5). */
export function createLinkAttachment(
  cardId: number,
  input: LinkAttachmentInput,
): Promise<Mutated<Attachment>> {
  return api.post<Mutated<Attachment>>(`/cards/${cardId}/attachments`, input);
}

/** `PATCH /api/attachments/{attachment_id}` — the display name only; the file keeps its own. */
export function renameAttachment(attachmentId: number, name: string): Promise<Mutated<Attachment>> {
  return api.patch<Mutated<Attachment>>(`/attachments/${attachmentId}`, { name });
}

/** `DELETE /api/attachments/{attachment_id}` — 204, no undo; clears the cover if it was one. */
export function deleteAttachment(attachmentId: number): Promise<void> {
  return api.del(`/attachments/${attachmentId}`);
}

/** `PUT /api/cards/{card_id}/cover` — 400 for a colour key or attachment id the card cannot use. */
export function setCover(cardId: number, input: CoverInput): Promise<Mutated<CardSummary>> {
  return api.put<Mutated<CardSummary>>(`/cards/${cardId}/cover`, input);
}

/** `DELETE /api/cards/{card_id}/cover` — 200 with the card, `cover: null` ("Remove cover"). */
export function clearCover(cardId: number): Promise<Mutated<CardSummary>> {
  return api.delJson<Mutated<CardSummary>>(`/cards/${cardId}/cover`);
}
