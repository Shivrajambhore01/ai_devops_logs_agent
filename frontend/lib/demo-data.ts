import type { Activity, Deployment, Incident, LogLine, Repository } from '@/lib/types'

export const incidents: Incident[] = []

export const deployments: Deployment[] = []

export const repositories: Repository[] = []

export const activities: Activity[] = []

export const logs: LogLine[] = [
  { time: '12:06:10', level: 'INFO', service: 'checkout-api', message: 'Received checkout request for order #9481 (auth: [REDACTED_TOKEN])' },
  { time: '12:06:11', level: 'INFO', service: 'checkout-api', message: 'Calculating tax for user address record' },
  { time: '12:06:12', level: 'ERROR', service: 'checkout-api', message: 'TypeError: Cannot read property \'zipCode\' of undefined at calculateTax (src/tax/calculate.ts:13:23)' },
  { time: '12:06:13', level: 'ERROR', service: 'checkout-api', message: 'UnhandledRejection: Tax calculation failed for legacy address schema' },
  { time: '12:05:00', level: 'INFO', service: 'auth-middleware', message: 'Initializing JWT RBAC middleware handler' },
  { time: '12:05:05', level: 'WARN', service: 'auth-middleware', message: 'Deprecated token signature algorithm HS256 detected' },
  { time: '12:05:12', level: 'ERROR', service: 'auth-middleware', message: 'AuthenticationError: Session validation failed (secret: [REDACTED_SECRET])' },
  { time: '12:07:01', level: 'INFO', service: 'payment-gateway', message: 'Processing credit card authorization via Stripe API' },
  { time: '12:07:05', level: 'ERROR', service: 'payment-gateway', message: 'PaymentGatewayError: Connection timeout reaching gateway endpoint' },
  { time: '12:04:10', level: 'INFO', service: 'user-service', message: 'Fetching user profile record ID #4092' },
  { time: '12:04:12', level: 'ERROR', service: 'user-service', message: 'DatabaseQueryError: Connection pool exhausted at db.ts:88:14' },
]

export const healthTrend = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]

