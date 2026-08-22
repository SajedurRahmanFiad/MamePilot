import { useEffect, useRef, useCallback, useState } from 'react';

interface UseAutoSaveOptions {
  save: () => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
}

export function useAutoSave({ save, debounceMs = 800, enabled = true }: UseAutoSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const saveCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const trigger = useCallback(() => {
    if (!enabled || savingRef.current) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsSaving(true);
      try {
        await save();
        saveCountRef.current += 1;
        setLastSavedAt(Date.now());
      } catch (err) {
        console.error('Auto-save failed:', err);
      } finally {
        setIsSaving(false);
        savingRef.current = false;
      }
    }, debounceMs);
  }, [save, debounceMs, enabled]);

  const isPending = isSaving || (timeoutRef.current !== null && !savingRef.current);

  return { isSaving, isPending, lastSavedAt, trigger, saveCount: saveCountRef.current };
}
