import { ReactNode } from 'react';

export interface PageHeaderProps {
  /**
   * What this screen is showing, and the scope it is showing it at — "Your facility",
   * "All facilities", "Assigned to you". Not a restatement of the title: a health worker
   * moving between screens needs to know whose records are on the page before reading a row.
   */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, className = '' }: PageHeaderProps) {
  return (
    <header className={`border-b border-ink/15 pb-4 ${className}`}>
      {eyebrow && (
        <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.18em] text-ink-muted">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-1.5 font-display text-2xl leading-tight tracking-[-0.01em] text-ink sm:text-[1.75rem]">
        {title}
      </h1>
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
      )}
    </header>
  );
}
