import{r as f,ab as I,j as e}from"./vendor-BqR1Zx1n.js";import{u as X,h as ee,q as te,W as V,E as z,bY as se,I as q,a1 as ae,e as o,B as re,bZ as ie,z as le}from"./index-BuYkwPut.js";import"./Input-BAYSN1mB.js";import{f as L}from"./utils-BM03IZvS.js";import{P as oe}from"./Pagination-Bb7u59wB.js";import{a as ne}from"./router-BPxdbpds.js";import"./react-query-DJ0k8SS9.js";import"./icons-1ky4dCWq.js";const ce=["All Time","Today","This Week","This Month","This Year","Custom"],de=["All Users","Admins","Employees"],me=a=>{if(!a)return null;const t=new Date(a);return Number.isNaN(t.getTime())?null:t},T=a=>{if(!a)return"N/A";const t=me(a);return t?a.length<=10?t.toLocaleDateString("en-BD",{day:"numeric",month:"short",year:"numeric"}):t.toLocaleString("en-BD",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):a},r=a=>new Intl.NumberFormat("en-BD").format(a),xe=a=>a==="Income"?"bg-emerald-100 text-emerald-700":a==="Expense"?"bg-rose-100 text-rose-700":a==="Transfer"?"bg-sky-100 text-sky-700":le(a),pe=(a,t)=>a!=="Custom"?a:t.from&&t.to?`${L(t.from)} to ${L(t.to)}`:t.from?`From ${L(t.from)}`:t.to?`Until ${L(t.to)}`:"Custom Range",l=a=>a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),ge=a=>a.replace(/[<>:"/\\|?*]+/g,"-").replace(/\s+/g," ").trim(),G=a=>{if(!a)return"";if(/^(https?:|data:|blob:)/i.test(a)||typeof window>"u")return a;try{return new URL(a,window.location.href).href}catch{return a}},ue=a=>{const{report:t,companyName:m,companyLogo:n,generatedAt:p,selectedPeriod:P}=a,g=z(t.user.role)?"role-admin":"role-employee",c=G(t.user.image),w=G(n),E=c?`<img src="${l(c)}" alt="${l(t.user.name)}" class="avatar-image" />`:`<div class="avatar-fallback">${l(t.user.name.slice(0,1).toUpperCase())}</div>`,$=[{label:"Orders Created",value:r(t.metrics.ordersCreated),hint:`${r(t.metrics.completedOrders)} completed | ${r(t.metrics.cancelledOrders)} cancelled`,tone:"card-blue"},{label:"Order Value",value:o(t.metrics.orderValue),hint:`${o(t.metrics.orderPaidAmount)} collected`,tone:"card-green"},{label:"Bills Created",value:r(t.metrics.billsCreated),hint:`${o(t.metrics.billValue)} purchase value`,tone:"card-amber"},{label:"Transactions Posted",value:r(t.metrics.transactionsCreated),hint:`${r(t.metrics.activeDays)} active days`,tone:"card-rose"}],F=[["Active days",r(t.metrics.activeDays)],["Unique customers served",r(t.metrics.uniqueCustomers)],["Items handled in orders",r(t.metrics.orderQuantity)],["Average order value",o(t.metrics.averageOrderValue)],["Completion rate",`${Math.round(t.metrics.completionRate)}%`],["Collection rate",`${Math.round(t.metrics.collectionRate)}%`]],A=[["Completed order value",o(t.metrics.completedOrderValue)],["Purchase settlement rate",`${Math.round(t.metrics.billSettlementRate)}%`],["Income entries",`${r(t.metrics.incomeTransactions)} | ${o(t.metrics.incomeAmount)}`],["Expense entries",`${r(t.metrics.expenseTransactions)} | ${o(t.metrics.expenseAmount)}`],["Transfer entries",`${r(t.metrics.transferTransactions)} | ${o(t.metrics.transferAmount)}`],["Last activity",t.metrics.lastActivity?T(t.metrics.lastActivity):"No activity"]],D=[["On Hold",t.metrics.onHoldOrders],["Processing",t.metrics.processingOrders],["Picked",t.metrics.pickedOrders],["Completed",t.metrics.completedOrders],["Cancelled",t.metrics.cancelledOrders]],M=[["Unique vendors handled",r(t.metrics.uniqueVendors)],["Bills paid amount",o(t.metrics.billPaidAmount)],["First tracked activity",t.metrics.firstActivity?T(t.metrics.firstActivity):"No activity"],["Tracked activities",r(t.metrics.totalActivities)]],k=u=>u.map(([j,N])=>`
          <tr>
            <td>${l(j)}</td>
            <td>${l(String(N))}</td>
          </tr>
        `).join(""),S=D.map(([u,j])=>{const N=Number(j),R=t.metrics.ordersCreated>0?`${Math.round(N/t.metrics.ordersCreated*100)}%`:"0%";return`
        <tr>
          <td>${l(u)}</td>
          <td>${l(r(N))}</td>
          <td>${l(R)}</td>
        </tr>
      `}).join(""),U=$.map(u=>`
        <div class="summary-card ${u.tone}">
          <p class="summary-label">${l(u.label)}</p>
          <h3 class="summary-value">${l(u.value)}</h3>
          <p class="summary-hint">${l(u.hint)}</p>
        </div>
      `).join(""),O=w?`<img src="${l(w)}" alt="${l(m)}" class="company-logo" />`:`<div class="company-logo company-logo-fallback">${l(m.slice(0,1).toUpperCase())}</div>`;return`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${l(ge(`${t.user.name} Activity Performance Report`))}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        margin: 0;
        background: #f2efe8;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.55;
      }
      .page {
        width: 100%;
        margin: 0 auto;
        background: #ffffff;
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .user-card {
        display: flex;
        gap: 14px;
        align-items: center;
        padding: 18px;
        border-radius: 14px;
        background-color: #f8fafc;
        border: 1px solid #d6dde5;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      .avatar-image,
      .avatar-fallback {
        width: 72px;
        height: 72px;
        border-radius: 16px;
        flex: 0 0 72px;
      }
      .avatar-image {
        object-fit: cover;
        border: 1px solid #d8e0e8;
      }
      .avatar-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #243a57;
        color: #ffffff;
        font-size: 28px;
        font-weight: 700;
      }
      .user-meta h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 26px;
        font-weight: 700;
        line-height: 1.2;
      }
      .meta-line {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12.5px;
        color: #526173;
      }
      .role-badge {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .role-admin {
        background: #efe8f8;
        color: #6a4f8d;
      }
      .role-employee {
        background: #e7eef8;
        color: #365f8d;
      }
      .report-meta {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 18px;
        padding: 24px;
        border-radius: 16px;
        background-color: #f7f9fa;
      }
      .report-meta-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }
      .report-meta-copy {
        max-width: 72%;
      }
      .report-kicker {
        margin: 0;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .report-title {
        margin: 8px 0 6px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .report-subtitle {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.5;
      }
      .company-lockup {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }
      .company-logo {
        width: 46px;
        height: 46px;
        border-radius: 12px;
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
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        font-size: 12.5px;
      }
      .meta-item {
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background-color: rgba(255, 255, 255, 0.08);
      }
      .meta-item span {
        display: block;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .section {
        margin-top: 16px;
      }
      .section-panel {
        border: 1px solid #d9e0e7;
        border-radius: 16px;
        background-color: #ffffff;
        padding: 20px;
      }
      .section-title {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 19px;
        font-weight: 700;
      }
      .section-subtitle {
        margin: 5px 0 0;
        font-size: 12.5px;
        color: #677487;
        line-height: 1.5;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .summary-card {
        border-radius: 14px;
        padding: 16px;
        border: 1px solid;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
      }
      .summary-label {
        margin: 0;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #5c6978;
      }
      .summary-value {
        margin: 8px 0 5px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 25px;
        font-weight: 700;
        line-height: 1.2;
      }
      .summary-hint {
        margin: 0;
        font-size: 12px;
        color: #5d6875;
        line-height: 1.45;
      }
      .card-blue {
        background-color: #f5f9ff;
        border-color: #d8e4f2;
        color: #20344f;
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
        gap: 16px;
        margin-top: 16px;
      }
      .sub-panel {
        border: 1px solid #dde4ea;
        border-radius: 14px;
        padding: 18px;
        background-color: #fcfdff;
      }
      .sub-title {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 16.5px;
        font-weight: 700;
      }
      .sub-copy {
        margin: 6px 0 0;
        font-size: 12.5px;
        color: #677487;
        line-height: 1.5;
      }
      table.info-table,
      table.status-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
      }
      table.info-table td,
      table.status-table td,
      table.status-table th {
        padding: 10px 0;
        border-bottom: 1px solid #e3e8ee;
        vertical-align: top;
      }
      table.info-table tr:last-child td,
      table.status-table tr:last-child td {
        border-bottom: none;
      }
      table.info-table td:first-child {
        font-size: 12.5px;
        color: #5d6b7a;
        padding-right: 12px;
      }
      table.info-table td:last-child {
        text-align: right;
        font-size: 12.5px;
        font-weight: 600;
        color: #203040;
      }
      table.status-table th {
        font-size: 9.5px;
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
        font-size: 12.5px;
        color: #2a3747;
      }
      .note {
        margin-top: 16px;
        padding: 13px 15px;
        border-radius: 14px;
        border: 1px solid #d9e0e7;
        background-color: #fafcfe;
        font-size: 12.5px;
        color: #5a6776;
        line-height: 1.6;
      }
      .footer {
        margin-top: 18px;
        font-size: 11px;
        color: #808b98;
        text-align: center;
      }
      @media (max-width: 900px) {
        .report-meta-top,
        .company-lockup {
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
        .note,
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
              ${O}
              <div class="report-meta-copy">
                <h2 class="report-title">${l(m)}</h2>
                <p class="report-subtitle">User activity, performance review, and compensation support summary</p>
              </div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-item"><span>Period</span>${l(P)}</div>
            <div class="meta-item"><span>Generated</span>${l(p)}</div>
          </div>
        </div>
        <div class="user-card">
          ${E}
          <div class="user-meta">
            <p class="report-kicker" style="color:#6f7d8d;">User Activity & Performance</p>
            <h1>${l(t.user.name)}</h1>
            <div class="meta-line">
              <span>${l(t.user.phone||"No phone")}</span>
              <span class="role-badge ${g}">${l(t.user.role)}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section section-panel">
        <h3 class="section-title">Performance Snapshot</h3>
        <p class="section-subtitle">All headline figures currently shown on the user activity and performance page, prepared for formal review.</p>
        <div class="summary-grid">
          ${U}
        </div>
      </section>

      <section class="section detail-grid">
        <div class="sub-panel">
          <h4 class="sub-title">Salary Analysis Inputs</h4>
          <p class="sub-copy">Tracked inputs that support salary, commission, and performance-based compensation decisions.</p>
          <table class="info-table">
            ${k(F)}
          </table>
          <table class="info-table">
            ${k(A)}
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
              ${S}
            </tbody>
          </table>
          <table class="info-table">
            ${k(M)}
          </table>
        </div>
      </section>

      <div class="note">
        Detailed activity log entries remain available on-screen for analysis and are intentionally excluded from this PDF export.
      </div>

      <div class="footer">
        Generated by ${l(m)} | User Activity & Performance
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
</html>`},v=({label:a,value:t,hint:m,tone:n})=>e.jsxs("div",{className:`rounded-2xl border p-4 ${n}`,children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] opacity-70",children:a}),e.jsx("h4",{className:"mt-3 text-lg font-black",children:t}),e.jsx("p",{className:"mt-2 text-xs font-semibold opacity-80",children:m})]}),x=({label:a,value:t,accent:m})=>e.jsxs("div",{className:"flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0",children:[e.jsx("span",{className:"text-sm font-medium text-gray-500",children:a}),e.jsx("span",{className:`text-sm font-black ${m?"text-[#0f2f57]":"text-gray-900"}`,children:t})]}),i=({className:a})=>e.jsx("div",{className:`animate-pulse rounded-2xl bg-gray-200/80 ${a}`}),he=()=>e.jsx("div",{className:"space-y-3 px-6 py-6",children:Array.from({length:5}).map((a,t)=>e.jsxs("div",{className:"grid grid-cols-[1.1fr_0.8fr_1fr_1.3fr] gap-3",children:[e.jsx(i,{className:"h-12"}),e.jsx(i,{className:"h-12"}),e.jsx(i,{className:"h-12"}),e.jsx(i,{className:"h-12"})]},t))}),fe=()=>e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{className:"overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:"bg-gradient-to-r from-[#0f2f57] via-[#153867] to-[#1f4b85] px-6 py-6",children:e.jsxs("div",{className:"flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(i,{className:"h-14 w-14 bg-white/20"}),e.jsxs("div",{className:"space-y-3",children:[e.jsx(i,{className:"h-3 w-28 bg-white/20"}),e.jsx(i,{className:"h-8 w-56 bg-white/20"}),e.jsx(i,{className:"h-4 w-64 bg-white/20"})]})]}),e.jsxs("div",{className:"space-y-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-4",children:[e.jsx(i,{className:"h-4 w-48 bg-white/20"}),e.jsx(i,{className:"h-4 w-40 bg-white/20"})]})]})}),e.jsx("div",{className:"grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-5",children:Array.from({length:5}).map((a,t)=>e.jsxs("div",{className:"rounded-2xl border border-gray-100 p-4",children:[e.jsx(i,{className:"h-3 w-24"}),e.jsx(i,{className:"mt-4 h-7 w-28"}),e.jsx(i,{className:"mt-3 h-4 w-36"})]},t))})]}),Array.from({length:3}).map((a,t)=>e.jsxs("section",{className:"overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:"border-b border-gray-100 bg-gradient-to-r from-white via-[#f8fbff] to-white px-6 py-6",children:e.jsxs("div",{className:"flex flex-col gap-4 md:flex-row md:items-center md:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(i,{className:"h-16 w-16 rounded-2xl"}),e.jsxs("div",{className:"space-y-3",children:[e.jsx(i,{className:"h-6 w-40"}),e.jsx(i,{className:"h-4 w-32"})]})]}),e.jsx(i,{className:"h-10 w-32"})]})}),e.jsxs("div",{className:"space-y-6 px-6 py-6",children:[e.jsx("div",{className:"grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4",children:Array.from({length:4}).map((m,n)=>e.jsxs("div",{className:"rounded-2xl border border-gray-100 p-4",children:[e.jsx(i,{className:"h-3 w-24"}),e.jsx(i,{className:"mt-4 h-7 w-28"}),e.jsx(i,{className:"mt-3 h-4 w-32"})]},n))}),e.jsxs("div",{className:"grid gap-6 xl:grid-cols-[1.15fr_0.85fr]",children:[e.jsx("div",{className:"rounded-3xl border border-gray-100 p-6",children:Array.from({length:6}).map((m,n)=>e.jsxs("div",{className:"flex items-center justify-between border-b border-gray-100 py-3 last:border-b-0",children:[e.jsx(i,{className:"h-4 w-32"}),e.jsx(i,{className:"h-4 w-24"})]},n))}),e.jsx("div",{className:"rounded-3xl border border-gray-100 p-6",children:Array.from({length:5}).map((m,n)=>e.jsxs("div",{className:"space-y-2 py-2",children:[e.jsxs("div",{className:"flex items-center justify-between",children:[e.jsx(i,{className:"h-4 w-24"}),e.jsx(i,{className:"h-4 w-10"})]}),e.jsx(i,{className:"h-3 w-full rounded-full"})]},n))})]})]})]},t))]}),be=({userId:a,isExpanded:t,filterRange:m,customDates:n})=>{const{data:p=[],isPending:P,error:g}=ie(a,{filterRange:m,customDates:n},{enabled:t});return t?P?e.jsx(he,{}):g?e.jsx("div",{className:"px-6 py-6 text-sm font-medium text-rose-500",children:"Failed to load the activity log for this user."}):e.jsx("div",{className:"print-overflow-reset overflow-x-auto",children:e.jsxs("table",{className:"activity-table min-w-full text-left",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-gray-50",children:[e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Date"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Type"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Reference"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Counterparty"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Details"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Qty"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Amount"}),e.jsx("th",{className:"px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right",children:"Status"})]})}),e.jsx("tbody",{className:"divide-y divide-gray-50",children:p.length===0?e.jsx("tr",{children:e.jsx("td",{colSpan:8,className:"px-6 py-16 text-center text-sm font-medium italic text-gray-400",children:"No activity tracked for this user in the selected period."})}):p.map(c=>e.jsxs("tr",{className:"hover:bg-gray-50/70",children:[e.jsx("td",{className:"px-6 py-4 text-sm font-semibold text-gray-600",children:T(c.rawDate)}),e.jsx("td",{className:"px-6 py-4",children:e.jsx("span",{className:"rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600",children:c.type})}),e.jsx("td",{className:"px-6 py-4 text-sm font-black text-gray-900",children:c.reference}),e.jsx("td",{className:"px-6 py-4 text-sm font-semibold text-gray-700",children:c.counterparty}),e.jsx("td",{className:"px-6 py-4 text-sm text-gray-500",children:c.details}),e.jsx("td",{className:"px-6 py-4 text-right text-sm font-black text-gray-900",children:c.quantity===null?"-":r(c.quantity)}),e.jsx("td",{className:"px-6 py-4 text-right text-sm font-black text-gray-900",children:c.amount===null?"-":o(c.amount)}),e.jsx("td",{className:"px-6 py-4 text-right",children:e.jsx("span",{className:`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${xe(c.status)}`,children:c.status})})]},c.id))})]})}):e.jsx("div",{className:"px-6 py-6 text-sm font-medium text-gray-400",children:"Expand this section to review the full activity-by-activity log for this user."})},Pe=()=>{const a=ne(),{user:t}=X(),m=ee(),{data:n}=te(),[p,P]=f.useState("All Time"),[g,c]=f.useState({from:"",to:""}),[w,E]=f.useState(""),[$,F]=f.useState("All Users"),[A,D]=f.useState(!1),[M,k]=f.useState([]),[S,U]=f.useState(1),O=10,u=f.useMemo(()=>new Date().toLocaleString("en-BD",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}),[]),j=(n==null?void 0:n.name)||V.settings.company.name||"Mame Pilot",N=(n==null?void 0:n.logo)||V.settings.company.logo||"",R=f.useMemo(()=>pe(p,g),[p,g]),H=f.useMemo(()=>({search:w,roleFilter:$,filterRange:p,customDates:g,onlyActive:A}),[w,$,p,g,A]),Q=!!t&&z(t.role),{data:h,isPending:W,isFetching:ye}=se(S,O,H,{enabled:Q}),B=(h==null?void 0:h.data)??[],C=(h==null?void 0:h.totals)??{users:0,activeUsers:0,orders:0,bills:0,transactions:0,orderValue:0},Y=(h==null?void 0:h.count)??0,_=Math.max(1,Math.ceil(Y/O));I.useEffect(()=>{U(1),k([])},[w,$,p,g.from,g.to,A]),I.useEffect(()=>{k([])},[S]);const Z=s=>{k(d=>d.includes(s)?d.filter(b=>b!==s):[...d,s])},J=s=>{const d=window.open("","_blank","width=1100,height=820");if(!d){m.error("Please allow pop-ups to export the user PDF.");return}try{const b=ue({report:s,companyName:j,companyLogo:N,generatedAt:u,selectedPeriod:R});d.document.open(),d.document.write(b),d.document.close(),d.focus()}catch(b){d.close(),m.error(`Failed to prepare the user PDF: ${b instanceof Error?b.message:"Unknown error"}`)}};return t?z(t.role)?W&&!h?e.jsx(fe,{}):e.jsxs("div",{className:"space-y-6",children:[e.jsx("div",{className:"no-print flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("button",{onClick:()=>a("/reports"),className:"p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500",children:e.jsx("svg",{className:"w-5 h-5",fill:"none",stroke:"currentColor",viewBox:"0 0 24 24",children:e.jsx("path",{strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:"2",d:"M10 19l-7-7m0 0l7-7m-7 7h18"})})}),e.jsx("div",{children:e.jsx("h2",{className:"text-2xl font-bold text-gray-900",children:"User Activity & Performance"})})]})}),e.jsxs("div",{className:"report-cover overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm",children:[e.jsx("div",{className:"bg-gradient-to-r from-[#0f2f57] via-[#153867] to-[#1f4b85] px-6 py-6 text-white",children:e.jsxs("div",{className:"flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[N?e.jsx("img",{src:N,alt:j,className:"h-14 w-14 rounded-2xl object-cover bg-white/10 p-1"}):e.jsx("div",{className:"flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl font-black",children:j.slice(0,1).toUpperCase()}),e.jsxs("div",{children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.3em] text-[#c7dff5]",children:"Admin Report"}),e.jsx("h3",{className:"mt-2 text-2xl font-black",children:j}),e.jsx("p",{className:"mt-1 text-sm text-[#d7e8fb]",children:"Built from tracked orders, bills, and transactions by user."})]})]}),e.jsxs("div",{className:"rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-sm font-medium",children:[e.jsxs("p",{children:[e.jsx("span",{className:"text-[#c7dff5]",children:"Period:"})," ",R]}),e.jsxs("p",{className:"mt-1",children:[e.jsx("span",{className:"text-[#c7dff5]",children:"Generated:"})," ",u]})]})]})}),e.jsx("div",{className:"no-print border-b border-gray-100 px-6 py-6",children:e.jsxs("div",{className:"grid gap-4 xl:grid-cols-[1.4fr_1fr]",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"relative",children:[e.jsx("input",{type:"text",value:w,onChange:s=>E(s.target.value),placeholder:"Search by name, phone, or role",className:"w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 pl-11 text-sm font-medium outline-none focus:ring-2 focus:ring-[#3c5a82]"}),e.jsx("span",{className:"absolute left-4 top-1/2 -translate-y-1/2 text-gray-400",children:q.Search})]}),e.jsxs("div",{className:"flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-2",children:[ce.map(s=>e.jsx("button",{onClick:()=>P(s),className:`rounded-xl px-4 py-2 text-xs font-black transition-all ${p===s?`${ae.colors.primary[600]} text-white`:"text-gray-500 hover:bg-white"}`,children:s},s)),p==="Custom"&&e.jsxs("div",{className:"flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2",children:[e.jsx("input",{type:"date",value:g.from,onChange:s=>c(d=>({...d,from:s.target.value})),className:"rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"}),e.jsx("span",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-gray-300",children:"To"}),e.jsx("input",{type:"date",value:g.to,onChange:s=>c(d=>({...d,to:s.target.value})),className:"rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"})]})]})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("div",{className:"flex flex-wrap gap-2",children:de.map(s=>e.jsx("button",{onClick:()=>F(s),className:`rounded-xl border px-4 py-2 text-xs font-black transition-all ${$===s?"border-[#0f2f57] bg-[#0f2f57] text-white":"border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"}`,children:s},s))}),e.jsxs("label",{className:"flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3",children:[e.jsx("input",{type:"checkbox",checked:A,onChange:s=>D(s.target.checked),className:"h-4 w-4 rounded border-gray-300 text-[#0f2f57] focus:ring-[#3c5a82]"}),e.jsxs("div",{children:[e.jsx("p",{className:"text-sm font-black text-gray-900",children:"Only show users with activity"}),e.jsx("p",{className:"text-xs font-medium text-gray-500",children:"Hide empty users for the selected period."})]})]})]})]})}),e.jsxs("div",{className:"grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-5",children:[e.jsx(v,{label:"Users Included",value:r(C.users),hint:`${r(C.activeUsers)} active users`,tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"}),e.jsx(v,{label:"Orders Captured",value:r(C.orders),hint:"User-created orders in this view",tone:"bg-emerald-50 border-emerald-100 text-emerald-700"}),e.jsx(v,{label:"Bills Captured",value:r(C.bills),hint:"User-created bills in this view",tone:"bg-amber-50 border-amber-100 text-amber-700"}),e.jsx(v,{label:"Finance Entries",value:r(C.transactions),hint:"Transactions posted by users",tone:"bg-rose-50 border-rose-100 text-rose-700"}),e.jsx(v,{label:"Gross Order Value",value:o(C.orderValue),hint:"All tracked order totals",tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"})]})]}),B.length===0?e.jsx("div",{className:"rounded-3xl border border-dashed border-gray-200 bg-white p-16 text-center text-gray-500",children:"No users matched the current filters."}):e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"space-y-6",children:B.map(s=>{const d=M.includes(s.user.id),b=[{label:"On Hold",value:s.metrics.onHoldOrders,color:"bg-amber-500",track:"bg-amber-100"},{label:"Processing",value:s.metrics.processingOrders,color:"bg-sky-500",track:"bg-sky-100"},{label:"Picked",value:s.metrics.pickedOrders,color:"bg-cyan-500",track:"bg-cyan-100"},{label:"Completed",value:s.metrics.completedOrders,color:"bg-emerald-500",track:"bg-emerald-100"},{label:"Cancelled",value:s.metrics.cancelledOrders,color:"bg-rose-500",track:"bg-rose-100"}],K=Math.max(1,...b.map(y=>y.value));return e.jsxs("section",{className:"user-report-card overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm","data-user-id":s.user.id,children:[e.jsx("div",{className:"border-b border-gray-100 bg-gradient-to-r from-white via-[#f8fbff] to-white px-6 py-6",children:e.jsxs("div",{className:"rounded-3xl",children:[e.jsxs("div",{className:"flex flex-col gap-2 md:flex-row md:items-center md:justify-between",children:[e.jsx("div",{className:"rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm",children:e.jsxs("div",{className:"flex items-center gap-4",children:[s.user.image?e.jsx("img",{src:s.user.image,alt:s.user.name,className:"h-16 w-16 rounded-2xl object-cover ring-1 ring-[#dce6f2]"}):e.jsx("div",{className:"flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0f2f57] text-2xl font-black text-white",children:s.user.name.slice(0,1).toUpperCase()}),e.jsxs("div",{className:"min-w-0",children:[e.jsx("h3",{className:"mt-2 truncate text-xl font-black text-gray-900",children:s.user.name}),e.jsxs("div",{className:"mt-2 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-500",children:[e.jsx("span",{children:s.user.phone||"No phone"}),e.jsx("span",{className:`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${z(s.user.role)?"bg-purple-100 text-purple-700":"bg-blue-100 text-blue-700"}`,children:s.user.role})]})]})]})}),e.jsx("div",{className:"no-print md:ml-auto",children:e.jsx(re,{onClick:()=>J(s),variant:"primary",size:"md",icon:q.Download,children:"Export PDF"})})]}),e.jsxs("div",{className:"mt-4 grid gap-3 text-sm font-medium text-gray-600 sm:grid-cols-2",children:[e.jsxs("div",{className:"rounded-2xl bg-white px-4 py-3 border border-[#d6e3f0]",children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Period"}),e.jsx("p",{className:"mt-1 text-sm font-bold text-gray-900",children:R})]}),e.jsxs("div",{className:"rounded-2xl bg-white px-4 py-3 border border-[#d6e3f0]",children:[e.jsx("p",{className:"text-[10px] font-black uppercase tracking-[0.2em] text-gray-400",children:"Generated"}),e.jsx("p",{className:"mt-1 text-sm font-bold text-gray-900",children:u})]})]})]})}),e.jsxs("div",{className:"space-y-8 px-6 py-6",children:[e.jsxs("div",{className:"grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4",children:[e.jsx(v,{label:"Orders Created",value:r(s.metrics.ordersCreated),hint:`${r(s.metrics.completedOrders)} completed | ${r(s.metrics.cancelledOrders)} cancelled`,tone:"bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]"}),e.jsx(v,{label:"Order Value",value:o(s.metrics.orderValue),hint:`${o(s.metrics.orderPaidAmount)} collected`,tone:"bg-emerald-50 border-emerald-100 text-emerald-700"}),e.jsx(v,{label:"Bills Created",value:r(s.metrics.billsCreated),hint:`${o(s.metrics.billValue)} purchase value`,tone:"bg-amber-50 border-amber-100 text-amber-700"}),e.jsx(v,{label:"Transactions Posted",value:r(s.metrics.transactionsCreated),hint:`${r(s.metrics.activeDays)} active days`,tone:"bg-rose-50 border-rose-100 text-rose-700"})]}),e.jsxs("div",{className:"grid gap-6 xl:grid-cols-[1.15fr_0.85fr]",children:[e.jsxs("div",{className:"rounded-3xl border border-gray-100 bg-white p-6",children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Salary Analysis Inputs"}),e.jsx("p",{className:"text-sm text-gray-500",children:"Tracked inputs admins can use for salary and incentive decisions."}),e.jsxs("div",{className:"mt-4 grid gap-1 md:grid-cols-2 md:gap-x-8",children:[e.jsxs("div",{children:[e.jsx(x,{label:"Active days",value:r(s.metrics.activeDays),accent:!0}),e.jsx(x,{label:"Unique customers served",value:r(s.metrics.uniqueCustomers)}),e.jsx(x,{label:"Items handled in orders",value:r(s.metrics.orderQuantity)}),e.jsx(x,{label:"Average order value",value:o(s.metrics.averageOrderValue)}),e.jsx(x,{label:"Completion rate",value:`${Math.round(s.metrics.completionRate)}%`}),e.jsx(x,{label:"Collection rate",value:`${Math.round(s.metrics.collectionRate)}%`})]}),e.jsxs("div",{children:[e.jsx(x,{label:"Completed order value",value:o(s.metrics.completedOrderValue),accent:!0}),e.jsx(x,{label:"Purchase settlement rate",value:`${Math.round(s.metrics.billSettlementRate)}%`}),e.jsx(x,{label:"Income entries",value:`${r(s.metrics.incomeTransactions)} | ${o(s.metrics.incomeAmount)}`}),e.jsx(x,{label:"Expense entries",value:`${r(s.metrics.expenseTransactions)} | ${o(s.metrics.expenseAmount)}`}),e.jsx(x,{label:"Transfer entries",value:`${r(s.metrics.transferTransactions)} | ${o(s.metrics.transferAmount)}`}),e.jsx(x,{label:"Last activity",value:s.metrics.lastActivity?T(s.metrics.lastActivity):"No activity"})]})]})]}),e.jsxs("div",{className:"rounded-3xl border border-gray-100 bg-white p-6",children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Order Status Breakdown"}),e.jsx("p",{className:"mt-1 text-sm text-gray-500",children:"Snapshot of all orders created by this user."}),e.jsx("div",{className:"mt-6 space-y-4",children:b.map(y=>e.jsxs("div",{children:[e.jsxs("div",{className:"mb-2 flex items-center justify-between text-sm",children:[e.jsx("span",{className:"font-semibold text-gray-600",children:y.label}),e.jsx("span",{className:"font-black text-gray-900",children:r(y.value)})]}),e.jsx("div",{className:`h-3 overflow-hidden rounded-full ${y.track}`,children:e.jsx("div",{className:`h-full rounded-full ${y.color}`,style:{width:y.value===0?"0%":`${Math.max(y.value/K*100,8)}%`}})})]},y.label))}),e.jsxs("div",{className:"mt-6 border-t border-gray-100 pt-5",children:[e.jsx(x,{label:"Unique vendors handled",value:r(s.metrics.uniqueVendors)}),e.jsx(x,{label:"Bills paid amount",value:o(s.metrics.billPaidAmount)}),e.jsx(x,{label:"First tracked activity",value:s.metrics.firstActivity?T(s.metrics.firstActivity):"No activity"})]})]})]}),e.jsxs("div",{className:"exclude-from-user-pdf overflow-hidden rounded-3xl border border-gray-100 bg-white",children:[e.jsxs("div",{className:"flex flex-col gap-3 border-b border-gray-100 px-6 py-5 md:flex-row md:items-center md:justify-between",children:[e.jsxs("div",{children:[e.jsx("h4",{className:"text-lg font-black text-gray-900",children:"Detailed Activity Log"}),e.jsx("p",{className:"text-sm text-gray-500",children:"Every filtered order, bill, and transaction linked to this user."})]}),e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsxs("div",{className:"rounded-2xl bg-gray-50 px-3 py-2 text-sm font-bold text-gray-600",children:[r(s.metrics.totalActivities)," entries"]}),e.jsx("button",{type:"button",onClick:()=>Z(s.user.id),className:"rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50","aria-expanded":d,children:d?"Hide Log":"Show Log"})]})]}),e.jsx(be,{userId:s.user.id,isExpanded:d,filterRange:p,customDates:g})]})]})]},s.user.id)})}),_>1&&e.jsx("div",{className:"flex justify-center",children:e.jsx(oe,{page:S,totalPages:_,onPageChange:U})}),e.jsx("style",{children:`
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
          `})]})]}):e.jsx("div",{className:"p-8 text-center text-gray-500",children:"This report is available to admin-access users only."}):e.jsx("div",{className:"p-8 text-center text-gray-500",children:"Loading report access..."})};export{Pe as default};
