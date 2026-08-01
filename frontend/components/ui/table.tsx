import { TableHTMLAttributes, ReactNode } from 'react';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ children, className = '', ...rest }: TableProps) {
  return (
    <table className={`min-w-full divide-y divide-gray-200 ${className}`} {...rest}>
      {children}
    </table>
  );
}
