import{j as e}from"./vendor-K-96t4is.js";import{aX as k}from"./index-DxGu8Mhb.js";import{J as Y,_ as z,G as $,O as C}from"./icons-Cb-TRTEi.js";const T="text-[9px] sm:text-[10px] lg:text-[11px] font-semibold text-gray-500",D="mt-0.5 text-[10px] sm:text-[11px] lg:text-sm font-black text-slate-900 break-all",ee=({children:I,className:L="",contentClassName:R="p-3 sm:p-4 md:p-6 lg:p-10 space-y-3 sm:space-y-4 lg:space-y-5",style:F,company:s,invoiceNumber:r,invoiceNumberLabel:W="Invoice No.",invoiceDate:c,invoiceDateLabel:A="Date",themeColorHex:l="#0f2f57",logoWidth:p=64,logoHeight:g=64,customer:a,customerTitle:M="Billed To",customerSubtitle:S,customerAddressLabel:U="Address",customerAddress:_,customerDetailBlocks:q,items:m=[],hideRowNumbersOnMobile:f=!0,renderItemRow:h,totals:n=[],notes:d,footer:o,brandBlock:b,metadataBlock:v,customerBlock:j,tableBlock:u,totalsBlock:w,notesBlock:y,footerBlock:N})=>{const E=!!(b||v||j||u||w||y||N||s||r||c||a||m.length||n.length||d||o),G={width:`${p}px`,height:`${g}px`,maxWidth:"100%",maxHeight:"100%"},J=(t,x)=>e.jsxs("tr",{className:`group align-middle ${t.muted?"opacity-50":""}`,children:[e.jsx("td",{className:`${f?"hidden sm:table-cell":"table-cell"} py-3 sm:py-4 lg:py-5 px-2 sm:px-3 text-center font-bold text-gray-500`,children:x+1}),e.jsx("td",{className:"py-3 sm:py-4 lg:py-5 px-2 sm:px-3",children:e.jsxs("div",{className:"flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-3",children:[t.image?e.jsx("img",{src:t.image,className:`invoice-item-image h-7 w-7 rounded-full border border-gray-100 object-cover shadow-sm sm:h-8 sm:w-8 lg:h-10 lg:w-10 ${t.muted?"grayscale":""}`,alt:t.name}):e.jsx("div",{className:`invoice-item-image flex h-7 w-7 items-center justify-center rounded-full border border-gray-100 text-[9px] font-black shadow-sm sm:h-8 sm:w-8 lg:h-10 lg:w-10 ${t.muted?"grayscale":""}`,style:{backgroundColor:"#f6f8fc",color:l},children:(t.name||"?").slice(0,1).toUpperCase()}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("span",{className:`invoice-item-name block break-words text-[11px] font-bold sm:text-[12px] lg:text-[13px] ${t.muted?"text-gray-400 line-through":"text-gray-900"}`,children:t.name}),t.badge&&e.jsx("div",{className:"invoice-item-badge mt-0.5",children:t.badge})]})]})}),e.jsx("td",{className:"invoice-item-rate px-1 py-3 text-center text-[11px] font-bold text-gray-500 whitespace-nowrap sm:py-4 sm:text-[12px] lg:py-5 lg:text-[13px]",children:t.rate}),e.jsx("td",{className:"px-1 py-3 text-center whitespace-nowrap sm:py-4 lg:py-5",children:e.jsx("span",{className:`text-[11px] font-bold sm:text-[12px] lg:text-[13px] ${t.muted?"text-gray-400 line-through":"text-gray-500"}`,children:t.quantity})}),e.jsx("td",{className:"px-2 py-3 text-right whitespace-nowrap sm:px-3 sm:py-4 lg:py-5",children:e.jsx("span",{className:`invoice-item-total text-[11px] font-black sm:text-[12px] lg:text-[13px] ${t.muted?"text-gray-400 line-through":"text-gray-900"}`,children:t.total})})]},t.id??`${t.name}-${x}`),P=e.jsxs("div",{className:"invoice-customer-section rounded-lg px-4 py-4",style:{backgroundColor:`${l}12`},children:[e.jsxs("div",{className:"invoice-customer-title flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 sm:text-[11px]",children:[e.jsx(Y,{size:14,fill:"currentColor",style:{color:l}}),M]}),e.jsxs("div",{className:"mt-3 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-0",children:[e.jsxs("div",{className:"min-w-0 pr-3",children:[e.jsx("h3",{className:"invoice-customer-name text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm",children:(a==null?void 0:a.name)||"Walk-in Customer"}),S??(a!=null&&a.phone?e.jsx("p",{className:"invoice-customer-sub mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]",children:a.phone}):null)]}),e.jsxs("div",{className:"flex min-w-0 items-center gap-1.5 border-l border-gray-200 pl-3",children:[e.jsx("span",{className:"flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",style:{backgroundColor:`${l}1a`,color:l},children:e.jsx(z,{size:14})}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("p",{className:"invoice-address-label m-0 text-[8px] font-medium leading-tight text-gray-500 sm:text-[9px]",children:U}),e.jsx("p",{className:"invoice-address-value m-0 text-[10px] font-black leading-tight text-slate-900 whitespace-pre-line sm:text-xs",children:_||(a==null?void 0:a.address)||"N/A"})]})]})]}),q]}),Q=e.jsx("div",{className:"overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-10",children:e.jsx("div",{className:"px-3 sm:px-4 md:px-6 lg:px-10",children:e.jsxs("table",{className:"invoice-item-table w-full border border-gray-200 border-collapse overflow-hidden rounded-lg text-left text-[11px] sm:text-[12px] lg:text-[13px]",children:[e.jsx("thead",{children:e.jsxs("tr",{style:{backgroundColor:k(l,.15),color:"#ffffff"},children:[e.jsx("th",{className:`${f?"hidden sm:table-cell":"table-cell"} w-10 px-2 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]`,children:"#"}),e.jsx("th",{className:"px-2 py-2 text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]",children:"Item Description"}),e.jsx("th",{className:"whitespace-nowrap px-1 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]",children:"Rate"}),e.jsx("th",{className:"whitespace-nowrap px-1 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]",children:"Qty"}),e.jsx("th",{className:"whitespace-nowrap px-2 py-2 text-right text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 lg:py-4 lg:text-[13px]",children:"Total"})]})}),e.jsx("tbody",{className:"divide-y divide-gray-100 bg-white",children:h?m.map(h):m.map((t,x)=>J(t,x))})]})})}),V=e.jsx("div",{className:"flex flex-col items-end px-0",children:e.jsx("div",{className:"invoice-totals w-full max-w-[320px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm sm:w-full md:w-98 lg:max-w-xs print:max-w-[320px] print:w-[320px]",children:n.length?e.jsx(e.Fragment,{children:n.map((t,x)=>{const i=x===n.length-1,X="flex items-center justify-between border-t border-gray-100 px-3 py-2.5",K=t.tone==="success"?"text-emerald-600":t.tone==="theme"?"font-black":t.tone==="muted"?"text-gray-500":"text-gray-900",O=t.tone==="theme"||i;return e.jsxs("div",{className:i?"flex items-center justify-between px-3 py-2.5 text-white":X,style:i?{backgroundColor:k(l,.15),color:"#ffffff"}:void 0,children:[e.jsx("span",{className:["invoice-total-label uppercase tracking-wide",i?"invoice-total-final-label":"",i?"text-white":"text-gray-500",i?"text-[11px] font-black sm:text-[12px] lg:text-sm":"text-[10px] font-bold sm:text-[11px] lg:text-xs"].join(" "),children:t.label}),e.jsx("span",{className:["invoice-total-value",i?"invoice-total-final-value":"",i?"text-white":`${K} ${O?"text-gray-900":""}`,i?"text-[12px] font-black sm:text-[13px] lg:text-base":"text-[10px] font-black sm:text-[11px] lg:text-xs"].join(" "),children:t.value})]},`${t.label}-${x}`)})}):null})});return e.jsxs("div",{className:`invoice-layout-root overflow-hidden rounded-xl bg-white ${L}`,style:F,children:[e.jsx("div",{className:R,children:E?e.jsxs(e.Fragment,{children:[b??e.jsxs("div",{className:"flex flex-row items-start justify-between gap-3 sm:gap-4 lg:gap-6",children:[e.jsxs("div",{className:"min-w-0 flex-1",children:[e.jsxs("div",{className:"flex items-center gap-3 lg:gap-4",children:[(s==null?void 0:s.logo)&&e.jsx("img",{src:s.logo,className:"rounded-lg object-contain",width:p,height:g,style:G,alt:"Company Logo"}),e.jsxs("div",{className:"min-w-0 flex flex-col justify-center",children:[e.jsx("h1",{className:"invoice-brand-name break-words text-sm font-black tracking-tighter sm:text-base lg:text-xl",style:{color:l},children:(s==null?void 0:s.name)||"Company Name"}),(s==null?void 0:s.tagline)&&e.jsx("p",{className:"invoice-brand-tagline mt-0 text-[9px] font-semibold text-gray-400 sm:text-[10px] lg:text-xs",children:s.tagline})]})]}),e.jsxs("div",{className:"invoice-company-meta mt-3 flex flex-col gap-1 text-[9px] font-medium text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:text-[10px] lg:gap-x-5 lg:text-xs",children:[(s==null?void 0:s.phone)&&e.jsxs("p",{className:"flex items-center gap-2 break-words",children:[e.jsx($,{size:12,className:"flex-shrink-0 text-gray-400"}),s.phone]}),(s==null?void 0:s.email)&&e.jsxs("p",{className:"flex items-center gap-2 break-words",children:[e.jsx(C,{size:12,className:"flex-shrink-0 text-gray-400"}),s.email]}),(s==null?void 0:s.address)&&e.jsxs("p",{className:"flex items-center gap-2 break-words",children:[e.jsx(z,{size:12,className:"flex-shrink-0 text-gray-400"}),s.address]})]})]}),e.jsx("div",{className:"ml-auto inline-flex max-w-full flex-col items-start text-left sm:ml-0 sm:min-w-[210px] sm:flex-shrink-0",children:e.jsxs("div",{className:"flex w-fit max-w-full flex-col gap-2 text-left sm:flex-row sm:gap-2",children:[r&&e.jsxs("div",{className:"inline-flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5",style:{backgroundColor:`${l}14`},children:[e.jsx($,{size:16,className:"flex-shrink-0",style:{color:l}}),e.jsxs("div",{children:[e.jsx("p",{className:`${T} invoice-meta-label`,children:W}),e.jsx("p",{className:`${D} invoice-meta-value`,children:r})]})]}),c&&e.jsxs("div",{className:"inline-flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5",style:{backgroundColor:`${l}14`},children:[e.jsx(C,{size:16,className:"flex-shrink-0",style:{color:l}}),e.jsxs("div",{children:[e.jsx("p",{className:`${T} invoice-meta-label`,children:A}),e.jsx("p",{className:`${D} invoice-meta-value`,children:c})]})]})]})})]}),v,j??(a?P:null),u??Q,w??V,y??(d?e.jsxs("div",{className:"rounded-[10px] border border-gray-100 bg-gray-50 p-3 sm:p-4",children:[e.jsx("p",{className:"invoice-notes-label mb-1 text-[8px] font-black uppercase tracking-widest text-gray-300 sm:mb-2 sm:text-[9px] lg:text-[10px]",children:"Terms & Notes"}),e.jsx("p",{className:"invoice-notes-text text-[9px] font-medium italic leading-relaxed text-gray-600 sm:text-[10px] lg:text-xs",children:d})]}):null),N??(o?e.jsx("div",{className:"rounded-[10px] border border-gray-100 bg-gray-50 p-3 sm:p-4",children:e.jsx("p",{className:"invoice-footer-text text-[9px] font-medium leading-relaxed text-gray-500 sm:text-[10px] lg:text-sm",children:o})}):null)]}):I}),e.jsx("style",{children:`
        @media print {
          .invoice-layout-root {
            font-size: 16px;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .invoice-brand-name {
            font-size: 1.45rem !important;
          }
          .invoice-brand-tagline {
            font-size: 0.82rem !important;
          }
          .invoice-company-meta {
            font-size: 0.85rem !important;
          }
          .invoice-page-title {
            font-size: 2rem !important;
          }
          .invoice-meta-label {
            font-size: 0.78rem !important;
          }
          .invoice-meta-value {
            font-size: 0.9rem !important;
          }
          .invoice-customer-title {
            font-size: 0.72rem !important;
          }
          .invoice-customer-name {
            font-size: 0.88rem !important;
          }
          .invoice-customer-sub {
            font-size: 0.72rem !important;
          }
          .invoice-address-label {
            font-size: 0.72rem !important;
          }
          .invoice-address-value {
            font-size: 0.88rem !important;
          }
          .invoice-item-table th {
            font-size: 0.8rem !important;
          }
          .invoice-item-table td {
            font-size: 0.8rem !important;
          }
          .invoice-item-rate,
          .invoice-item-total {
            font-size: 0.8rem !important;
          }
          .invoice-item-name {
            font-size: 0.9rem !important;
          }
          .invoice-item-badge {
            font-size: 0.65rem !important;
          }
          .invoice-item-image {
            width: 2.25rem !important;
            height: 2.25rem !important;
          }
          .invoice-total-label {
            font-size: 0.75rem !important;
          }
          .invoice-total-value {
            font-size: 0.88rem !important;
          }
          .invoice-total-final-label {
            font-size: 0.9rem !important;
          }
          .invoice-total-final-value {
            font-size: 1.08rem !important;
          }
          .invoice-notes-label {
            font-size: 0.74rem !important;
          }
          .invoice-notes-text,
          .invoice-footer-text {
            font-size: 0.88rem !important;
          }
        }
      `})]})};export{ee as I};
