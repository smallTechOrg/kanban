/**
 * The `CardComposer` token parser of Section 2.4.4: `#label` attaches labels, `@member`
 * assigns members and `^top` / `^bottom` / `^N` chooses the slot. Matched tokens are stripped
 * from the title and returned so the composer can render its preview chips.
 *
 * `^N` is Trello's 1-based position, so it becomes the server's 0-based slot `N - 1`, clamped
 * to `[0, activeCount]` — an out-of-range `^99` therefore appends. `^0` and a non-numeric
 * value such as `^abc` are ignored and left in the title as plain text, and so is any `#` or
 * `@` word that matches no label or member on this board.
 *
 * Label and member names may contain spaces (`#Bug fix`, `@Asha Rao`), so a token greedily
 * matches the longest run of following words that names something on the board. The parser is
 * pure: the candidates and the active card count are passed in by the hook layer.
 *
 * `pastedLines` is the other rule a composer needs of what was typed into it: the lines a
 * multi-line paste becomes. `CardComposer` offers "Create N cards" and `ChecklistSection`
 * "Add N items" from the same count, and the server splits the block the same way
 * (`split_pasted_lines`, Sections 4.4 and 4.6), so both read it from here.
 */

export type Id = number;

/** The slot a `^` token asks for, in the form `POST /api/lists/{list_id}/cards` takes. */
export type SlotIndex = number | 'top' | 'bottom';

export interface LabelCandidate {
  id: Id;
  name: string;
  /** The label's palette key, which is what `#green` matches when no name does. */
  color: string;
}

export interface MemberCandidate {
  id: Id;
  username: string;
  full_name: string;
}

export interface ComposerContext {
  labels?: readonly LabelCandidate[];
  members?: readonly MemberCandidate[];
  /** The list's active card count; `^N` is clamped to `[0, activeCount]` (Section 2.4.4). */
  activeCount?: number;
}

export type ComposerToken =
  | { kind: 'label'; text: string; id: Id; name: string; color: string }
  | { kind: 'member'; text: string; id: Id; name: string }
  | { kind: 'position'; text: string; index: SlotIndex };

/** The parsed composer input: a clean title plus what the tokens resolved to. */
export interface ParsedComposer {
  title: string;
  /** Shaped like the create body, so it spreads straight into `createCard`. */
  label_ids: Id[];
  member_ids: Id[];
  /** Absent when no `^` token resolved, which means "append" for the server. */
  index?: SlotIndex;
  /** Every matched token in input order, for the preview strip. */
  tokens: ComposerToken[];
}

const LABEL_PREFIX = '#';
const MEMBER_PREFIX = '@';
const POSITION_PREFIX = '^';

interface Word {
  text: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const found: Word[] = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    found.push({ text: match[0], start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  return found;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The words a token covers, as the phrase it names (its prefix character removed). */
function phrase(run: readonly Word[]): string {
  return run
    .map((word) => word.text)
    .join(' ')
    .slice(1);
}

function findLabel(
  candidates: readonly LabelCandidate[],
  value: string,
): LabelCandidate | undefined {
  const named = candidates.find((label) => label.name !== '' && sameName(label.name, value));
  if (named !== undefined) return named;
  return candidates.find((label) => sameName(label.color, value));
}

function findMember(
  candidates: readonly MemberCandidate[],
  value: string,
): MemberCandidate | undefined {
  const byUsername = candidates.find((member) => sameName(member.username, value));
  if (byUsername !== undefined) return byUsername;
  return candidates.find((member) => sameName(member.full_name, value));
}

/** `^top`, `^bottom`, `^3`; anything else (including `^0`) resolves to nothing. */
function findSlot(value: string, activeCount: number): SlotIndex | undefined {
  const lowered = value.toLowerCase();
  if (lowered === 'top' || lowered === 'bottom') return lowered;
  if (!/^\d+$/.test(lowered)) return undefined;
  const oneBased = Number(lowered);
  if (oneBased < 1) return undefined;
  return Math.max(0, Math.min(oneBased - 1, activeCount));
}

/** Collapses the gaps a stripped token leaves, keeping the line breaks of a pasted title. */
function cleanTitle(kept: readonly string[]): string {
  return kept
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Parses one composer line. Duplicate `#` / `@` tokens resolve once; when several `^` tokens
 * are present the last one wins, the way a user correcting themselves expects.
 */
export function parseComposerTokens(text: string, context: ComposerContext = {}): ParsedComposer {
  const labels = context.labels ?? [];
  const members = context.members ?? [];
  const activeCount = context.activeCount ?? 0;

  const all = words(text);
  const tokens: ComposerToken[] = [];
  const labelIds: Id[] = [];
  const memberIds: Id[] = [];
  const kept: string[] = [];
  let index: SlotIndex | undefined;
  let cursor = 0;
  let skipUntil = 0;

  for (const [at, word] of all.entries()) {
    if (at < skipUntil) continue;
    const prefix = word.text.slice(0, 1);
    const isToken =
      word.text.length > 1 &&
      (prefix === LABEL_PREFIX || prefix === MEMBER_PREFIX || prefix === POSITION_PREFIX);
    if (!isToken) continue;

    let matched: { count: number; end: number; token: ComposerToken } | undefined;
    if (prefix === POSITION_PREFIX) {
      const slot = findSlot(word.text.slice(1), activeCount);
      if (slot !== undefined) {
        matched = {
          count: 1,
          end: word.end,
          token: { kind: 'position', text: word.text, index: slot },
        };
      }
    } else {
      const rest = all.slice(at);
      for (let count = rest.length; count >= 1 && matched === undefined; count -= 1) {
        const run = rest.slice(0, count);
        const value = phrase(run);
        const end = Math.max(...run.map((entry) => entry.end));
        const raw = text.slice(word.start, end);
        if (prefix === LABEL_PREFIX) {
          const label = findLabel(labels, value);
          if (label !== undefined) {
            matched = {
              count,
              end,
              token: {
                kind: 'label',
                text: raw,
                id: label.id,
                name: label.name,
                color: label.color,
              },
            };
          }
        } else {
          const member = findMember(members, value);
          if (member !== undefined) {
            matched = {
              count,
              end,
              token: { kind: 'member', text: raw, id: member.id, name: member.full_name },
            };
          }
        }
      }
    }

    if (matched === undefined) continue;

    kept.push(text.slice(cursor, word.start));
    cursor = matched.end;
    skipUntil = at + matched.count;

    const { token } = matched;
    tokens.push(token);
    if (token.kind === 'label') {
      if (!labelIds.includes(token.id)) labelIds.push(token.id);
    } else if (token.kind === 'member') {
      if (!memberIds.includes(token.id)) memberIds.push(token.id);
    } else {
      index = token.index;
    }
  }

  kept.push(text.slice(cursor));

  const parsed: ParsedComposer = {
    title: cleanTitle(kept),
    label_ids: labelIds,
    member_ids: memberIds,
    tokens,
  };
  if (index !== undefined) parsed.index = index;
  return parsed;
}

/** Section 2.4.4 and 2.6.3: the prompt appears from two non-empty lines up. */
export const MIN_PASTE_LINES = 2;

/**
 * The lines a pasted block becomes: trimmed, with the blank ones dropped. One card or one
 * checklist item per line, exactly as the server's `split_lines` counts them.
 */
export function pastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
