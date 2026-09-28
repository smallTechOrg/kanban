import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BoardRole, Member } from '@/api/types';
import { boardPayloadFixture, makeBoardSummary, memberFixture } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { ShareBoardModal } from './ShareBoardModal';

const BOARD_ID = 7;

/** `publicUsersFixture`'s second row, the one person who is not already on the board. */
const ASHA = 'Asha Patel';

/** The caller (`GET /api/auth/me` answers `userFixture`, id 1) and the fixture's only admin. */
const ME = 'Vivek Sharma';

/** Asha as a board member, for the payload where the caller is not the last admin. */
const ashaMember: Member = {
  id: 2,
  username: 'asha',
  full_name: ASHA,
  initials: 'AP',
  avatar_color: 'var(--success)',
  role: 'admin',
  joined_at: '2026-09-02T10:00:00.000Z',
};

/** Answers `GET /api/boards/7` with a chosen role for the caller and a chosen member list. */
function serveBoard(my_role: BoardRole, members: Member[]): void {
  server.use(
    http.get('/api/boards/:boardId', () =>
      HttpResponse.json({
        ...boardPayloadFixture,
        board: makeBoardSummary({ id: BOARD_ID, my_role }),
        members,
      }),
    ),
  );
}

/** Renders the modal and waits for the members list the board payload carries. */
async function renderModal(): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  const onClose = vi.fn();
  renderWithProviders(
    <ShareBoardModal boardId={BOARD_ID} onClose={onClose} />,
    `/b/${String(BOARD_ID)}`,
  );
  await screen.findByRole('heading', { name: 'Board members' });
  return { onClose };
}

/** The `<li>` of one person, in either half of the dialog. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe('ShareBoardModal', () => {
  it('adds a searched user at the chosen role', async () => {
    const user = userEvent.setup();
    let put: { userId: string; role: BoardRole } | undefined;
    server.use(
      http.put('/api/boards/:boardId/members/:userId', async ({ params, request }) => {
        const body = (await request.json()) as { role: BoardRole };
        put = { userId: String(params['userId']), role: body.role };
        return HttpResponse.json({
          item: { ...ashaMember, role: body.role },
          board_version: 2,
        });
      }),
    );
    await renderModal();

    await user.type(screen.getByRole('searchbox', { name: /Add members/ }), 'as');

    // The debounced search returns both fixture users; the one already on the board is dropped.
    const candidate = await screen.findByRole('button', { name: `Add ${ASHA} to this board` });
    expect(screen.queryByRole('button', { name: `Add ${ME} to this board` })).toBeNull();

    await user.selectOptions(screen.getByLabelText(`Role for ${ASHA}`), 'observer');
    await user.click(candidate);

    await vi.waitFor(() => expect(put).toEqual({ userId: '2', role: 'observer' }));
  });

  it('renders the members read-only for a plain member, who may still leave', async () => {
    serveBoard('member', [{ ...memberFixture, role: 'member' }, ashaMember]);
    await renderModal();

    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(within(rowOf(ASHA)).getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(within(rowOf(ME)).getByRole('button', { name: 'Leave board' })).toBeInTheDocument();
  });

  it('offers the last admin no way to leave or be demoted', async () => {
    await renderModal();

    const own = rowOf(ME);
    expect(within(own).queryByRole('button', { name: 'Leave board' })).toBeNull();
    expect(within(own).getByLabelText(`Role for ${ME}`)).toBeDisabled();
  });
});
