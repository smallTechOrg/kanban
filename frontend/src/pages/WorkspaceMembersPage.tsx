import type { ReactElement } from 'react';
import { Avatar, EmptyState, Spinner } from '@/components/ui';
import { useAllUsers } from '@/hooks/useUsers';
import styles from './WorkspaceMembersPage.module.css';

/**
 * `/w/members` (Section 2.2): every registered user, read-only, in the same 1128px column
 * as the home page. The rows arrive alphabetical from `GET /api/users?limit=500`.
 */
export function WorkspaceMembersPage(): ReactElement {
  const { data: users, isPending, isError } = useAllUsers();

  return (
    <main className={styles.page}>
      <h3 className={styles.heading}>Members</h3>
      {isPending ? (
        <Spinner size={24} label="Loading members" />
      ) : isError || users === undefined ? (
        <EmptyState message="The member list could not be loaded." />
      ) : (
        <ul className={styles.list}>
          {users.map((user) => (
            <li key={user.id} className={styles.row}>
              <Avatar name={user.full_name} color={user.avatar_color} size={40} />
              <span className={styles.lines}>
                <span className={styles.name}>{user.full_name}</span>
                <span className={styles.username}>@{user.username}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
