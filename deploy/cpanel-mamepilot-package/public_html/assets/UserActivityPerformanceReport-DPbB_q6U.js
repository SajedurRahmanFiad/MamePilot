import{r as v,a9 as X,j as e}from"./vendor-BM5V8tGY.js";import{u as me,j as pe,e as xe,z as ue,q as ge,c as ee,o as Z,T as M,dx as he,ao as te,i as p,J as be,I as fe,dy as ye,L as ve,N as je}from"./index-BSl-5h-5.js";import"./metaAdsCurrency-Bg4TGT49.js";import{F as Ne}from"./FilterBar-CCZjsXq2.js";import{D as we}from"./DynamicFilterBar-DMmWrViX.js";import{P as ke}from"./Pagination-Ca4bO3Bd.js";import{a as $e}from"./router-vjjGo9a1.js";import"./react-query-ClXANhId.js";import"./icons-CDylydRY.js";const Ae=["All Time","Today","This Week","This Month","This Year","Custom"],F="/uploads/Empty_avatar.png",T=a=>ee(a)||"N/A",r=a=>new Intl.NumberFormat("en-BD").format(a),Ce=a=>a==="Income"?"bg-emerald-100 text-emerald-700":a==="Expense"?"bg-rose-100 text-rose-700":a==="Transfer"?"bg-sky-100 text-sky-700":je(a),E=a=>a.includes("T")||/\d{2}:\d{2}/.test(a)?T(a):ve(a),Pe=(a,t)=>a!=="Custom"?a:t.from&&t.to?`${E(t.from)} to ${E(t.to)}`:t.from?`From ${E(t.from)}`:t.to?`Until ${E(t.to)}`:"Custom Range",i=a=>a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),Se=a=>a.replace(/[<>:"/\\|?*]+/g,"-").replace(/\s+/g," ").trim(),W=a=>{if(!a)return"";if(/^(https?:|data:|blob:)/i.test(a)||typeof window>"u")return a;try{return new URL(a,window.location.href).href}catch{return a}},Ue=()=>{const a={primary:"#0f2f57",medium:"#3c5a82",dark:"#0c203b",soft:"#ebf4ff"};if(typeof window>"u")return a;const t=window.getComputedStyle(document.documentElement),d=(u,y)=>{const A=t.getPropertyValue(u).trim();return/^#[0-9a-f]{6}$/i.test(A)?A:y};return{primary:d("--primary-color",a.primary),medium:d("--primary-medium",a.medium),dark:d("--primary-dark",a.dark),soft:d("--primary-soft",a.soft)}},Re=a=>{const{report:t,companyName:d,companyLogo:u,generatedAt:y,selectedPeriod:A,themeColors:c}=a,m=M(t.user.role)?"role-admin":"role-employee",j=W(t.user.image||F),C=W(F),O=W(u),N=`<img src="${i(j)}" alt="${i(t.user.name)}" class="avatar-image" onerror="this.onerror=null;this.src='${i(C)}';" />`,V=[{label:"Orders Created",value:r(t.metrics.ordersCreated),hint:`${r(t.metrics.completedOrders)} completed | ${r(t.metrics.cancelledOrders)} cancelled`,tone:"card-blue"},{label:"Order Value",value:p(t.metrics.orderValue),hint:`${p(t.metrics.orderPaidAmount)} collected`,tone:"card-green"},{label:"Bills Created",value:r(t.metrics.billsCreated),hint:`${p(t.metrics.billValue)} purchase value`,tone:"card-amber"},{label:"Transactions Posted",value:r(t.metrics.transactionsCreated),hint:`${r(t.metrics.activeDays)} active days`,tone:"card-rose"}],_=[["Active days",r(t.metrics.activeDays)],["Unique customers served",r(t.metrics.uniqueCustomers)],["Items handled in orders",r(t.metrics.orderQuantity)],["Average order value",p(t.metrics.averageOrderValue)],["Completion rate",`${Math.round(t.metrics.completionRate)}%`],["Collection rate",`${Math.round(t.metrics.collectionRate)}%`]],B=[["Completed order value",p(t.metrics.completedOrderValue)],["Purchase settlement rate",`${Math.round(t.metrics.billSettlementRate)}%`],["Income entries",`${r(t.metrics.incomeTransactions)} | ${p(t.metrics.incomeAmount)}`],["Expense entries",`${r(t.metrics.expenseTransactions)} | ${p(t.metrics.expenseAmount)}`],["Transfer entries",`${r(t.metrics.transferTransactions)} | ${p(t.metrics.transferAmount)}`],["Last activity",t.metrics.lastActivity?T(t.metrics.lastActivity):"No activity"]],h=[["On Hold",t.metrics.onHoldOrders],["Processing",t.metrics.processingOrders],["Picked",t.metrics.pickedOrders],["Completed",t.metrics.completedOrders],["Cancelled",t.metrics.cancelledOrders]],D=[["Unique vendors handled",r(t.metrics.uniqueVendors)],["Bills paid amount",p(t.metrics.billPaidAmount)],["First tracked activity",t.metrics.firstActivity?T(t.metrics.firstActivity):"No activity"],["Tracked activities",r(t.metrics.totalActivities)]],g=w=>w.map(([U,S])=>`
          <tr>
            <td>${i(U)}</td>
            <td>${i(String(S))}</td>
          </tr>
        `).join(""),I=h.map(([w,U])=>{const S=Number(U),z=t.metrics.ordersCreated>0?`${Math.round(S/t.metrics.ordersCreated*100)}%`:"0%";return`
        <tr>
          <td>${i(w)}</td>
          <td>${i(r(S))}</td>
          <td>${i(z)}</td>
        </tr>
      `}).join(""),b=V.map(w=>`
        <div class="summary-card ${w.tone}">
          <p class="summary-label">${i(w.label)}</p>
          <h3 class="summary-value">${i(w.value)}</h3>
          <p class="summary-hint">${i(w.hint)}</p>
        </div>
      `).join(""),q=O?`<img src="${i(O)}" alt="${i(d)}" class="company-logo" />`:`<div class="company-logo company-logo-fallback">${i(d.slice(0,1).toUpperCase())}</div>`;return`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${i(Se(`${t.user.name} Activity Performance Report`))}</title>
    <style>
      @page { size: A4; margin: 9mm; }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        margin: 0;
        background: #ffffff;
        color: #111827;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 10.5px;
        line-height: 1.35;
      }
      .page {
        width: 100%;
        margin: 0 auto;
        background: #ffffff;
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .user-card {
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 10px 12px;
        border-radius: 8px;
        background-color: #f8fafc;
        border: 1px solid #dbe3ec;
      }
      .avatar-image {
        width: 52px;
        height: 52px;
        border-radius: 8px;
        flex: 0 0 52px;
      }
      .avatar-image {
        object-fit: cover;
        border: 1px solid #d8e0e8;
      }
      .user-meta h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
      }
      .meta-line {
        margin-top: 5px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 10.5px;
        color: #526173;
      }
      .role-badge {
        display: inline-block;
        padding: 4px 7px;
        border-radius: 4px;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .role-admin {
        background: #efe8f8;
        color: #6a4f8d;
      }
      .role-employee {
        background: ${i(c.soft)};
        color: ${i(c.primary)};
      }
      .report-meta {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
        background-color: ${i(c.primary)};
        color: #ffffff;
      }
      .report-meta-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .report-meta-copy {
        min-width: 0;
      }
      .report-kicker {
        margin: 0;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .report-title {
        margin: 0 0 2px;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .report-subtitle {
        margin: 0;
        font-size: 10.5px;
        line-height: 1.35;
      }
      .company-lockup {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .company-logo {
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        border-radius: 8px;
        object-fit: cover;
        background-color: rgba(255, 255, 255, 0.14);
      }
      .company-logo-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-weight: 700;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        font-size: 10.5px;
      }
      .meta-item {
        padding: 7px 9px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background-color: rgba(255, 255, 255, 0.08);
      }
      .meta-item span {
        display: block;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .section {
        margin-top: 10px;
      }
      .section-panel {
        border: 1px solid #d9e0e7;
        border-radius: 8px;
        background-color: #ffffff;
        padding: 12px;
      }
      .section-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .section-subtitle {
        margin: 3px 0 0;
        font-size: 10.5px;
        color: #677487;
        line-height: 1.5;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
      }
      .summary-card {
        border-radius: 8px;
        padding: 9px 10px;
        border: 1px solid;
      }
      .summary-label {
        margin: 0;
        font-size: 7.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #5c6978;
      }
      .summary-value {
        margin: 5px 0 3px;
        font-size: 16px;
        font-weight: 700;
        line-height: 1.2;
      }
      .summary-hint {
        margin: 0;
        font-size: 9.5px;
        color: #5d6875;
        line-height: 1.45;
      }
      .card-blue {
        background-color: ${i(c.soft)};
        border-color: ${i(c.medium)};
        color: ${i(c.dark)};
      }
      .card-green {
        background-color: #f7fbf7;
        border-color: #d6e7d8;
        color: #315544;
      }
      .card-amber {
        background-color: #fffaf3;
        border-color: #eadcc2;
        color: #735833;
      }
      .card-rose {
        background-color: #fff7f8;
        border-color: #ecd8dd;
        color: #7f4955;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .sub-panel {
        border: 1px solid #dde4ea;
        border-radius: 8px;
        padding: 12px;
        background-color: #fcfdff;
      }
      .sub-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }
      .sub-copy {
        margin: 3px 0 0;
        font-size: 10.5px;
        color: #677487;
        line-height: 1.5;
      }
      table.info-table,
      table.status-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      table.info-table td,
      table.status-table td,
      table.status-table th {
        padding: 6px 0;
        border-bottom: 1px solid #e3e8ee;
        vertical-align: top;
      }
      table.info-table tr:last-child td,
      table.status-table tr:last-child td {
        border-bottom: none;
      }
      table.info-table td:first-child {
        font-size: 10.5px;
        color: #5d6b7a;
        padding-right: 12px;
      }
      table.info-table td:last-child {
        text-align: right;
        font-size: 10.5px;
        font-weight: 600;
        color: #203040;
      }
      table.status-table th {
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #7a8695;
        text-align: left;
      }
      table.status-table th:nth-child(2),
      table.status-table th:nth-child(3),
      table.status-table td:nth-child(2),
      table.status-table td:nth-child(3) {
        text-align: right;
      }
      table.status-table td {
        font-size: 10.5px;
        color: #2a3747;
      }
      .footer {
        margin-top: 10px;
        padding-top: 7px;
        border-top: 1px solid #e5e7eb;
        font-size: 9px;
        color: #808b98;
        text-align: center;
      }
      .report-meta,
      .user-card,
      .summary-card,
      .sub-panel {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      @media (max-width: 600px) {
        .report-meta-top {
          flex-direction: column;
        }
        .report-meta-copy {
          max-width: 100%;
        }
        .meta-grid,
        .detail-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media print {
        body { background: #ffffff; }
        .page { margin: 0; }
        .report-meta,
        .user-card,
        .summary-card,
        .sub-panel,
        .meta-item {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="header">
        <div class="report-meta">
          <div class="report-meta-top">
            <div class="company-lockup">
              ${q}
              <div class="report-meta-copy">
                <h2 class="report-title">${i(d)}</h2>
                <p class="report-subtitle">User activity and performance report</p>
              </div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-item"><span>Period</span>${i(A)}</div>
            <div class="meta-item"><span>Generated</span>${i(y)}</div>
          </div>
        </div>
        <div class="user-card">
          ${N}
          <div class="user-meta">
            <p class="report-kicker" style="color:#6f7d8d;">User Activity & Performance</p>
            <h1>${i(t.user.name)}</h1>
            <div class="meta-line">
              <span>${i(t.user.phone||"No phone")}</span>
              <span class="role-badge ${m}">${i(t.user.role)}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section section-panel">
        <h3 class="section-title">Performance Snapshot</h3>
        <p class="section-subtitle">Summary for the selected reporting period.</p>
        <div class="summary-grid">
          ${b}
        </div>
      </section>

      <section class="section detail-grid">
        <div class="sub-panel">
          <h4 class="sub-title">Performance Indicators</h4>
          <p class="sub-copy">Key activity and value measures for performance, salary, commission, and incentive review.</p>
          <table class="info-table">
            ${g(_)}
          </table>
          <table class="info-table">
            ${g(B)}
          </table>
        </div>

        <div class="sub-panel">
          <h4 class="sub-title">Order Status Breakdown</h4>
          <p class="sub-copy">Status distribution for all orders created by this user in the selected period.</p>
          <table class="status-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Orders</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              ${I}
            </tbody>
          </table>
          <table class="info-table">
            ${g(D)}
          </table>
        </div>
      </section>

      <div class="footer">
        Generated by ${i(d)} | User Activity & Performance
      </div>
    </div>
    <script>
      const ready = () => {
        const images = Array.from(document.images || []);
        Promise.all(
          images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          }))
        ).then(() => {
          window.focus();
          setTimeout(() => window.print(), 250);
        });
      };
      window.addEventListener('load', ready);
      window.addEventListener('afterprint', () => window.close());
    <\/script>
  </body>
</html>`},P=({label:a,value:t,hint:d,tone:u})=>e.jsxs("div",{className:`rounded-xl border p-4 ${u}`,children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] opacity-70",children:a}),e.jsx("h4",{className:"mt-3 text-lg font-black",children:t}),e.jsx("p",{className:"mt-2 text-xs font-semibold opacity-80",children:d})]}),f=({label:a,value:t,accent:d})=>e.jsxs("div",{className:"flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0",children:[e.jsx("span",{className:"text-sm font-medium text-gray-500",children:a}),e.jsx("span",{className:`text-sm font-black ${d?"text-[#0f2f57]":"text-gray-900"}`,children:t})]}),o=({className:a})=>e.jsx("div",{className:`animate-pulse rounded-lg bg-gray-200/80 ${a}`}),Te=()=>e.jsx("div",{className:"space-y-3 px-6 py-6",children:Array.from({length:5}).map((a,t)=>e.jsxs("div",{className:"grid grid-cols-[1.1fr_0.8fr_1fr_1.3fr] gap-3",children:[e.jsx(o,{className:"h-12"}),e.jsx(o,{className:"h-12"}),e.jsx(o,{className:"h-12"}),e.jsx(o,{className:"h-12"})]},t))}),Oe=()=>e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{className:"overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:`${te.colors.primary[600]} px-6 py-6`,children:e.jsxs("div",{className:"flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(o,{className:"h-14 w-14 bg-white/20"}),e.jsxs("div",{className:"space-y-3",children:[e.jsx(o,{className:"h-3 w-28 bg-white/20"}),e.jsx(o,{className:"h-8 w-56 bg-white/20"}),e.jsx(o,{className:"h-4 w-64 bg-white/20"})]})]}),e.jsxs("div",{className:"space-y-2 rounded-lg border border-white/15 bg-white/10 px-5 py-4",children:[e.jsx(o,{className:"h-4 w-48 bg-white/20"}),e.jsx(o,{className:"h-4 w-40 bg-white/20"})]})]})}),e.jsx("div",{className:"grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-5",children:Array.from({length:5}).map((a,t)=>e.jsxs("div",{className:"rounded-xl border border-gray-100 p-4",children:[e.jsx(o,{className:"h-3 w-24"}),e.jsx(o,{className:"mt-4 h-7 w-28"}),e.jsx(o,{className:"mt-3 h-4 w-36"})]},t))})]}),Array.from({length:3}).map((a,t)=>e.jsxs("section",{className:"overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:"border-b border-gray-100 bg-gradient-to-r from-white via-[#f8fbff] to-white px-6 py-6",children:e.jsxs("div",{className:"flex flex-col gap-4 md:flex-row md:items-center md:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(o,{className:"h-16 w-16 rounded-lg"}),e.jsxs("div",{className:"space-y-3",children:[e.jsx(o,{className:"h-6 w-40"}),e.jsx(o,{className:"h-4 w-32"})]})]}),e.jsx(o,{className:"h-10 w-32"})]})}),e.jsxs("div",{className:"space-y-6 px-6 py-6",children:[e.jsx("div",{className:"grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4",children:Array.from({length:4}).map((d,u)=>e.jsxs("div",{className:"rounded-xl border border-gray-100 p-4",children:[e.jsx(o,{className:"h-3 w-24"}),e.jsx(o,{className:"mt-4 h-7 w-28"}),e.jsx(o,{className:"mt-3 h-4 w-32"})]},u))}),e.jsxs("div",{className:"grid gap-6 xl:grid-cols-[1.15fr_0.85fr]",children:[e.jsx("div",{className:"rounded-xl border border-gray-100 p-6",children:Array.from({length:6}).map((d,u)=>e.jsxs("div",{className:"flex items-center justify-between border-b border-gray-100 py-3 last:border-b-0",children:[e.jsx(o,{className:"h-4 w-32"}),e.jsx(o,{className:"h-4 w-24"})]},u))}),e.jsx("div",{className:"rounded-xl border border-gray-100 p-6",children:Array.from({length:5}).map((d,u)=>e.jsxs("div",{className:"space-y-2 py-2",children:[e.jsxs("div",{className:"flex items-center justify-between",children:[e.jsx(o,{className:"h-4 w-24"}),e.jsx(o,{className:"h-4 w-10"})]}),e.jsx(o,{className:"h-3 w-full rounded-full"})]},u))})]})]})]},t))]}),ze=({userId:a,isExpanded:t,filterRange:d,customDates:u})=>{const{data:y=[],isPending:A,error:c}=ye(a,{filterRange:d,customDates:u},{enabled:t});return t?A?e.jsx(Te,{}):c?e.jsx("div",{className:"px-6 py-6 text-sm font-medium text-rose-500",children:"Failed to load the activity log for this user."}):e.jsx("div",{className:"print-overflow-reset overflow-x-auto",children:e.jsxs("table",{className:"activity-table min-w-full text-left",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-gray-50",children:[e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Date"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Type"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Reference"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Counterparty"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Details"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Qty"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Amount"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Status"})]})}),e.jsx("tbody",{className:"divide-y divide-gray-50",children:y.length===0?e.jsx("tr",{children:e.jsx("td",{colSpan:8,className:"px-6 py-16 text-center text-sm font-medium italic text-gray-400",children:"No activity tracked for this user in the selected period."})}):y.map(m=>e.jsxs("tr",{className:"hover:bg-gray-50/70",children:[e.jsx("td",{className:"px-6 py-4 text-sm font-semibold text-gray-600",children:T(m.rawDate)}),e.jsx("td",{className:"px-6 py-4",children:e.jsx("span",{className:"rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600",children:m.type})}),e.jsx("td",{className:"px-6 py-4 text-sm font-black text-gray-900",children:m.reference}),e.jsx("td",{className:"px-6 py-4 text-sm font-semibold text-gray-700",children:m.counterparty}),e.jsx("td",{className:"px-6 py-4 text-sm text-gray-500",children:m.details}),e.jsx("td",{className:"px-6 py-4 text-right text-sm font-black text-gray-900",children:m.quantity===null?"-":r(m.quantity)}),e.jsx("td",{className:"px-6 py-4 text-right text-sm font-black text-gray-900",children:m.amount===null?"-":p(m.amount)}),e.jsx("td",{className:"px-6 py-4 text-right",children:e.jsx("span",{className:`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${Ce(m.status)}`,children:m.status})})]},m.id))})]})}):e.jsx("div",{className:"px-6 py-6 text-sm font-medium text-gray-400",children:"Expand this section to review the full activity-by-activity log for this user."})},He=()=>{const a=$e(),{user:t}=me(),d=pe(),{hasCapability:u}=xe(),{data:y}=ue(),{data:A=[]}=ge(),c=u("sales"),m=u("purchases"),j=u("banking"),[C,O]=v.useState("All Time"),[N,V]=v.useState({from:"",to:""}),[_,B]=v.useState(!1),[h,D]=v.useState(null),[g,I]=v.useState(null),[b,q]=v.useState(null),[w,U]=v.useState([]),[S,z]=v.useState(1),K=10,H=v.useMemo(()=>ee(new Date),[]),L=(y==null?void 0:y.name)||Z.settings.company.name||"Mame Pilot",G=(y==null?void 0:y.logo)||Z.settings.company.logo||"",Q=v.useMemo(()=>Pe(C,N),[C,N]),se=v.useMemo(()=>[{type:"User",label:"User name, phone, or role",operators:["=","≠","contains","does not contain"],allowCustomValue:!0,customValuePlaceholder:"Search users",renderOptions:s=>{const n=s.trim().toLowerCase();return A.filter(l=>{const $=`${l.name} ${l.phone||""} ${l.role||""}`.toLowerCase();return!n||$.includes(n)}).map(l=>({value:String(l.phone||l.name).trim(),label:[l.name,l.phone,l.role].filter(Boolean).join(" · ")}))}},{type:"Role",operators:["=","≠"],values:[{value:"Admins",label:"Admins"},{value:"Employees",label:"Employees"}]},{type:"Activity",operators:["=","≠"],values:[{value:"active",label:"Has activity"},{value:"inactive",label:"No activity"}]}],[A]),ae=v.useMemo(()=>{const s=[];return h&&s.push({id:"user-search",type:"User",operator:h.operator,value:h.value,display:h.display}),g&&s.push({id:"role",type:"Role",operator:g.operator,value:g.value}),b&&s.push({id:"activity",type:"Activity",operator:b.operator,value:b.value,display:b.value==="active"?"Has activity":"No activity"}),s},[b,g,h]),re=s=>{const n=s.find(x=>x.type==="User"),l=s.find(x=>x.type==="Role"),$=s.find(x=>x.type==="Activity");D(n?{operator:n.operator,value:n.value.trim(),display:n.display}:null),I(l&&(l.value==="Admins"||l.value==="Employees")?{operator:l.operator,value:l.value,display:l.display}:null),q($&&($.value==="active"||$.value==="inactive")?{operator:$.operator,value:$.value,display:$.display}:null)},ie=v.useMemo(()=>({search:(h==null?void 0:h.value)||"",searchOperator:(h==null?void 0:h.operator)||"contains",roleFilter:(g==null?void 0:g.value)||"All Users",roleOperator:(g==null?void 0:g.operator)||"=",filterRange:C,customDates:N,activityFilter:(b==null?void 0:b.value)||"all",activityOperator:(b==null?void 0:b.operator)||"="}),[b,N,C,g,h]),le=!!t&&M(t.role),{data:k,isPending:oe,isFetching:Le}=he(S,K,ie,{enabled:le}),Y=(k==null?void 0:k.data)??[],R=(k==null?void 0:k.totals)??{users:0,activeUsers:0,orders:0,bills:0,transactions:0,orderValue:0},ce=(k==null?void 0:k.count)??0,J=Math.max(1,Math.ceil(ce/K));X.useEffect(()=>{z(1),U([])},[h,g,b,C,N.from,N.to]),X.useEffect(()=>{U([])},[S]);const ne=s=>{U(n=>n.includes(s)?n.filter(l=>l!==s):[...n,s])},de=s=>{const n=window.open("","_blank","width=1100,height=820");if(!n){d.error("Please allow pop-ups to export the user PDF.");return}try{const l=Re({report:s,companyName:L,companyLogo:G,generatedAt:H,selectedPeriod:Q,themeColors:Ue()});n.document.open(),n.document.write(l),n.document.close(),n.focus()}catch(l){n.close(),d.error(l instanceof Error?l.message:"Could not prepare the report. Please try again.")}};return t?M(t.role)?oe&&!k?e.jsx(Oe,{}):e.jsxs("div",{className:"space-y-6",children:[e.jsx("div",{className:"no-print flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("button",{onClick:()=>a("/reports"),className:"p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500",children:e.jsx("svg",{className:"w-5 h-5",fill:"none",stroke:"currentColor",viewBox:"0 0 24 24",children:e.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M10 19l-7-7m0 0l7-7m-7 7h18"})})}),e.jsxs("div",{children:[e.jsx("h2",{className:"text-2xl font-bold text-gray-900",children:"User Activity & Performance"}),e.jsx("p",{className:"mt-1 text-sm text-gray-500",children:"Compare activity, output, and financial contribution by user."})]})]})}),e.jsxs("div",{className:"report-cover overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:`${te.colors.primary[600]} px-5 py-5 text-white sm:px-6`,children:e.jsxs("div",{className:"flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[G?e.jsx("img",{src:G,alt:L,className:"h-12 w-12 rounded-lg bg-white/10 object-cover p-1"}):e.jsx("div",{className:"flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-xl font-black",children:L.slice(0,1).toUpperCase()}),e.jsxs("div",{children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.3em] text-white/70",children:"Admin Report"}),e.jsx("h3",{className:"mt-1 text-xl font-black",children:L}),e.jsx("p",{className:"mt-1 text-sm text-white/80",children:"Orders, bills, and finance activity attributed to each user."})]})]}),e.jsxs("div",{className:"rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium",children:[e.jsxs("p",{children:[e.jsx("span",{className:"text-white/70",children:"Period:"})," ",Q]}),e.jsxs("p",{className:"mt-1",children:[e.jsx("span",{className:"text-white/70",children:"Generated:"})," ",H]})]})]})}),e.jsx("div",{className:"no-print border-b border-gray-100 bg-gray-50/60 px-5 py-5 sm:px-6",children:e.jsxs("div",{className:"space-y-5",children:[e.jsxs("div",{children:[e.jsx("div",{className:"mb-2 flex items-center justify-between gap-3",children:e.jsxs("div",{children:[e.jsx("p",{className:"text-sm font-black text-gray-900",children:"Date and time"}),e.jsx("p",{className:"text-xs text-gray-500",children:"Choose the activity period included in every total below."})]})}),e.jsx("div",{className:"[&_.rounded-2xl]:!rounded-xl",children:e.jsx(Ne,{filterRange:C,setFilterRange:O,customDates:N,setCustomDates:V,includeTime:_,setIncludeTime:B,ranges:Ae,compact:!0,showOnMobile:!0})})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"mb-2",children:[e.jsx("p",{className:"text-sm font-black text-gray-900",children:"User filters"}),e.jsx("p",{className:"text-xs text-gray-500",children:"Filter by a user detail, role group, or whether activity exists."})]}),e.jsx(we,{filterDefinitions:se,initialFilters:ae,onApply:re,className:"[&>div>div]:!rounded-xl"})]})]})}),e.jsxs("div",{className:"border-b border-gray-100 px-5 pt-5 sm:px-6",children:[e.jsx("h3",{className:"text-base font-black text-gray-900",children:"Report overview"}),e.jsx("p",{className:"mt-1 text-sm text-gray-500",children:"A quick reading of the users and activity included by the filters."})]}),e.jsxs("div",{className:`grid grid-cols-1 gap-3 px-5 py-5 sm:px-6 md:grid-cols-2 ${c&&j?"xl:grid-cols-5":c||j?"xl:grid-cols-4":"xl:grid-cols-2"}`,children:[e.jsx(P,{label:"Users Included",value:r(R.users),hint:`${r(R.activeUsers)} active users`,tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"}),c&&e.jsx(P,{label:"Orders Captured",value:r(R.orders),hint:"User-created orders in this view",tone:"bg-emerald-50 border-emerald-100 text-emerald-700"}),m&&e.jsx(P,{label:"Bills Captured",value:r(R.bills),hint:"User-created bills in this view",tone:"bg-amber-50 border-amber-100 text-amber-700"}),j&&e.jsx(P,{label:"Finance Entries",value:r(R.transactions),hint:"Transactions posted by users",tone:"bg-rose-50 border-rose-100 text-rose-700"}),c&&e.jsx(P,{label:"Gross Order Value",value:p(R.orderValue),hint:"All tracked order totals",tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"})]})]}),Y.length===0?e.jsx("div",{className:"rounded-xl border border-dashed border-gray-200 bg-white p-16 text-center text-gray-500",children:"No users matched the current filters."}):e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"space-y-6",children:Y.map(s=>{const n=w.includes(s.user.id),l=[{label:"On Hold",value:s.metrics.onHoldOrders,color:"bg-amber-500",track:"bg-amber-100"},{label:"Processing",value:s.metrics.processingOrders,color:"bg-sky-500",track:"bg-sky-100"},{label:"Picked",value:s.metrics.pickedOrders,color:"bg-cyan-500",track:"bg-cyan-100"},{label:"Completed",value:s.metrics.completedOrders,color:"bg-emerald-500",track:"bg-emerald-100"},{label:"Cancelled",value:s.metrics.cancelledOrders,color:"bg-rose-500",track:"bg-rose-100"}],$=Math.max(1,...l.map(x=>x.value));return e.jsxs("section",{className:"user-report-card overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm","data-user-id":s.user.id,children:[e.jsxs("div",{className:"border-b border-gray-100 bg-[#f8fbff] px-5 py-5 sm:px-6",children:[e.jsxs("div",{className:"flex flex-col gap-4 md:flex-row md:items-center md:justify-between",children:[e.jsxs("div",{className:"flex min-w-0 items-center gap-4",children:[e.jsx("img",{src:s.user.image||F,alt:s.user.name,onError:x=>{x.currentTarget.onerror=null,x.currentTarget.src=F},className:"h-16 w-16 rounded-lg object-cover ring-1 ring-[#dce6f2]"}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-[#3c5a82]",children:"User performance"}),e.jsx("h3",{className:"mt-1 truncate text-xl font-black text-gray-900",children:s.user.name}),e.jsxs("div",{className:"mt-2 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-500",children:[e.jsx("span",{children:s.user.phone||"No phone"}),e.jsx("span",{className:`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${M(s.user.role)?"bg-purple-100 text-purple-700":"bg-blue-100 text-blue-700"}`,children:s.user.role})]})]})]}),e.jsx("div",{className:"no-print md:ml-auto",children:e.jsx(be,{onClick:()=>de(s),variant:"primary",size:"md",icon:fe.Download,children:"Export PDF"})})]}),e.jsxs("div",{className:"mt-4 grid gap-3 text-sm font-medium text-gray-600 sm:grid-cols-2",children:[e.jsxs("div",{className:"rounded-lg border border-[#d6e3f0] bg-white px-4 py-3",children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Period"}),e.jsx("p",{className:"mt-1 text-sm font-bold text-gray-900",children:Q})]}),e.jsxs("div",{className:"rounded-lg border border-[#d6e3f0] bg-white px-4 py-3",children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Generated"}),e.jsx("p",{className:"mt-1 text-sm font-bold text-gray-900",children:H})]})]})]}),e.jsxs("div",{className:"space-y-6 px-5 py-5 sm:px-6",children:[e.jsxs("div",{className:`grid grid-cols-1 gap-4 md:grid-cols-2 ${c&&m&&j?"xl:grid-cols-4":"xl:grid-cols-3"}`,children:[c&&e.jsx(P,{label:"Orders Created",value:r(s.metrics.ordersCreated),hint:`${r(s.metrics.completedOrders)} completed | ${r(s.metrics.cancelledOrders)} cancelled`,tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"}),c&&e.jsx(P,{label:"Order Value",value:p(s.metrics.orderValue),hint:`${p(s.metrics.orderPaidAmount)} collected`,tone:"bg-emerald-50 border-emerald-100 text-emerald-700"}),m&&e.jsx(P,{label:"Bills Created",value:r(s.metrics.billsCreated),hint:`${p(s.metrics.billValue)} purchase value`,tone:"bg-amber-50 border-amber-100 text-amber-700"}),j&&e.jsx(P,{label:"Transactions Posted",value:r(s.metrics.transactionsCreated),hint:`${r(s.metrics.activeDays)} active days`,tone:"bg-rose-50 border-rose-100 text-rose-700"})]}),e.jsxs("div",{className:`grid gap-6 ${c?"xl:grid-cols-[1.15fr_0.85fr]":""}`,children:[e.jsxs("div",{className:"rounded-xl border border-gray-100 bg-white p-5",children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Performance indicators"}),e.jsx("p",{className:"text-sm text-gray-500",children:"Key activity and value measures for performance, salary, and incentive review."}),e.jsxs("div",{className:"mt-4 grid gap-1 md:grid-cols-2 md:gap-x-8",children:[e.jsxs("div",{children:[e.jsx(f,{label:"Active days",value:r(s.metrics.activeDays),accent:!0}),c&&e.jsx(f,{label:"Unique customers served",value:r(s.metrics.uniqueCustomers)}),c&&e.jsx(f,{label:"Items handled in orders",value:r(s.metrics.orderQuantity)}),c&&e.jsx(f,{label:"Average order value",value:p(s.metrics.averageOrderValue)}),c&&e.jsx(f,{label:"Completion rate",value:`${Math.round(s.metrics.completionRate)}%`}),c&&e.jsx(f,{label:"Collection rate",value:`${Math.round(s.metrics.collectionRate)}%`})]}),e.jsxs("div",{children:[c&&e.jsx(f,{label:"Completed order value",value:p(s.metrics.completedOrderValue),accent:!0}),m&&e.jsx(f,{label:"Purchase settlement rate",value:`${Math.round(s.metrics.billSettlementRate)}%`}),j&&e.jsx(f,{label:"Income entries",value:`${r(s.metrics.incomeTransactions)} | ${p(s.metrics.incomeAmount)}`}),j&&e.jsx(f,{label:"Expense entries",value:`${r(s.metrics.expenseTransactions)} | ${p(s.metrics.expenseAmount)}`}),j&&e.jsx(f,{label:"Transfer entries",value:`${r(s.metrics.transferTransactions)} | ${p(s.metrics.transferAmount)}`}),e.jsx(f,{label:"Last activity",value:s.metrics.lastActivity?T(s.metrics.lastActivity):"No activity"})]})]})]}),c&&e.jsxs("div",{className:"rounded-xl border border-gray-100 bg-white p-5",children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Order Status Breakdown"}),e.jsx("p",{className:"mt-1 text-sm text-gray-500",children:"Snapshot of all orders created by this user."}),e.jsx("div",{className:"mt-6 space-y-4",children:l.map(x=>e.jsxs("div",{children:[e.jsxs("div",{className:"mb-2 flex items-center justify-between text-sm",children:[e.jsx("span",{className:"font-semibold text-gray-600",children:x.label}),e.jsx("span",{className:"font-black text-gray-900",children:r(x.value)})]}),e.jsx("div",{className:`h-3 overflow-hidden rounded-full ${x.track}`,children:e.jsx("div",{className:`h-full rounded-full ${x.color}`,style:{width:x.value===0?"0%":`${Math.max(x.value/$*100,8)}%`}})})]},x.label))}),m&&e.jsxs("div",{className:"mt-6 border-t border-gray-100 pt-5",children:[e.jsx(f,{label:"Unique vendors handled",value:r(s.metrics.uniqueVendors)}),e.jsx(f,{label:"Bills paid amount",value:p(s.metrics.billPaidAmount)}),e.jsx(f,{label:"First tracked activity",value:s.metrics.firstActivity?T(s.metrics.firstActivity):"No activity"})]})]})]}),e.jsxs("div",{className:"exclude-from-user-pdf overflow-hidden rounded-xl border border-gray-100 bg-white",children:[e.jsxs("div",{className:"flex flex-col gap-3 border-b border-gray-100 px-6 py-5 md:flex-row md:items-center md:justify-between",children:[e.jsxs("div",{children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Detailed Activity Log"}),e.jsx("p",{className:"text-sm text-gray-500",children:"Every filtered order, bill, and transaction linked to this user."})]}),e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsxs("div",{className:"rounded-lg bg-gray-50 px-3 py-2 text-sm font-bold text-gray-600",children:[r(s.metrics.totalActivities)," entries"]}),e.jsx("button",{type:"button",onClick:()=>ne(s.user.id),className:"rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50","aria-expanded":n,children:n?"Hide Log":"Show Log"})]})]}),e.jsx(ze,{userId:s.user.id,isExpanded:n,filterRange:C,customDates:N})]})]})]},s.user.id)})}),J>1&&e.jsx("div",{className:"flex justify-center",children:e.jsx(ke,{page:S,totalPages:J,onPageChange:z})}),e.jsx("style",{children:`
            @media print {
              @page { size: A4; margin: 0.35in; }
              body { background: white; }
              .no-print { display: none !important; }
              .print-overflow-reset { overflow: visible !important; }
              .report-cover, .user-report-card { box-shadow: none !important; }
              .user-report-card { page-break-after: always; break-after: page; border-color: #d1d5db !important; }
              .user-report-card:last-of-type { page-break-after: auto; break-after: auto; }
              .activity-table { font-size: 10px; }
              .activity-table thead { display: table-header-group; }
              .activity-table tr { page-break-inside: avoid; break-inside: avoid; }
            }
          `})]})]}):e.jsx("div",{className:"p-8 text-center text-gray-500",children:"This report is available to admin-access users only."}):e.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading report access..."})};export{He as default};
