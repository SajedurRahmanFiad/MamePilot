import React from 'react';
import { NumericInput } from '../../components';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  pageSize?: number;
  disabled?: boolean;
}

const Pagination: React.FC<Props> = ({ page, totalPages, onPageChange, pageSize, disabled }) => {
  const [input, setInput] = React.useState(String(page));

  React.useEffect(() => setInput(String(page)), [page]);

  const applyInput = () => {
    let p = parseInt(input || '1', 10) || 1;
    if (p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    if (p !== page) onPageChange(p);
    setInput(String(p));
  };

  return (
    <div className="flex items-center justify-between mt-4">
      <div className="text-sm text-gray-600">
        {`Page ${page} of ${totalPages}`}
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(1)}
          className={`px-3 py-1 rounded-md font-bold ${page <= 1 ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 border'}`}
        >
          «
        </button>
        <button
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className={`px-3 py-1 rounded-md font-bold ${page <= 1 ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 border'}`}
        >
          ‹
        </button>

        <NumericInput
          value={input || 1}
          onChange={(value) => {
            let p = Math.max(1, Math.min(totalPages, value || 1));
            setInput(String(p));
            if (p !== page) onPageChange(p);
          }}
          className="w-16 px-2 py-1 border rounded-md text-center text-sm"
          allowDecimals={false}
        />

        <button
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className={`px-3 py-1 rounded-md font-bold ${page >= totalPages ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 border'}`}
        >
          ›
        </button>
        <button
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className={`px-3 py-1 rounded-md font-bold ${page >= totalPages ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 border'}`}
        >
          »
        </button>
      </div>
    </div>
  );
};

export default Pagination;
