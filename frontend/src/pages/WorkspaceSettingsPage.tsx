import type { ReactElement } from 'react';
import styles from './WorkspaceSettingsPage.module.css';

/** `/w/settings` (Section 2.2): the v1 stub, in the home page's 1128px column. */
export function WorkspaceSettingsPage(): ReactElement {
  return (
    <main className={styles.page}>
      <h3 className={styles.heading}>Kan Ban Workspace</h3>
      <p className={styles.blurb}>Workspace settings arrive in a later version</p>
    </main>
  );
}
