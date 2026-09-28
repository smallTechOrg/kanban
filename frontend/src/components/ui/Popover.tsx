import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { ChevronLeft, X } from 'lucide-react';
import { IconButton } from './IconButton';
import styles from './Popover.module.css';

/** 8px offset from the trigger, and the same padding for `shift` (Section 2.1.2). */
const GAP = 8;

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Push and pop the nested view stack, or close the whole popover. */
export interface PopoverNav {
  push: (view: PopoverView) => void;
  pop: () => void;
  close: () => void;
}

/** Content is either static or a function of the navigation helpers. */
export type PopoverContent = ReactNode | ((nav: PopoverNav) => ReactNode);

export interface PopoverView {
  title: string;
  content: PopoverContent;
}

export interface PopoverProps {
  /** The trigger element, or a rect for a context-menu style anchor. */
  anchor: HTMLElement | DOMRect;
  /** Header title of the root view. */
  title: string;
  onClose: () => void;
  children: PopoverContent;
  /** Overrides the 304px default (a runtime value, so it is an inline style). */
  width?: number;
}

function renderContent(content: PopoverContent, nav: PopoverNav): ReactNode {
  return typeof content === 'function' ? content(nav) : content;
}

/**
 * The 304px anchored panel of Section 2.1.2: header with an optional back chevron and a
 * close X, a nested view stack, Escape and outside-click dismissal, trapped focus and focus
 * returned to the trigger.
 *
 * It is controlled: rendering it means it is open. Callers drive it from
 * `uiStore.openPopover`, which holds at most one entry, and that is what keeps exactly one
 * popover open at a time.
 */
export function Popover({ anchor, title, onClose, children, width }: PopoverProps): ReactElement {
  const [stack, setStack] = useState<readonly PopoverView[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const reference = useMemo(
    () => (anchor instanceof Element ? anchor : { getBoundingClientRect: (): DOMRect => anchor }),
    [anchor],
  );

  const { refs, elements, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: 'bottom-start',
    middleware: [
      offset(GAP),
      flip(),
      shift({ padding: GAP }),
      // The panel is capped to the space actually left below (or above) the trigger, and its
      // content scrolls inside that: `DatesPopover`'s calendar makes the tallest panel in the
      // app 616px, which no 720px-high window can show under a sidebar button, and the Save
      // button at its foot was simply unreachable. The value is written as a custom property
      // rather than through React state so a reposition never re-renders the panel, and
      // `Popover.module.css` takes the smaller of it and the documented 80vh.
      size({
        padding: GAP,
        apply: ({ availableHeight, elements }) => {
          elements.floating.style.setProperty(
            '--popover-avail-h',
            `${String(Math.round(availableHeight))}px`,
          );
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  // A DOMRect anchor (a context-menu style position) is a virtual element, which only
  // `setPositionReference` accepts; a layout effect sets it before the first paint.
  useLayoutEffect(() => {
    refs.setPositionReference(reference);
  }, [reference, refs]);

  const { getFloatingProps } = useInteractions([
    useDismiss(context, { escapeKey: true, outsidePress: true }),
    useRole(context, { role: 'dialog' }),
  ]);

  const nav = useMemo<PopoverNav>(
    () => ({
      push: (view) => setStack((current) => [...current, view]),
      pop: () => setStack((current) => current.slice(0, -1)),
      close: onClose,
    }),
    [onClose],
  );

  const depth = stack.length;
  const view = stack[depth - 1];
  const heading = view === undefined ? title : view.title;
  const body = view === undefined ? children : view.content;

  // Section 5.10: initial focus goes to the first control of the view, not the close button,
  // and a pushed view keeps focus inside the panel. `initialFocus={-1}` below hands the
  // choice to this effect (FloatingFocusManager would otherwise focus the header button).
  // `elements.floating` is the dependency because FloatingPortal mounts its children one
  // render after this component, so the panel does not exist on the first pass.
  const panel = elements.floating;
  useEffect(() => {
    if (panel === null) return;
    const control = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (control ?? panel).focus();
  }, [depth, panel]);

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} initialFocus={-1} modal>
        <div
          ref={refs.setFloating}
          className={styles.panel}
          style={width === undefined ? floatingStyles : { ...floatingStyles, width }}
          aria-labelledby={headingId}
          tabIndex={-1}
          {...getFloatingProps()}
        >
          <div className={styles.header}>
            <div>
              {depth > 0 ? (
                <IconButton label="Back" size="sm" onClick={nav.pop}>
                  <ChevronLeft aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
            <div className={styles.title} id={headingId}>
              {heading}
            </div>
            <div>
              <IconButton label="Close" size="sm" onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          <div className={styles.content} key={depth} ref={contentRef}>
            {renderContent(body, nav)}
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
