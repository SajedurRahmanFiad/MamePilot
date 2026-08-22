import { useEffect, useRef, useCallback, useState } from 'react';

interface UseAutoSaveOptions {
  save: () => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave({ save, debounceMs = 800 }: UseAutoSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const saveFnRef = useRef(save);
  saveFnRef.current = save;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setIsSaving(true);
      try {
        await saveFnRef.current();
        if (mountedRef.current) {
          setLastSavedAt(Date.now());
        }
      } catch (err) {
        console.error('Auto-save failed:', err);
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
        timeoutRef.current = null;
      }
    }, debounceMs);
  }, [debounceMs]);

  return { isSaving, lastSavedAt, trigger };
}
