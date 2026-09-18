import React from 'react';

type InvoiceContactIconProps = {
  type: 'location' | 'phone' | 'email';
  size?: number;
  className?: string;
};

const paths = {
  location: 'M11.54 22.351a.75.75 0 0 0 .92 0c.178-.14 4.24-3.465 6.54-7.704A7.75 7.75 0 1 0 5 14.647c2.3 4.239 6.362 7.564 6.54 7.704ZM12 12.75a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z',
  phone: 'M1.5 4.5A2.25 2.25 0 0 1 3.75 2.25h1.5c.9 0 1.69.535 2.045 1.36l1.07 2.496a2.25 2.25 0 0 1-.49 2.45l-.86.86a12.04 12.04 0 0 0 4.567 4.567l.86-.86a2.25 2.25 0 0 1 2.45-.49l2.496 1.07a2.25 2.25 0 0 1 1.36 2.045v1.5a2.25 2.25 0 0 1-2.25 2.25h-.75C8.896 19.5 4.5 15.104 4.5 9.75V9A2.25 2.25 0 0 1 1.5 6.75V4.5Z',
  email: 'M1.5 6.75A2.25 2.25 0 0 1 3.75 4.5h16.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H3.75a2.25 2.25 0 0 1-2.25-2.25V6.75Zm2.25.75v.638l7.252 4.533a1.875 1.875 0 0 0 1.996 0l7.252-4.533V7.5l-7.49 4.682a1.5 1.5 0 0 1-1.52 0L3.75 7.5Z',
} as const;

const labels = { location: 'Location', phone: 'Phone', email: 'Email' } as const;

export const InvoiceContactIcon: React.FC<InvoiceContactIconProps> = ({ type, size = 13, className }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="currentColor"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path d={paths[type]} />
  </svg>
);

export const invoiceContactIconLabel = labels;
