import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOrder } from '../src/hooks/useQueries';

const PrintCollage: React.FC = () => {
  const { id } = useParams();
  const { data: order } = useOrder(id || '');
  const images = (order?.collageUrls || []).filter(Boolean);
  const [loadedImages, setLoadedImages] = useState(0);
  const printed = useRef(false);

  useEffect(() => {
    if (!order || images.length === 0 || loadedImages < images.length || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(timer);
  }, [images.length, loadedImages, order]);

  const finishImageLoad = () => setLoadedImages((count) => count + 1);

  return (
    <main className="collage-print-document">
      {images.map((image, index) => (
        <section className="collage-print-page" key={`${image}-${index}`}>
          <img src={image} alt="" onLoad={finishImageLoad} onError={finishImageLoad} />
        </section>
      ))}
      <style>{`
        @page { margin: 0; size: auto; }
        html, body, #root { margin: 0; min-height: 100%; background: #fff; }
        .collage-print-page { box-sizing: border-box; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; }
        .collage-print-page img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
        @media print {
          .collage-print-page { width: 100vw; height: 100vh; }
          .collage-print-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    </main>
  );
};

export default PrintCollage;