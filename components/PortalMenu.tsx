import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'right' | 'left';
  width?: number;
}

const PortalMenu: React.FC<Props> = ({ anchorEl, open, onClose, children, align = 'right', width = 200 }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }

    const update = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = width;
      const left = align === 'right' ? rect.right - menuWidth : rect.left;
      const top = rect.bottom + 8; // small gap
      setPos({ top, left });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorEl, open, align, width]);

  useEffect(() => {
    if (!open) return;
    const handleDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!anchorEl) return;
      if (anchorEl.contains(target)) return;
      // allow clicks inside portal children
      const portalRoot = document.getElementById('portal-menu-root');
      if (portalRoot && portalRoot.contains(target)) return;
      onClose();
    };
    document.addEventListener('click', handleDoc);
    return () => document.removeEventListener('click', handleDoc);
  }, [open, anchorEl, onClose]);

  if (!open || !pos) return null;

  const menu = (
    <div id="portal-menu-root" className="fixed left-0 top-0 z-[2000] pointer-events-none">
      <div
        style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
        className="pointer-events-auto overflow-hidden rounded-lg border border-gray-100 bg-white py-2 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );

  return createPortal(menu, document.body);
};

export default PortalMenu;
