import{r as f,j as i}from"./vendor-K-96t4is.js";import{c as j,bo as P,br as B,aI as L,M as k,aJ as C,h as y,v as o,aK as A,o as l,Z as R}from"./index-C63m5emV.js";import{t as T}from"./printUtils-DeSoCEzG.js";import"./Input-BxksMVSZ.js";import{I as w}from"./InvoiceLayout-oMt400rm.js";import"./metaAdsCurrency-BccGPDxd.js";import{d as D}from"./router-DvQ5GHgr.js";import"./react-query-Dt6GkCro.js";import"./icons-Cb-TRTEi.js";const N=({bill:t,vendor:n,productImages:r,companySettings:e,invoiceSettings:p,themeColorHex:x})=>{t!=null&&t.items;const g=((t==null?void 0:t.items)??[]).map((a,h)=>{const b=(typeof(a==null?void 0:a.productImage)=="string"?a.productImage:typeof(a==null?void 0:a.image)=="string"?a.image:"")||r[String(a.productId||"").trim()]||"",s=a.returnedQty??0,d=Math.max(0,a.quantity-s),u=d===0;return{id:a.id??h,name:a.productName,rate:l(a.rate),quantity:d,total:l(a.rate*d),image:b||void 0,muted:u,badge:s>0?i.jsx("div",{className:"mt-0.5",children:i.jsxs("span",{className:"inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700",children:["Returned ×",s]})}):void 0}}),c=[{label:"Subtotal",value:l((t==null?void 0:t.subtotal)??0),tone:"theme"},...t&&t.discount>0?[{label:"Discount",value:`-${l(t.discount)}`,tone:"success"}]:[],...t&&t.shipping>0?[{label:"Shipping",value:l(t.shipping),tone:"muted"}]:[],{label:"Total Payable",value:l((t==null?void 0:t.total)??0),tone:"default"}];return i.jsx(w,{className:"print:min-h-fit",contentClassName:"p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5",themeColorHex:x,company:{name:(e==null?void 0:e.name)||o.settings.company.name,tagline:(e==null?void 0:e.tagline)||o.settings.company.tagline,phone:(e==null?void 0:e.phone)||o.settings.company.phone,email:(e==null?void 0:e.email)||o.settings.company.email,address:(e==null?void 0:e.address)||o.settings.company.address,logo:(e==null?void 0:e.logo)||o.settings.company.logo},invoiceNumber:`#${t.billNumber}`,invoiceNumberLabel:"Bill No.",invoiceDate:R(t.billDate),invoiceDateLabel:"Date",customer:{name:(n==null?void 0:n.name)||"Vendor",phone:(n==null?void 0:n.phone)||"N/A",address:(n==null?void 0:n.address)||"N/A"},customerTitle:"Billed To",customerAddressLabel:"Address",customerAddress:(n==null?void 0:n.address)||"N/A",items:g,totals:c,notes:t.notes||"",footer:(p==null?void 0:p.footer)||""})},K=()=>{const{id:t}=D(),{canPrintBills:n}=j(),{data:r,isPending:e}=P(t||""),{data:p,isPending:x}=B(r?r.vendorId:void 0),g=f.useMemo(()=>Array.from(new Set(((r==null?void 0:r.items)||[]).map(m=>String((m==null?void 0:m.productId)||"").trim()).filter(Boolean))),[r==null?void 0:r.items]),{data:c={}}=L(g),{data:a,isPending:h}=k(),{data:v,isPending:b}=C(),{data:s}=y(),d=f.useRef(!1),u=f.useMemo(()=>{var z;const m=(s==null?void 0:s.themeColor)||((z=o.settings.defaults)==null?void 0:z.themeColor)||"#0f2f57";return A(m).primary},[s==null?void 0:s.themeColor]),I=e||x||h||b;return f.useEffect(()=>{r&&!I&&!d.current&&(d.current=!0,T())},[r,I]),n?I?i.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading details..."}):r?i.jsxs("div",{className:"min-h-screen bg-white print:bg-white",children:[i.jsxs("div",{className:"space-y-4 print:space-y-4",children:[i.jsx(N,{bill:r,vendor:p,productImages:c,companySettings:a,invoiceSettings:v,themeColorHex:u}),i.jsx("div",{style:{pageBreakBefore:"always"},children:i.jsx(N,{bill:r,vendor:p,productImages:c,companySettings:a,invoiceSettings:v,themeColorHex:u})})]}),i.jsx("style",{children:`
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: white;
          }
          .no-print {
            display: none !important;
          }
          .print-invoice-root {
            font-size: 16px !important;
          }
          .print-brand-name {
            font-size: 24px !important;
          }
          .print-tagline {
            font-size: 13px !important;
          }
          .print-company-meta {
            font-size: 12px !important;
          }
          .print-invoice-title {
            font-size: 28px !important;
          }
          .print-meta-label {
            font-size: 11px !important;
          }
          .print-meta-value {
            font-size: 13px !important;
          }
          .print-section-heading {
            font-size: 16px !important;
          }
          .print-customer-name {
            font-size: 16px !important;
          }
          .print-customer-sub,
          .print-address-label,
          .print-address-value,
          .print-table-label,
          .print-table-note,
          .print-table-value,
          .print-total-label,
          .print-total-value,
          .print-item-name,
          .print-item-pill,
          .print-notes-label,
          .print-notes-text,
          .print-footer-text,
          .print-table-head,
          .print-table-cell {
            font-size: inherit !important;
          }
          .print-address-value,
          .print-table-value,
          .print-item-name,
          .print-total-value {
            font-size: 13px !important;
          }
          .print-table-head {
            font-size: 12px !important;
          }
          .print-table-cell,
          .print-item-pill,
          .print-table-note {
            font-size: 11.5px !important;
          }
          .print-item-name {
            font-size: 14px !important;
          }
          .print-total-label {
            font-size: 11.5px !important;
          }
          .print-notes-label {
            font-size: 10.5px !important;
          }
          .print-notes-text,
          .print-footer-text {
            font-size: 12px !important;
          }
          table {
            page-break-inside: avoid;
          }
          tr {
            page-break-inside: avoid;
          }
          @page {
            margin: 0.25in;
            size: A4;
          }
          .print\\:page-break-avoid {
            page-break-inside: avoid;
          }
          .grid {
            page-break-inside: avoid;
          }
        }
      `})]}):i.jsx("div",{className:"p-8 text-center text-gray-500",children:"Bill not found."}):i.jsx("div",{className:"p-8 text-center text-gray-500",children:"You don't have permission to print bills."})};export{K as default};
