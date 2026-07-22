import React, { createContext, useContext, useState, useCallback } from 'react';
import { toastMessage } from '../utils/userFacingMessages';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number; // in ms, 0 means manually dismissible
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type: ToastType, duration?: number) => string;
  dismissToast: (id: string) => void;
  updateToast: (id: string, message: string, type: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType, duration: number = 3500) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, message: toastMessage(message, type), type, duration };

    setToasts((prev) => [...prev, toast]);

    // Auto dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateToast = useCallback((id: string, message: string, type: ToastType, duration: number = 3500) => {
    setToasts((prev) => {
      const updated = prev.map((t) => 
        t.id === id ? { ...t, message: toastMessage(message, type), type, duration } : t
      );
      
      // Auto dismiss after duration if it's being updated
      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }
      
      return updated;
    });
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast, updateToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Convenience functions for common toast types
export const useToastNotifications = () => {
  const { showToast, updateToast } = useToast();

  return {
    success: (message: string) => showToast(message, 'success', 3500),
    error: (message: string) => showToast(message, 'error', 4500),
    warning: (message: string) => showToast(message, 'warning', 3500),
    info: (message: string) => showToast(message, 'info', 3500),
    loading: (message: string) => showToast(message, 'info', 0),  // 0 duration = manual dismiss
    update: (id: string, message: string, type: 'success' | 'error' = 'success') => updateToast(id, message, type, 3500),
  };
};
