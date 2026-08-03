import { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 * The panel every dashboard is built out of. White on the page's `paper`, so a record always
 * sits slightly above its surroundings, with the same hairline and near-invisible drop shadow
 * the landing page uses for the example episode card.
 */
export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-paper-rule bg-white p-4 shadow-[0_1px_2px_rgba(14,35,32,0.04),0_10px_28px_-24px_rgba(14,35,32,0.45)] sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Section heading inside a Card. Split out because six screens were each hand-rolling
 * `text-lg font-medium` and drifting apart; the mono kicker keeps a panel title distinct from
 * the page's `display` h1 without competing with it.
 */
export function CardTitle({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`font-display text-lg leading-snug text-ink ${className}`}>{children}</h2>
  );
}
