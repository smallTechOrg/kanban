import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Avatar, MarkdownEditor } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useMembers } from '@/hooks/useBoardData';
import { useCreateComment } from '@/hooks/useCardMutations';
import type { MemberRow } from '@/lib/boardState';
import styles from './CommentBox.module.css';

const NO_MEMBERS: readonly MemberRow[] = [];

/** Section 2.6.3: the autocomplete lists six members at a time. */
const MENTION_ROWS = 6;

/** The `@partial` the caret sits at the end of, or `null` when it is not in a mention. */
function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // A mention starts the text or follows whitespace, so an email address is not one.
  const preceding = at === 0 ? ' ' : before.charAt(at - 1);
  if (!/\s/.test(preceding)) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

export interface CommentBoxProps {
  boardId: number;
  cardId: number;
}

/**
 * The comment composer of Section 2.6.3: my avatar, a white "Write a comment…" box that becomes
 * a `MarkdownEditor` on focus, `Ctrl/Cmd+Enter` to submit and Escape to collapse — which keeps
 * the draft, so a mis-hit Escape never loses what was typed.
 *
 * Typing `@` opens the member autocomplete. It is a plain `listbox` under the textarea rather
 * than a `Popover`: a popover traps focus, and the caret has to stay in the textarea while the
 * arrow keys walk the rows. `Textarea` skips its own Enter and Escape handling whenever this
 * component has already called `preventDefault`, which is how one key does two jobs.
 *
 * The attachment and emoji buttons of the documented toolbar are still absent: both insert text
 * at the caret of this component's own draft, which `AttachmentsSection`'s "Comment" action needs
 * as well, so all three arrive together with the `EmojiPopover` of Section 2.6.3 rather than one
 * of them growing a private insert path now.
 */
export function CommentBox({ boardId, cardId }: CommentBoxProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState(0);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const me = useMe().data;
  const members = useMembers(boardId).data ?? NO_MEMBERS;
  const create = useCreateComment(boardId, cardId);

  const matches =
    mention === null
      ? []
      : members
          .filter((member) => {
            const query = mention.query.toLowerCase();
            return (
              member.username.toLowerCase().startsWith(query) ||
              member.full_name.toLowerCase().includes(query)
            );
          })
          .slice(0, MENTION_ROWS);

  function onChange(next: string): void {
    setDraft(next);
    const caret = inputRef.current?.selectionStart ?? next.length;
    setMention(mentionAt(next, caret));
    setActive(0);
  }

  /** Replaces the `@partial` under the caret with `@username ` and puts the caret after it. */
  function insertMention(member: MemberRow): void {
    if (mention === null) return;
    const input = inputRef.current;
    const caret = input?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, mention.start)}@${member.username} ${draft.slice(caret)}`;
    const position = mention.start + member.username.length + 2;
    setDraft(next);
    setMention(null);
    if (input !== null) {
      input.value = next;
      input.setSelectionRange(position, position);
      input.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (matches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % matches.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + matches.length) % matches.length);
      return;
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const member = matches[active];
      if (member === undefined) return;
      event.preventDefault();
      insertMention(member);
      return;
    }
    if (event.key === 'Escape') {
      // The mention list closes first; a second Escape then collapses the box.
      event.preventDefault();
      event.stopPropagation();
      setMention(null);
    }
  }

  function submit(): void {
    const body = draft.trim();
    if (body === '') return;
    create.mutate({ body });
    setDraft('');
    setMention(null);
    setExpanded(false);
  }

  return (
    <div className={styles.box}>
      {me === undefined ? null : <Avatar name={me.full_name} color={me.avatar_color} size={32} />}

      <div className={styles.field}>
        {expanded ? (
          <>
            <MarkdownEditor
              value={draft}
              label="Write a comment"
              placeholder="Write a comment…"
              minRows={3}
              inputRef={inputRef}
              onChange={onChange}
              onSave={submit}
              onCancel={() => setExpanded(false)}
              onKeyDown={onKeyDown}
            />
            {matches.length === 0 ? null : (
              <div className={styles.mentions} role="listbox" aria-label="Board members">
                {matches.map((member, at) => (
                  <button
                    key={member.id}
                    type="button"
                    className={styles.mentionRow}
                    role="option"
                    aria-selected={at === active}
                    data-active={at === active ? 'true' : undefined}
                    onClick={() => insertMention(member)}
                  >
                    <Avatar name={member.full_name} color={member.avatar_color} />
                    <span className={styles.mentionName}>{member.full_name}</span>
                    <span className={styles.mentionUser}>{`@${member.username}`}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <button type="button" className={styles.prompt} onClick={() => setExpanded(true)}>
            {draft === '' ? 'Write a comment…' : draft}
          </button>
        )}
      </div>
    </div>
  );
}
