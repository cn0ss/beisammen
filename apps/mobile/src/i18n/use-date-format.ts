import { useLocale } from 'gt-react-native';
import { useMemo } from 'react';

// Returns a date formatter for the active app locale. Pass a module-level
// constant options object so the memo stays stable.
export function useDateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = useLocale();
  return useMemo(() => new Intl.DateTimeFormat(locale, options), [locale, options]);
}
