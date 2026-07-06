import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { theme } from '../theme';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  containerClassName?: string;
  contentClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  containerClassName = '',
  contentClassName = '',
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev || '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const portalTarget = document.getElementById('modal-root') || document.body;
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-5xl',
  };

  return ReactDOM.createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9998]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div
          className={`${theme.card.elevated} w-full ${sizeClasses[size]} animate-in fade-in slide-in-from-bottom-4 duration-300 ${containerClassName}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="border-b border-gray-100 p-6">
            <h2 className={`${theme.typography.title.sm}`}>{title}</h2>
          </div>

          {/* Content */}
          <div className={`p-6 max-h-[60vh] overflow-y-auto ${contentClassName}`}>{children}</div>

          {/* Footer */}
          {footer && (
            <div className="border-t border-gray-100 p-6 flex gap-3 justify-end bg-gray-50 rounded-b-2xl">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    portalTarget,
  );
};

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'info' | 'warning' | 'danger';
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
}) => {
  const colorClass = {
    info: theme.colors.primary,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
  }[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          className={`${theme.buttons.base} ${theme.buttons.secondary} ${theme.buttons.sizes.md}`}
        >
          {cancelText}
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`${theme.buttons.base} ${
            variant === 'danger'
              ? theme.buttons.danger
              : `${colorClass[500 as keyof typeof colorClass]} text-white hover:${colorClass[700]}`
          } ${theme.buttons.sizes.md}`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};
