import React from 'react';
import { theme } from '../theme';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <label className={theme.inputs.label}>{label}</label>}
        <input
          ref={ref}
          className={`${theme.inputs.base} ${error ? theme.inputs.error : ''} ${className}`}
          {...props}
        />
        {(error || helperText) && (
          <p className={`mt-1 text-xs ${error ? 'text-red-500' : 'text-gray-500'}`}>
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string | number; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <label className={theme.inputs.label}>{label}</label>}
        <select
          ref={ref}
          className={`${theme.inputs.base} ${error ? theme.inputs.error : ''} ${className}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-red-500">{error instanceof Error ? error.message : String(error)}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

interface TextAreaProps extends React.TextAreaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <label className={theme.inputs.label}>{label}</label>}
        <textarea
          ref={ref}
          className={`${theme.inputs.base} resize-none ${error ? theme.inputs.error : ''} ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-red-500">{error instanceof Error ? error.message : String(error)}</p>}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  error?: string;
  helperText?: string;
  value: number | string;
  onChange: (value: number) => void;
  allowDecimals?: boolean;
  decimalPlaces?: number;
}

/**
 * NumericInput component - Allows complete clearing and proper numeric entry
 * Treats empty input as 0
 * Supports integers and decimals
 * Can be easily customized in one place for all numeric inputs
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ 
    label, 
    error, 
    helperText, 
    className = '', 
    value,
    onChange,
    allowDecimals = true,
    decimalPlaces = 2,
    ...props 
  }, ref) => {
    const [displayValue, setDisplayValue] = React.useState<string>(
      value ? String(value) : ''
    );

    React.useEffect(() => {
      setDisplayValue(value ? String(value) : '');
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let inputValue = e.target.value;

      // Allow empty input
      if (inputValue === '') {
        setDisplayValue('');
        onChange(0);
        return;
      }

      // Handle negative numbers - allow minus sign at the beginning
      let isNegative = inputValue.startsWith('-');
      let workingValue = isNegative ? inputValue.slice(1) : inputValue;

      // Remove all non-numeric characters except decimal point
      if (allowDecimals) {
        // Split by decimal point and validate
        const parts = workingValue.split('.');
        if (parts.length > 2) {
          // Too many decimal points, keep the previous valid value
          return;
        }
        
        // Remove non-digits from each part
        workingValue = parts
          .map((part, index) => part.replace(/\D/g, ''))
          .join('.');
        
        // Limit decimal places
        if (parts.length === 2 && parts[1].length > decimalPlaces) {
          const integerPart = parts[0];
          const decimalPart = parts[1].slice(0, decimalPlaces);
          workingValue = `${integerPart}.${decimalPart}`;
        }
      } else {
        workingValue = workingValue.replace(/\D/g, '');
      }

      // Reconstruct the value with negative sign if needed
      const finalValue = isNegative ? `-${workingValue}` : workingValue;

      setDisplayValue(finalValue);
      
      // Convert to number and pass to onChange
      const numericValue = parseFloat(finalValue) || 0;
      onChange(numericValue);
    };

    return (
      <div className="w-full">
        {label && <label className={theme.inputs.label}>{label}</label>}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleChange}
          className={`${theme.inputs.base} ${error ? theme.inputs.error : ''} ${className}`}
          {...props}
        />
        {(error || helperText) && (
          <p className={`mt-1 text-xs ${error ? 'text-red-500' : 'text-gray-500'}`}>
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

NumericInput.displayName = 'NumericInput';
