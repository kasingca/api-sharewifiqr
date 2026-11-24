import { endpoint } from '../src/entry.ts'

// Vercel rewrites /v1/customers/:customerId/payment-method here and passes the ID as a query parameter.
// createApi validates the ID format, so an unexpected value resolves to 404.
export default endpoint(url => {
  const customerId = url.searchParams.get('customerId')
  return customerId === null ? url.pathname : `/v1/customers/${encodeURIComponent(customerId)}/payment-method`
})
