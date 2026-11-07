'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from './ThemeContext';

interface ThemeToggleProps {
  className?: string;
  size?: number;
}

export function ThemeToggle({ className = '', size = 20 }: ThemeToggleProps) {
  const { theme, toggleTheme, isLight } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = isLight
    ? 'Passer au mode sombre (الوضع الداكن)'
    : 'Passer au mode clair (الوضع الأبيض)';

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className={`group relative flex items-center justify-center rounded-md p-1.5 text-muted transition duration-200 hover:bg-rail-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${className}`}
    >
      {!mounted ? (
        <Icon
          name="sun"
          size={size}
          className="transition-transform duration-300 group-hover:scale-110 group-hover:text-ochre"
        />
      ) : isLight ? (
        <Icon
          name="moon"
          size={size}
          className="text-muted transition-transform duration-300 group-hover:scale-110 group-hover:text-cyan"
        />
      ) : (
        <Icon
          name="sun"
          size={size}
          className="text-muted transition-transform duration-300 group-hover:scale-110 group-hover:text-ochre"
        />
      )}
    </button>
  );
}
