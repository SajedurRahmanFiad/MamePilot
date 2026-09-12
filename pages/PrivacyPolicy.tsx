import React, { useEffect } from 'react';

const PrivacyPolicy: React.FC = () => {
  useEffect(() => {
    document.title = 'Privacy Policy | Mame Pilot';
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-10 text-slate-800 sm:px-6 sm:py-16">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 bg-[#0f2f57] px-6 py-8 text-white sm:px-10 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">Mame Studios</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Privacy Policy for Mame Pilot</h1>
          <p className="mt-4 text-sm text-blue-100">Last Updated: 13th September 2026</p>
        </header>

        <div className="space-y-8 px-6 py-8 sm:px-10 sm:py-10">
          <section>
            <h2 className="text-xl font-bold text-slate-950">1. Introduction</h2>
            <p className="mt-3 leading-7 text-slate-600">
              Mame Studios operates Mame Pilot, a business management platform for sales, orders, purchases, inventory, customers, finance, staff, marketing, communications, and related business operations. This Privacy Policy explains how we collect, use, store, and protect information when you use Mame Pilot or connect third-party services to it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">2. Data We Collect</h2>
            <p className="mt-3 leading-7 text-slate-600">
              Depending on the features you use and the services you connect, Mame Pilot may collect and process the following categories of information:
            </p>
            <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-600 marker:text-[#0f2f57]">
              <li><strong className="font-bold text-slate-800">Account and workspace information:</strong> Names, phone numbers, email addresses, roles, permissions, business names, workspace settings, authentication records, and profile information.</li>
              <li><strong className="font-bold text-slate-800">Business and customer data:</strong> Customer, lead, vendor, supplier, company, contact, address, communication, order, delivery, return, exchange, and service information entered by authorized users.</li>
              <li><strong className="font-bold text-slate-800">Sales and purchase records:</strong> Orders, bills, invoices, products, quantities, prices, discounts, taxes, payment status, delivery status, returns, refunds, and related history.</li>
              <li><strong className="font-bold text-slate-800">Financial and accounting data:</strong> Transactions, accounts, balances, expenses, income, payroll-related records, payment methods, adjustments, settlements, and other financial information entered into the platform. Mame Pilot does not require your payment-card PIN or banking password.</li>
              <li><strong className="font-bold text-slate-800">Inventory and operational data:</strong> Product catalogs, stock levels, batches, categories, warehouses, purchase costs, sales costs, stock movements, and operational notes.</li>
              <li><strong className="font-bold text-slate-800">Messenger data:</strong> When you connect a Facebook Page, Page IDs, Page names, access credentials or tokens, incoming customer messages, sender profile information, attachments made available by Meta, and replies created by authorized administrators.</li>
              <li><strong className="font-bold text-slate-800">WhatsApp data:</strong> When you connect WhatsApp or WhatsApp Business services, business account and phone-number identifiers, contact details, message content, delivery status, templates, media, and replies handled through the connected account.</li>
              <li><strong className="font-bold text-slate-800">Marketing and integration data:</strong> Advertising account identifiers, campaign and ad information, lead data, attribution information, courier or payment-provider responses, and other data returned by integrations you authorize.</li>
            </ul>
            <p className="mt-4 leading-7 text-slate-600">We do not intentionally collect precise location data, device identifiers, contact lists, or unrelated browsing activity as part of Mame Pilot&apos;s business features.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">3. How We Process and Use Data</h2>
            <p className="mt-3 leading-7 text-slate-600">
              We process information to provide, maintain, secure, and improve Mame Pilot and the services you request. This includes:
            </p>
            <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-600 marker:text-[#0f2f57]">
              <li>Providing dashboards, customer support inboxes, order, bill, inventory, accounting, reporting, payroll, and business management tools.</li>
              <li>Allowing authorized users to create, view, edit, search, export, and manage business records according to their permissions.</li>
              <li>Synchronizing information with third-party services you explicitly connect, including Meta Messenger, WhatsApp, courier, payment, advertising, and other integrations.</li>
              <li>Processing customer inquiries and allowing authorized administrators to read, manage, and reply to messages.</li>
              <li>Calculating totals, balances, reports, stock movements, statuses, commissions, and other results requested through the platform.</li>
              <li>Authenticating users, enforcing roles and permissions, preventing fraud or abuse, monitoring security, troubleshooting, and maintaining service reliability.</li>
              <li>Communicating with workspace administrators about account activity, service notices, security issues, support requests, and important product changes.</li>
            </ul>
            <p className="mt-4 leading-7 text-slate-600">We do not sell personal information or use Meta or WhatsApp platform data for advertising, profiling, or unauthorized tracking.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">4. Legal Bases and Your Responsibilities</h2>
            <p className="mt-3 leading-7 text-slate-600">
              We process data to perform the services requested by your organization, with your consent where required, to comply with legal obligations, and for our legitimate interests in securing and operating Mame Pilot. The organization or account administrator that provides data to Mame Pilot is generally responsible for determining why business and customer data is collected and how it may be used. You must have the necessary rights and permissions before entering another person&apos;s information or connecting an external account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">5. Data Sharing and Third Parties</h2>
            <p className="mt-3 leading-7 text-slate-600">We do not sell your personal information or business data. We may share information only as needed to operate the service:</p>
            <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-600 marker:text-[#0f2f57]">
              <li><strong className="font-bold text-slate-800">Service providers:</strong> Trusted hosting, database, storage, monitoring, authentication, support, email, analytics, payment, courier, and infrastructure providers that process data on our instructions and under confidentiality and security obligations.</li>
              <li><strong className="font-bold text-slate-800">Connected services:</strong> Meta, WhatsApp, courier, payment, advertising, and other integrations only when you or an authorized administrator enables them. Their own privacy policies also apply.</li>
              <li><strong className="font-bold text-slate-800">Legal and safety purposes:</strong> Authorities, advisors, or other parties when required by law, legal process, protection of rights, prevention of fraud, or protection of users and the service.</li>
              <li><strong className="font-bold text-slate-800">Business transfers:</strong> A successor or buyer in connection with a merger, acquisition, financing, reorganization, or sale of assets, subject to appropriate confidentiality protections.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">6. Security</h2>
            <p className="mt-3 leading-7 text-slate-600">We use reasonable administrative, technical, and organizational safeguards designed to protect information against unauthorized access, loss, misuse, alteration, and disclosure. These measures may include access controls, role-based permissions, authentication protections, encryption in transit, logging, backups, and security monitoring. No online service can guarantee absolute security, and you are responsible for protecting your credentials and limiting access within your organization.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">7. Data Retention and Deletion</h2>
            <p className="mt-3 leading-7 text-slate-600">We retain information for as long as reasonably necessary to provide Mame Pilot, maintain business records, satisfy legal and accounting obligations, resolve disputes, enforce agreements, and protect the service. Retention periods may differ by data type and workspace settings.</p>
            <ul className="mt-4 list-disc space-y-3 pl-5 leading-7 text-slate-600 marker:text-[#0f2f57]">
              <li><strong className="font-bold text-slate-800">Disconnecting an integration:</strong> You can remove access through the relevant Facebook Business Integrations, WhatsApp, advertising, courier, payment, or other connected-service settings.</li>
              <li><strong className="font-bold text-slate-800">Workspace deletion:</strong> An authorized workspace administrator may request deletion of stored account, business, financial, customer, inventory, and communication data.</li>
              <li><strong className="font-bold text-slate-800">Manual deletion request:</strong> Contact us at <a className="font-semibold text-[#0f2f57] underline underline-offset-4" href="mailto:mamestudiosbd@gmail.com">mamestudiosbd@gmail.com</a>. We will verify the request and process eligible deletion requests within 7 days, subject to legal, security, backup, and legitimate business requirements.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">8. Your Choices and Rights</h2>
            <p className="mt-3 leading-7 text-slate-600">Depending on your location and applicable law, you may have rights to access, correct, export, restrict, object to, or request deletion of your personal information. You may also withdraw consent where processing is based on consent. Requests should be made through your workspace administrator or by contacting us. We may need to verify your identity and authority before completing a request.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">9. Cookies and Similar Technologies</h2>
            <p className="mt-3 leading-7 text-slate-600">Mame Pilot may use essential cookies, local storage, session technologies, and similar mechanisms to keep you signed in, remember preferences, secure the application, measure reliability, and maintain functionality. Disabling essential technologies may prevent parts of the application from working correctly.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">10. International Processing</h2>
            <p className="mt-3 leading-7 text-slate-600">Mame Studios and its service providers may process information in countries other than the country where you or your customers are located. Where required, we use appropriate safeguards for international data transfers and require service providers to protect information consistently with this policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">11. Children&apos;s Privacy</h2>
            <p className="mt-3 leading-7 text-slate-600">Mame Pilot is a business service and is not directed to children. We do not knowingly collect personal information directly from children. If you believe a child has provided information to us, please contact us so that we can review and delete it where appropriate.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">12. Changes to This Policy</h2>
            <p className="mt-3 leading-7 text-slate-600">We may update this Privacy Policy when our services, integrations, or legal obligations change. We will post the updated policy on this page and update the Last Updated date. Your continued use of Mame Pilot after an update means the revised policy applies to your use of the service.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">13. Contact Us</h2>
            <p className="mt-3 leading-7 text-slate-600">
              For questions regarding this policy, please contact Mame Studios at{' '}
              <a className="font-semibold text-[#0f2f57] underline underline-offset-4" href="mailto:mamestudiosbd@gmail.com">mamestudiosbd@gmail.com</a>.
            </p>
          </section>
        </div>

        <footer className="border-t border-slate-200 px-6 py-6 sm:px-10">
          <a className="text-sm font-semibold text-[#0f2f57] hover:underline" href="/#/login">Return to Mame Pilot</a>
        </footer>
      </article>
    </main>
  );
};

export default PrivacyPolicy;
