import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BoardsPopover, type BoardsGroup } from './BoardsPopover';

/** `boardGroupsFixture`: Recent holds both boards, Starred only this one. */
const STARRED = 'Roadmap';
const RECENT_ONLY = 'Website relaunch';

function renderPopover(group: BoardsGroup): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const app = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <BoardsPopover anchor={anchor} group={group} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(app());
}

/** The `<section>` one group heading labels. */
function groupOf(heading: string): HTMLElement {
  const section = screen.getByRole('heading', { name: heading }).parentElement;
  if (section === null) throw new Error(`the ${heading} heading has no section`);
  return section;
}

describe('BoardsPopover', () => {
  it('lists one group under the popover title alone', async () => {
    renderPopover('starred');

    expect(await screen.findByRole('button', { name: STARRED })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Starred boards' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RECENT_ONLY })).not.toBeInTheDocument();
    // A single-group panel is named by that title, so it carries no section label of its own.
    expect(screen.queryByRole('heading', { name: 'Starred' })).not.toBeInTheDocument();
  });

  it('shows Recent and Starred together for the B shortcut', async () => {
    renderPopover('both');

    await screen.findByRole('button', { name: RECENT_ONLY });
    expect(screen.getByRole('dialog', { name: 'Boards' })).toBeInTheDocument();
    const recent = groupOf('Recent');
    const starred = groupOf('Starred');

    expect(within(recent).getByRole('button', { name: RECENT_ONLY })).toBeInTheDocument();
    expect(within(recent).getByRole('button', { name: STARRED })).toBeInTheDocument();
    expect(within(starred).getByRole('button', { name: STARRED })).toBeInTheDocument();
    expect(within(starred).queryByRole('button', { name: RECENT_ONLY })).not.toBeInTheDocument();
  });

  it('narrows both groups with one filter input', async () => {
    const user = userEvent.setup();
    renderPopover('both');

    await screen.findByRole('button', { name: RECENT_ONLY });
    await user.type(screen.getByLabelText('Filter boards'), 'website');

    expect(
      within(groupOf('Recent')).getByRole('button', { name: RECENT_ONLY }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: STARRED })).not.toBeInTheDocument();
    expect(
      within(groupOf('Starred')).getByText('Star boards to see them here'),
    ).toBeInTheDocument();
  });
});
