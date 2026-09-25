import{r as u,j as i,ab as k}from"./vendor-K-96t4is.js";import{c as w,d as A,ap as C,aq as P,aI as B,M as D,aJ as S,h as R,aV as L,v as l,aK as M,o as c,aX as O,Z as T}from"./index-DjY0Dw6l.js";import{t as Q}from"./printUtils-DeSoCEzG.js";import"./Input-DeCLuyKj.js";import{I as E}from"./InvoiceLayout-C114ZwS8.js";import"./metaAdsCurrency-B1yIJZK5.js";import{d as W}from"./router-DvQ5GHgr.js";import{O as $,V as q,Q as G,J,Z as U}from"./icons-Cb-TRTEi.js";import"./react-query-Dt6GkCro.js";const I=({order:a,customer:t,productImages:f,branding:e,invoiceSettings:p,themeColorHex:d,isVaccineCenter:m})=>{a!=null&&a.items;const g="kg",y=g,v=((a==null?void 0:a.items)??[]).map((n,x)=>{const o=(typeof(n==null?void 0:n.productImage)=="string"?n.productImage:typeof(n==null?void 0:n.image)=="string"?n.image:"")||f[String(n.productId||"").trim()]||"",r=n.returnedQty??0,b=n.exchangedQty??0,j=Math.max(0,n.quantity-r-b),z=j===0;return{id:n.id??x,name:n.productName,rate:c(n.rate),quantity:j,total:c(n.rate*j),image:o||void 0,muted:z,badge:r>0||b>0?i.jsxs("div",{className:"mt-0.5 flex flex-wrap items-center gap-1",children:[r>0&&i.jsxs("span",{className:"inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700",children:["Returned ×",r]}),b>0&&i.jsxs("span",{className:"inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold text-blue-700",children:["Exchanged ×",b]})]}):void 0}}),s=[{label:"Subtotal",value:c((a==null?void 0:a.subtotal)??0),tone:"theme"},...a&&!m&&a.discount>0?[{label:"Discount",value:`-${c(a.discount)}`,tone:"success"}]:[],...a&&!m&&a.shipping>0?[{label:"Shipping",value:c(a.shipping),tone:"muted"}]:[],{label:"Net Total",value:c((a==null?void 0:a.total)??0),tone:"default"}],N=m?i.jsxs("div",{className:"mt-4 grid grid-cols-[minmax(125px,1.2fr)_repeat(5,minmax(58px,1fr))] items-center",children:[i.jsxs("div",{className:"min-w-0 pr-3",children:[i.jsx("h3",{className:"text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm",children:t==null?void 0:t.name}),i.jsx("p",{className:"mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]",children:t==null?void 0:t.phone})]}),[["Age",(t==null?void 0:t.age)??"N/A",$],["Gender",(t==null?void 0:t.gender)||"N/A",q],["Weight",(t==null?void 0:t.weight)!=null?`${t.weight} ${y}`:"N/A",G],["Height",t!=null&&t.height?`${t.height} ${g}`:"N/A",J],["Blood group",(t==null?void 0:t.bloodGroup)||"N/A",U]].map(([n,x,h])=>i.jsxs("div",{className:"flex min-w-0 items-center gap-1.5 border-l border-gray-200 px-2",children:[i.jsx("span",{className:"flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full",style:{backgroundColor:O(d,.86),color:d},children:k.createElement(h,{size:14})}),i.jsxs("div",{className:"min-w-0",children:[i.jsx("p",{className:"truncate text-[8px] font-medium text-gray-500 sm:text-[9px]",children:String(n)}),i.jsx("p",{className:"truncate text-[10px] font-black text-slate-900 sm:text-xs",children:String(x)})]})]},String(n)))]}):void 0;return i.jsx(E,{className:"print:min-h-fit",contentClassName:"p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5",themeColorHex:d,company:{name:(e==null?void 0:e.name)||l.settings.company.name,tagline:(e==null?void 0:e.tagline)||l.settings.company.tagline,phone:(e==null?void 0:e.phone)||l.settings.company.phone,email:(e==null?void 0:e.email)||l.settings.company.email,address:(e==null?void 0:e.address)||l.settings.company.address,logo:(e==null?void 0:e.logo)||l.settings.company.logo},invoiceNumber:a.orderNumber,invoiceNumberLabel:"Order No.",invoiceDate:T(a.orderDate),invoiceDateLabel:"Date",customer:{name:(t==null?void 0:t.name)||a.customerName||"Walk-in Customer",phone:(t==null?void 0:t.phone)||"N/A",address:(t==null?void 0:t.address)||"N/A"},customerTitle:m?"Patient Details":"Billed To",customerAddressLabel:"Address",customerAddress:(t==null?void 0:t.address)||"N/A",items:v,totals:s,notes:a.notes||"",footer:(p==null?void 0:p.footer)||"",customerDetailBlocks:N})},et=()=>{const{id:a}=W(),{canPrintOrders:t}=w(),{settings:f}=A(!!a),{data:e,isPending:p}=C(a||""),{data:d}=P(e?e.customerId:void 0),m=u.useMemo(()=>Array.from(new Set(((e==null?void 0:e.items)||[]).map(o=>String((o==null?void 0:o.productId)||"").trim()).filter(Boolean))),[e==null?void 0:e.items]),{data:g={}}=B(m),{data:y}=D(),{data:v}=S(),{data:s}=R(),N=(f==null?void 0:f.businessMode)==="vaccine_center",n=u.useRef(!1),x=u.useMemo(()=>L(e,y||l.settings.company),[y,e]),h=u.useMemo(()=>{var r;const o=(s==null?void 0:s.themeColor)||((r=l.settings.defaults)==null?void 0:r.themeColor)||"#0f2f57";return M(o).primary},[s==null?void 0:s.themeColor]);return u.useEffect(()=>{e&&!p&&!n.current&&(n.current=!0,Q())},[e,p]),t?p?i.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading details..."}):e?i.jsxs("div",{className:"min-h-screen bg-white print:bg-white",children:[i.jsxs("div",{className:"space-y-4 print:space-y-4",children:[i.jsx(I,{order:e,customer:d,productImages:g,branding:x,invoiceSettings:v,themeColorHex:h,isVaccineCenter:N}),i.jsx("div",{style:{pageBreakBefore:"always"},children:i.jsx(I,{order:e,customer:d,productImages:g,branding:x,invoiceSettings:v,themeColorHex:h,isVaccineCenter:N})})]}),i.jsx("style",{children:`
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
      `})]}):i.jsx("div",{className:"p-8 text-center text-gray-500",children:"Order not found."}):i.jsx("div",{className:"p-8 text-center text-gray-500",children:"You don't have permission to print orders."})};export{et as default};
