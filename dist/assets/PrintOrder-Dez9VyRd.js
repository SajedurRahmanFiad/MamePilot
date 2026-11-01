import{r as u,j as s,ab as w}from"./vendor-K-96t4is.js";import{c as A,d as C,aq as D,as as P,aK as B,N as L,aL as M,h as R,aY as O,w as l,aM as S,o as f,a_ as T,Z as Q}from"./index-L3-Xxv3i.js";import{t as E}from"./printUtils-DeSoCEzG.js";import"./Input-C_KryNa-.js";import{I as W}from"./InvoiceLayout-BC0A1pNc.js";import"./metaAdsCurrency-Cac92TU5.js";import{d as $}from"./router-DvQ5GHgr.js";import{O as _,V as q,Q as F,J as G,Z as U}from"./icons-ZwY3gNqL.js";import"./react-query-Dt6GkCro.js";const z=({order:a,customer:t,productImages:i,branding:e,invoiceSettings:o,themeColorHex:m,isVaccineCenter:c,itemDescriptionLabel:v})=>{a!=null&&a.items;const g="kg",y=g,p=((a==null?void 0:a.items)??[]).map((n,x)=>{const r=(typeof(n==null?void 0:n.productImage)=="string"?n.productImage:typeof(n==null?void 0:n.image)=="string"?n.image:"")||i[String(n.productId||"").trim()]||"",d=n.returnedQty??0,j=n.exchangedQty??0,I=Math.max(0,n.quantity-d-j),k=I===0;return{id:n.id??x,name:n.productName,rate:f(n.rate),quantity:I,total:f(n.rate*I),image:r||void 0,muted:k,badge:d>0||j>0?s.jsxs("div",{className:"mt-0.5 flex flex-wrap items-center gap-1",children:[d>0&&s.jsxs("span",{className:"inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700",children:["Returned ×",d]}),j>0&&s.jsxs("span",{className:"inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold text-blue-700",children:["Exchanged ×",j]})]}):void 0}}),N=[{label:"Subtotal",value:f((a==null?void 0:a.subtotal)??0),tone:"theme"},...a&&!c&&a.discount>0?[{label:"Discount",value:`-${f(a.discount)}`,tone:"success"}]:[],...a&&!c&&a.shipping>0?[{label:"Shipping",value:f(a.shipping),tone:"muted"}]:[],{label:"Net Total",value:f((a==null?void 0:a.total)??0),tone:"default"}],b=c?s.jsxs("div",{className:"mt-4 grid grid-cols-[minmax(125px,1.2fr)_repeat(5,minmax(58px,1fr))] items-center",children:[s.jsxs("div",{className:"min-w-0 pr-3",children:[s.jsx("h3",{className:"text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm",children:t==null?void 0:t.name}),s.jsx("p",{className:"mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]",children:t==null?void 0:t.phone})]}),[["Age",(t==null?void 0:t.age)??"N/A",_],["Gender",(t==null?void 0:t.gender)||"N/A",q],["Weight",(t==null?void 0:t.weight)!=null?`${t.weight} ${y}`:"N/A",F],["Height",t!=null&&t.height?`${t.height} ${g}`:"N/A",G],["Blood group",(t==null?void 0:t.bloodGroup)||"N/A",U]].map(([n,x,h])=>s.jsxs("div",{className:"flex min-w-0 items-center gap-1.5 border-l border-gray-200 px-2",children:[s.jsx("span",{className:"flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",style:{backgroundColor:T(m,.86),color:m},children:w.createElement(h,{size:14})}),s.jsxs("div",{className:"min-w-0",children:[s.jsx("p",{className:"truncate text-[8px] font-medium text-gray-500 sm:text-[9px]",children:String(n)}),s.jsx("p",{className:"truncate text-[10px] font-black text-slate-900 sm:text-xs",children:String(x)})]})]},String(n)))]}):void 0;return s.jsx(W,{className:"print:min-h-fit",contentClassName:"p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5",themeColorHex:m,itemDescriptionLabel:v,company:{name:(e==null?void 0:e.name)||l.settings.company.name,tagline:(e==null?void 0:e.tagline)||l.settings.company.tagline,phone:(e==null?void 0:e.phone)||l.settings.company.phone,email:(e==null?void 0:e.email)||l.settings.company.email,address:(e==null?void 0:e.address)||l.settings.company.address,logo:(e==null?void 0:e.logo)||l.settings.company.logo},invoiceNumber:a.orderNumber,invoiceNumberLabel:"Order No.",invoiceDate:Q(a.orderDate),invoiceDateLabel:"Date",customer:{name:(t==null?void 0:t.name)||a.customerName||"Walk-in Customer",phone:(t==null?void 0:t.phone)||"N/A",address:(t==null?void 0:t.address)||"N/A"},customerTitle:c?"Patient Details":"Billed To",customerAddressLabel:"Address",customerAddress:(t==null?void 0:t.address)||"N/A",items:p,totals:N,notes:a.notes||"",footer:(o==null?void 0:o.footer)||"",customerDetailBlocks:b})},at=()=>{const{id:a}=$(),{canPrintOrders:t}=A(),{settings:i}=C(!!a),{data:e,isPending:o}=D(a||""),{data:m}=P(e?e.customerId:void 0),c=u.useMemo(()=>Array.from(new Set(((e==null?void 0:e.items)||[]).map(r=>String((r==null?void 0:r.productId)||"").trim()).filter(Boolean))),[e==null?void 0:e.items]),{data:v={}}=B(c),{data:g}=L(),{data:y}=M(),{data:p}=R(),N=(i==null?void 0:i.businessMode)==="vaccine_center",b=(i==null?void 0:i.businessMode)==="sofa_cover"?"Fabric Description":"Item Description",n=u.useRef(!1),x=u.useMemo(()=>O(e,g||l.settings.company),[g,e]),h=u.useMemo(()=>{var d;const r=(p==null?void 0:p.themeColor)||((d=l.settings.defaults)==null?void 0:d.themeColor)||"#0f2f57";return S(r).primary},[p==null?void 0:p.themeColor]);return u.useEffect(()=>{e&&!o&&!n.current&&(n.current=!0,E())},[e,o]),t?o?s.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading details..."}):e?s.jsxs("div",{className:"min-h-screen bg-white print:bg-white",children:[s.jsxs("div",{className:"space-y-4 print:space-y-4",children:[s.jsx(z,{order:e,customer:m,productImages:v,branding:x,invoiceSettings:y,themeColorHex:h,isVaccineCenter:N,itemDescriptionLabel:b}),s.jsx("div",{style:{pageBreakBefore:"always"},children:s.jsx(z,{order:e,customer:m,productImages:v,branding:x,invoiceSettings:y,themeColorHex:h,isVaccineCenter:N,itemDescriptionLabel:b})})]}),s.jsx("style",{children:`
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
          .print:page-break-avoid {
            page-break-inside: avoid;
          }
          .grid {
            page-break-inside: avoid;
          }
        }
      `})]}):s.jsx("div",{className:"p-8 text-center text-gray-500",children:"Order not found."}):s.jsx("div",{className:"p-8 text-center text-gray-500",children:"You don't have permission to print orders."})};export{at as default};
