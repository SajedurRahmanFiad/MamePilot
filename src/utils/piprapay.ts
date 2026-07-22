const RETURN_PARAMETER_NAMES = [
  'payment',
  'pp_status',
  'payment_status',
  'pp_id',
  'payment_id',
  'transaction_id',
  'order_id',
  'reference',
  'transaction_ref',
  'transaction_reference',
] as const;

export const readPipraPayReturnStatus = (params: URLSearchParams): string => (
  params.get('payment') || params.get('pp_status') || params.get('payment_status') || ''
);

export const hasPipraPayReturnSignal = (params: URLSearchParams): boolean => Boolean(
  readPipraPayReturnStatus(params)
  || params.get('pp_id')
  || params.get('payment_id')
);

export const readPipraPayReturnParams = (): URLSearchParams => {
  const params = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.split('?')[1] || '';

  new URLSearchParams(hashQuery).forEach((value, key) => {
    if (!params.has(key)) {
      params.set(key, value);
    }
  });

  return params;
};

export const clearPipraPayReturnParams = (): void => {
  const search = new URLSearchParams(window.location.search);
  RETURN_PARAMETER_NAMES.forEach((name) => search.delete(name));

  const [hashPath, hashQuery = ''] = window.location.hash.split('?');
  const hashParams = new URLSearchParams(hashQuery);
  RETURN_PARAMETER_NAMES.forEach((name) => hashParams.delete(name));

  const nextSearch = search.toString();
  const nextHashQuery = hashParams.toString();
  const nextUrl = window.location.pathname
    + (nextSearch ? `?${nextSearch}` : '')
    + hashPath
    + (nextHashQuery ? `?${nextHashQuery}` : '');
  window.history.replaceState(null, '', nextUrl);
};
