import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | OdexWA" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | OdexWA`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
