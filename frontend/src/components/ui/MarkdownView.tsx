import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './MarkdownView.module.css';

/** Section 5.7: an image may only come from https:// or the app's own /uploads/ directory. */
const HTTPS = 'https://';
const UPLOADS = '/uploads/';

function isRenderableImage(src: string): boolean {
  return src.startsWith(HTTPS) || src.startsWith(UPLOADS);
}

/**
 * Every link leaves the app, so it always opens in a new tab and never hands the target
 * window a reference back (`noopener`) or the user's reputation (`nofollow`).
 */
function Anchor({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

/**
 * An image the CSP of Section 4.11 would block (`img-src 'self' data: blob: https:`) is
 * rendered as the link it came from instead of as a broken image box.
 */
function Image({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement>): ReactElement {
  if (typeof src !== 'string' || !isRenderableImage(src)) {
    const label = alt === undefined || alt === '' ? (src ?? '') : alt;
    return <Anchor href={typeof src === 'string' ? src : undefined}>{label}</Anchor>;
  }
  return <img {...rest} src={src} alt={alt ?? ''} loading="lazy" />;
}

export interface MarkdownViewProps {
  /** The stored Markdown: a card or board description. */
  children: string;
}

/**
 * Rendered Markdown (Section 5.7): `react-markdown` with `remark-gfm` for task lists, tables,
 * fenced code and autolinks, and deliberately **no** `rehype-raw`, so HTML a user typed is
 * shown as the text they typed rather than executed. That omission is the whole security
 * posture of user content in this app, which is why this is the only component that renders
 * Markdown and nothing anywhere else calls `react-markdown`.
 *
 * Task-list checkboxes come from the source text, so they are rendered disabled: ticking one
 * would have nothing to write to.
 */
export function MarkdownView({ children }: MarkdownViewProps): ReactElement {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: Anchor,
          img: Image,
          input: (props) => <input {...props} disabled readOnly />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
