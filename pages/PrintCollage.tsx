import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db';
import { useCompanySettings, useOrder } from '../src/hooks/useQueries';
import { getOrderCompanyPage } from '../src/utils/companyPages';
import { formatDate } from '../utils';

const PrintCollage: React.FC = () => {
  const { id } = useParams();
  const { data: order } = useOrder(id || '');
  const { data: companySettings, isPending: companySettingsLoading } = useCompanySettings();
  const images = (order?.collageUrls || []).filter(Boolean);
  const [loadedImages, setLoadedImages] = useState(0);
  const [printDate] = useState(() => formatDate(new Date()));
  const printed = useRef(false);
  const assignedCompany = getOrderCompanyPage(order, companySettings || db.settings.company);

  useEffect(() => {
    if (!order || companySettingsLoading || images.length === 0 || loadedImages < images.length || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [companySettingsLoading, images.length, loadedImages, order]);

  const finishImageLoad = () => setLoadedImages((count) => count + 1);

  return (
    <main className="collage-print-document">
      {images.map((image, index) => (
        <section className={`collage-print-page${index < images.length - 1 ? ' collage-print-page-break' : ''}`} key={`${image}-${index}`}>
          <div className="collage-print-meta" aria-label="Collage print details">
            <span>Printed {printDate}</span>
            <span>Order {order?.orderNumber || '—'}</span>
            <span>{assignedCompany.name || '—'}</span>
          </div>
          <img src={image} alt="" onLoad={finishImageLoad} onError={finishImageLoad} />
        </section>
      ))}
      <style>{`
        @page { margin: 0; size: auto; }
        html, body, #root { margin: 0; min-height: 100%; background: #fff; }
        .collage-print-page { position: relative; box-sizing: border-box; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: auto; page-break-after: auto; }
        .collage-print-page-break { break-after: page; page-break-after: always; }
        .collage-print-page img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
        .collage-print-meta { position: absolute; z-index: 1; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0.7rem; color: #fff; background: rgba(15, 23, 42, 0.78); font: 600 12px/1.3 Arial, sans-serif; pointer-events: none; }
        @media print {
          .collage-print-page { width: 100vw; height: 100vh; }
          .collage-print-meta { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </main>
  );
};

export default PrintCollage;