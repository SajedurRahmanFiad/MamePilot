import{r as i,j as t}from"./vendor-K-96t4is.js";import{aq as u,N as h,Z as x,aY as b,w}from"./index-CISsEJWe.js";import{d as j}from"./router-DvQ5GHgr.js";import"./react-query-Dt6GkCro.js";import"./icons-ZwY3gNqL.js";const P=()=>{const{id:c}=j(),{data:e}=u(c||""),{data:p,isPending:s}=h(),n=((e==null?void 0:e.collageUrls)||[]).filter(Boolean),[r,g]=i.useState(0),[d]=i.useState(()=>x(new Date)),o=i.useRef(!1),m=b(e,p||w.settings.company);i.useEffect(()=>{if(!e||s||n.length===0||r<n.length||o.current)return;o.current=!0;const a=window.setTimeout(()=>window.print(),150);return()=>window.clearTimeout(a)},[s,n.length,r,e]);const l=()=>g(a=>a+1);return t.jsxs("main",{className:"collage-print-document",children:[n.map((a,f)=>t.jsxs("section",{className:"collage-print-page",children:[t.jsxs("div",{className:"collage-print-meta","aria-label":"Collage print details",children:[t.jsxs("span",{children:["Printed ",d]}),t.jsxs("span",{children:["Order ",(e==null?void 0:e.orderNumber)||"—"]}),t.jsx("span",{children:m.name||"—"})]}),t.jsx("img",{src:a,alt:"",onLoad:l,onError:l})]},`${a}-${f}`)),t.jsx("style",{children:`
        @page { margin: 0; size: auto; }
        html, body, #root { margin: 0; min-height: 100%; background: #fff; }
        .collage-print-page { position: relative; box-sizing: border-box; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: auto; page-break-after: auto; }
        .collage-print-page:not(:last-child) { break-after: page; page-break-after: always; }
        .collage-print-page img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
        .collage-print-meta { position: absolute; z-index: 1; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0.7rem; color: #fff; background: rgba(15, 23, 42, 0.78); font: 600 12px/1.3 Arial, sans-serif; pointer-events: none; }
        @media print {
          .collage-print-page { width: 100vw; height: 100vh; }
          .collage-print-meta { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `})]})};export{P as default};
