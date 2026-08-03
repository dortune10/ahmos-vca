import { TableHTMLAttributes, ReactNode } from 'react';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

// Cell styling lives here rather than on every `<th>`/`<td>` in nine screens: this is the
// single highest-leverage surface in the app, and a records system is only as scannable as
// its tables. Column headers take the mono `data` face — they are labels, which is the job
// that face has in this system — while cell text stays in `ui` so a patient's name reads as
// a name.
//
// Note the colours are set as `border-b-*`, not `border-*`. A plain `border-paper-rule` here
// would set *all four* border colours at descendant-selector specificity (0,1,2) and would
// then beat any single-class colour a page puts on an individual cell. Pinning only the
// bottom edge leaves the left/right edges free for row-level emphasis.
const CELLS = [
  // Header row
  '[&_thead_th]:whitespace-nowrap [&_thead_th]:border-b [&_thead_th]:border-b-ink/20',
  '[&_thead_th]:px-3 [&_thead_th]:py-2 [&_thead_th]:text-left [&_thead_th]:align-bottom',
  '[&_thead_th]:font-data [&_thead_th]:text-[0.625rem] [&_thead_th]:font-medium',
  '[&_thead_th]:uppercase [&_thead_th]:tracking-[0.14em] [&_thead_th]:text-ink-muted',
  // Body cells
  '[&_tbody_td]:border-b [&_tbody_td]:border-b-paper-rule',
  '[&_tbody_td]:px-3 [&_tbody_td]:py-2.5 [&_tbody_td]:align-middle',
  '[&_tbody_td]:text-ink-soft [&_tbody_td]:tabular-nums',
  '[&_tbody_tr:last-child>td]:border-b-0',
  // Flush with the containing card's padding so the table's first column lines up with the
  // panel heading above it instead of sitting in a double inset.
  '[&_th:first-child]:pl-0 [&_td:first-child]:pl-0',
  '[&_th:last-child]:pr-0 [&_td:last-child]:pr-0',
].join(' ');

export function Table({ children, className = '', ...rest }: TableProps) {
  return (
    // Four-to-six column clinical tables do not fit a 375px phone, and truncating a patient
    // record is not an option, so the table scrolls inside its own container rather than
    // pushing the page sideways.
    <div className="overflow-x-auto">
      <table className={`min-w-full text-left text-sm ${CELLS} ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}
