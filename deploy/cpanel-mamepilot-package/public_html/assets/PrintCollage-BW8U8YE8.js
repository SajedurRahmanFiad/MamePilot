import{r as i,j as r}from"./vendor-K-96t4is.js";import{ap as m}from"./index-H4VN-8Cw.js";import{d as p}from"./router-DvQ5GHgr.js";import"./react-query-Dt6GkCro.js";import"./icons-DPEg-2vS.js";const w=()=>{const{id:l}=p(),{data:t}=m(l||""),a=((t==null?void 0:t.collageUrls)||[]).filter(Boolean),[o,c]=i.useState(0),n=i.useRef(!1);i.useEffect(()=>{if(!t||a.length===0||o<a.length||n.current)return;n.current=!0;const e=window.setTimeout(()=>window.print(),150);return()=>window.clearTimeout(e)},[a.length,o,t]);const s=()=>c(e=>e+1);return r.jsxs("main",{className:"collage-print-document",children:[a.map((e,g)=>r.jsx("section",{className:"collage-print-page",children:r.jsx("img",{src:e,alt:"",onLoad:s,onError:s})},`${e}-${g}`)),r.jsx("style",{children:`
        @page { margin: 0; size: auto; }
        html, body, #root { margin: 0; min-height: 100%; background: #fff; }
        .collage-print-page { box-sizing: border-box; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; break-after: page; page-break-after: always; }
        .collage-print-page img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
        @media print {
          .collage-print-page { width: 100vw; height: 100vh; }
          .collage-print-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `})]})};export{w as default};
