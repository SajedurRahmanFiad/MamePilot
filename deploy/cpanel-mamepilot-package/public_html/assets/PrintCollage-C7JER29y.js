import{r,j as t}from"./vendor-K-96t4is.js";import{aq as u,N as h,Z as b,aY as x,w}from"./index-DvyqDNos.js";import{d as j}from"./router-DvQ5GHgr.js";import"./react-query-Dt6GkCro.js";import"./icons-ZwY3gNqL.js";const P=()=>{const{id:p}=j(),{data:e}=u(p||""),{data:g,isPending:i}=h(),n=((e==null?void 0:e.collageUrls)||[]).filter(Boolean),[s,m]=r.useState(0),[d]=r.useState(()=>b(new Date)),o=r.useRef(!1),f=x(e,g||w.settings.company);r.useEffect(()=>{if(!e||i||n.length===0||s<n.length||o.current)return;o.current=!0;const a=window.setTimeout(()=>window.print(),150);return()=>window.clearTimeout(a)},[i,n.length,s,e]);const l=()=>m(a=>a+1);return t.jsxs("main",{className:"collage-print-document",children:[n.map((a,c)=>t.jsxs("section",{className:`collage-print-page${c<n.length-1?" collage-print-page-break":""}`,children:[t.jsxs("div",{className:"collage-print-meta","aria-label":"Collage print details",children:[t.jsxs("span",{children:["Printed ",d]}),t.jsxs("span",{children:["Order ",(e==null?void 0:e.orderNumber)||"—"]}),t.jsx("span",{children:f.name||"—"})]}),t.jsx("img",{src:a,alt:"",onLoad:l,onError:l})]},`${a}-${c}`)),t.jsx("style",{children:`
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
      `})]})};export{P as default};
