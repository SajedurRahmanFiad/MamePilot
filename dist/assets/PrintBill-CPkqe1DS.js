import{r as g,j as s}from"./vendor-K-96t4is.js";import{c as B,d as L,bp as C,bs as k,aK as A,N as D,aL as y,h as w,w as o,aM as R,o as p,Z as T}from"./index-r5JdyrIr.js";import{t as M}from"./printUtils-DeSoCEzG.js";import"./Input-Rob_WfOI.js";import{I as E}from"./InvoiceLayout-DaVBr14f.js";import"./metaAdsCurrency-CYrNkaLU.js";import{d as Q}from"./router-DvQ5GHgr.js";import"./react-query-Dt6GkCro.js";import"./icons-ZwY3gNqL.js";const P=({bill:e,vendor:n,productImages:d,companySettings:t,invoiceSettings:r,themeColorHex:h,itemDescriptionLabel:c})=>{e!=null&&e.items;const b=((e==null?void 0:e.items)??[]).map((a,u)=>{const f=(typeof(a==null?void 0:a.productImage)=="string"?a.productImage:typeof(a==null?void 0:a.image)=="string"?a.image:"")||d[String(a.productId||"").trim()]||"",l=a.returnedQty??0,i=Math.max(0,a.quantity-l),x=i===0;return{id:a.id??u,name:a.productName,rate:p(a.rate),quantity:i,total:p(a.rate*i),image:f||void 0,muted:x,badge:l>0?s.jsx("div",{className:"mt-0.5",children:s.jsxs("span",{className:"inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700",children:["Returned ×",l]})}):void 0}}),v=[{label:"Subtotal",value:p((e==null?void 0:e.subtotal)??0),tone:"theme"},...e&&e.discount>0?[{label:"Discount",value:`-${p(e.discount)}`,tone:"success"}]:[],...e&&e.shipping>0?[{label:"Shipping",value:p(e.shipping),tone:"muted"}]:[],{label:"Total Payable",value:p((e==null?void 0:e.total)??0),tone:"default"}];return s.jsx(E,{className:"print:min-h-fit",contentClassName:"p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5",themeColorHex:h,itemDescriptionLabel:c,company:{name:(t==null?void 0:t.name)||o.settings.company.name,tagline:(t==null?void 0:t.tagline)||o.settings.company.tagline,phone:(t==null?void 0:t.phone)||o.settings.company.phone,email:(t==null?void 0:t.email)||o.settings.company.email,address:(t==null?void 0:t.address)||o.settings.company.address,logo:(t==null?void 0:t.logo)||o.settings.company.logo},invoiceNumber:`#${e.billNumber}`,invoiceNumberLabel:"Bill No.",invoiceDate:T(e.billDate),invoiceDateLabel:"Date",customer:{name:(n==null?void 0:n.name)||"Vendor",phone:(n==null?void 0:n.phone)||"N/A",address:(n==null?void 0:n.address)||"N/A"},customerTitle:"Billed To",customerAddressLabel:"Address",customerAddress:(n==null?void 0:n.address)||"N/A",items:b,totals:v,notes:e.notes||"",footer:(r==null?void 0:r.footer)||""})},G=()=>{const{id:e}=Q(),{canPrintBills:n}=B(),{settings:d}=L(!!e),t=(d==null?void 0:d.businessMode)==="sofa_cover"?"Fabric Description":"Item Description",{data:r,isPending:h}=C(e||""),{data:c,isPending:b}=k(r?r.vendorId:void 0),v=g.useMemo(()=>Array.from(new Set(((r==null?void 0:r.items)||[]).map(m=>String((m==null?void 0:m.productId)||"").trim()).filter(Boolean))),[r==null?void 0:r.items]),{data:a={}}=A(v),{data:u,isPending:z}=D(),{data:f,isPending:l}=y(),{data:i}=w(),x=g.useRef(!1),N=g.useMemo(()=>{var j;const m=(i==null?void 0:i.themeColor)||((j=o.settings.defaults)==null?void 0:j.themeColor)||"#0f2f57";return R(m).primary},[i==null?void 0:i.themeColor]),I=h||b||z||l;return g.useEffect(()=>{r&&!I&&!x.current&&(x.current=!0,M())},[r,I]),n?I?s.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading details..."}):r?s.jsxs("div",{className:"min-h-screen bg-white print:bg-white",children:[s.jsxs("div",{className:"space-y-4 print:space-y-4",children:[s.jsx(P,{bill:r,vendor:c,productImages:a,companySettings:u,invoiceSettings:f,themeColorHex:N,itemDescriptionLabel:t}),s.jsx("div",{style:{pageBreakBefore:"always"},children:s.jsx(P,{bill:r,vendor:c,productImages:a,companySettings:u,invoiceSettings:f,themeColorHex:N,itemDescriptionLabel:t})})]}),s.jsx("style",{children:`
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
      `})]}):s.jsx("div",{className:"p-8 text-center text-gray-500",children:"Bill not found."}):s.jsx("div",{className:"p-8 text-center text-gray-500",children:"You don't have permission to print bills."})};export{G as default};
