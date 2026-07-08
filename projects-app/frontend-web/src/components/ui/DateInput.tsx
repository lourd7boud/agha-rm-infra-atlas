/**
 * 🔒 DateInput — Composant unifié pour les dates au format dd/MM/yyyy
 * 
 * Remplace tous les <input type="date"> natifs pour garantir
 * un affichage cohérent en format français (jj/mm/aaaa) partout.
 * 
 * Usage:
 *   <DateInput value="2025-09-10" onChange={(val) => setDate(val)} />
 *   <DateInput value={date} onChange={setDate} label="Date début" />
 */
import { FC, useState, useRef, useEffect } from 'react';

interface DateInputProps {
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
}

/**
 * Converts YYYY-MM-DD to dd/MM/yyyy for display
 */
const toDisplayDate = (isoDate: string | undefined): string => {
  if (!isoDate) return '';
  // Handle both YYYY-MM-DD and ISO datetime formats
  const dateStr = isoDate.split('T')[0];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  if (!year || !month || !day) return isoDate;
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
};

/**
 * Converts dd/MM/yyyy to YYYY-MM-DD for storage
 */
const toISODate = (displayDate: string): string => {
  const parts = displayDate.replace(/\D/g, '');
  if (parts.length < 8) return '';
  const day = parts.substring(0, 2);
  const month = parts.substring(2, 4);
  const year = parts.substring(4, 8);
  
  const d = parseInt(day), m = parseInt(month), y = parseInt(year);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return '';
  
  return `${year}-${month}-${day}`;
};

/**
 * Auto-formats input as user types: dd/MM/yyyy
 */
const autoFormat = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
};

const DateInput: FC<DateInputProps> = ({
  value,
  onChange,
  className = '',
  required,
  disabled,
  min,
  max,
  id,
  name,
}) => {
  const [displayValue, setDisplayValue] = useState(() => toDisplayDate(value));
  const [isFocused, setIsFocused] = useState(false);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Sync with external value changes
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(toDisplayDate(value));
    }
  }, [value, isFocused]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = autoFormat(e.target.value);
    setDisplayValue(formatted);

    // If complete date (10 chars: dd/MM/yyyy), emit the ISO value
    if (formatted.length === 10) {
      const iso = toISODate(formatted);
      if (iso && onChange) {
        onChange(iso);
      }
    }
  };

  const handleTextBlur = () => {
    setIsFocused(false);
    // On blur, validate and reformat
    if (displayValue.length === 10) {
      const iso = toISODate(displayValue);
      if (iso) {
        setDisplayValue(toDisplayDate(iso));
        if (onChange) onChange(iso);
      } else {
        // Invalid date, revert to original value
        setDisplayValue(toDisplayDate(value));
      }
    } else if (displayValue.length === 0) {
      if (onChange) onChange('');
    } else {
      // Incomplete date, revert
      setDisplayValue(toDisplayDate(value));
    }
  };

  const handleNativeDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value; // YYYY-MM-DD
    setDisplayValue(toDisplayDate(newValue));
    if (onChange) onChange(newValue);
  };

  const openNativePicker = () => {
    if (hiddenInputRef.current && !disabled) {
      hiddenInputRef.current.showPicker?.();
    }
  };

  return (
    <div className="relative inline-flex items-center">
      {/* Visible text input showing dd/MM/yyyy */}
      <input
        ref={textInputRef}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleTextChange}
        onFocus={() => setIsFocused(true)}
        onBlur={handleTextBlur}
        placeholder="jj/mm/aaaa"
        maxLength={10}
        className={className || 'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm'}
        required={required}
        disabled={disabled}
        id={id}
        name={name}
        autoComplete="off"
      />
      {/* Calendar icon button that opens native picker */}
      <button
        type="button"
        onClick={openNativePicker}
        className="absolute right-2 text-gray-400 hover:text-gray-600"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Ouvrir le calendrier"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      </button>
      {/* Hidden native date input for the calendar picker */}
      <input
        ref={hiddenInputRef}
        type="date"
        value={value || ''}
        onChange={handleNativeDateChange}
        className="absolute inset-0 opacity-0 pointer-events-none"
        tabIndex={-1}
        min={min}
        max={max}
        aria-hidden="true"
      />
    </div>
  );
};

export default DateInput;

/**
 * Utility: Format any date string or Date to dd/MM/yyyy
 * Use this for all date displays across the app.
 */
export const formatDateFR = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '-';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '-';
  }
};

/**
 * Utility: Format date with time to dd/MM/yyyy à HH:mm
 */
export const formatDateTimeFR = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '-';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return '-';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} à ${hours}:${minutes}`;
  } catch {
    return '-';
  }
};
