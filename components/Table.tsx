import React, { ReactNode } from 'react';
import { theme } from '../theme';
import TableLoadingSkeleton from './TableLoadingSkeleton';

/**
 * Column definition for tables
 */
export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  nowrap?: boolean;
  render?: (value: any, item: any, index: number) => ReactNode;
}

/**
 * Table component - flexible data-driven table with built-in styling
 */
interface TableProps {
  columns: TableColumn[];
  data: Array<Record<string, any>>;
  emptyMessage?: string;
  onRowClick?: (item: any, index: number) => void;
  onRowHover?: (item: any, index: number) => void;
  rowClassName?: (item: any, index: number) => string;
  hover?: boolean;
  striped?: boolean;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  loadingRows?: number;
}

export const Table: React.FC<TableProps> = ({
  columns,
  data,
  emptyMessage = 'No data found',
  onRowClick,
  onRowHover,
  rowClassName,
  hover = true,
  striped = false,
  size = 'md',
  loading = false,
  loadingRows = 8,
}) => {
  const cellPadding = {
    sm: 'px-4 py-3',
    md: 'px-6 py-5',
    lg: 'px-6 py-6',
  }[size];
  const showLoading = loading;

  const rowHoverClass = hover ? 'hover:bg-[#ebf4ff]/50 cursor-pointer transition-all' : '';
  const stripedClass = striped ? 'odd:bg-gray-50' : '';

  return (
    <div className={`${theme.card.base} overflow-visible`}>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left">
          <thead>
            <tr className={theme.table.header}>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`${cellPadding} text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ${
                    column.align === 'center'
                      ? 'text-center'
                      : column.align === 'right'
                        ? 'text-right'
                        : ''
                  }`}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {showLoading ? (
              <TableLoadingSkeleton columns={columns.length} rows={loadingRows} />
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-20 text-center text-gray-400 italic font-medium"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, index) => (
                <tr
                  key={item.id || index}
                  onClick={() => onRowClick?.(item, index)}
                  onMouseEnter={() => onRowHover?.(item, index)}
                  className={`
                    border-b border-gray-50 transition-all
                    ${rowHoverClass}
                    ${stripedClass}
                    ${rowClassName?.(item, index) || ''}
                  `}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${cellPadding} ${
                        column.align === 'center'
                          ? 'text-center'
                          : column.align === 'right'
                            ? 'text-right'
                            : ''
                      } ${column.nowrap ? 'whitespace-nowrap' : ''}`}
                    >
                      {column.render
                        ? column.render(item[column.key], item, index)
                        : item[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * TableCell - for backward compatibility and custom row rendering
 */
interface TableCellProps {
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  colSpan?: number;
  className?: string;
}

export const TableCell: React.FC<TableCellProps> = ({
  children,
  align = 'left',
  colSpan,
  className = '',
}) => (
  <td
    colSpan={colSpan}
    className={`${theme.table.bodyCell} ${
      align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''
    } ${className}`}
  >
    {children}
  </td>
);

/**
 * TableHeader - for custom table headers
 */
interface TableHeaderProps {
  children: ReactNode;
  className?: string;
}

export const TableHeader: React.FC<TableHeaderProps> = ({
  children,
  className = '',
}) => (
  <thead>
    <tr className={`${theme.table.header} ${className}`}>{children}</tr>
  </thead>
);

/**
 * TableBody - for custom table bodies
 */
interface TableBodyProps {
  children: ReactNode;
}

export const TableBody: React.FC<TableBodyProps> = ({ children }) => (
  <tbody className="divide-y divide-gray-50">{children}</tbody>
);

/**
 * TableRow - for custom rows
 */
interface TableRowProps {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  hover?: boolean;
  className?: string;
}

export const TableRow: React.FC<TableRowProps> = ({
  children,
  onClick,
  hover = true,
  className = '',
}) => (
  <tr
    onClick={onClick}
    className={`border-b border-gray-50 transition-all ${hover ? 'hover:bg-[#ebf4ff]/50 cursor-pointer' : ''} ${className}`}
  >
    {children}
  </tr>
);
