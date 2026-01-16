import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createSQSEvent, mockLambdaContext } from './fixtures'

describe('SQS routing', () => {
	test('routes to exact queue match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.sqs({ queueName: 'orders-queue' }, handler)

		const event = createSQSEvent('orders-queue', 'msg-1', { orderId: '123' })
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes to catch-all handler when no specific match', async () => {
		const router = new EventRouter()
		const catchAllHandler = mock(() => {})

		router.sqs(catchAllHandler)

		const event = createSQSEvent('any-queue', 'msg-1', { data: 'test' })
		await router.handler()(event, mockLambdaContext)

		expect(catchAllHandler).toHaveBeenCalledTimes(1)
	})

	test('first match wins (specific before catch-all)', async () => {
		const router = new EventRouter()
		const specificHandler = mock(() => {})
		const catchAllHandler = mock(() => {})

		router.sqs({ queueName: 'orders-queue' }, specificHandler)
		router.sqs(catchAllHandler)

		const event = createSQSEvent('orders-queue', 'msg-1', { orderId: '123' })
		await router.handler()(event, mockLambdaContext)

		expect(specificHandler).toHaveBeenCalledTimes(1)
		expect(catchAllHandler).not.toHaveBeenCalled()
	})

	test('first match wins (catch-all before specific)', async () => {
		const router = new EventRouter()
		const specificHandler = mock(() => {})
		const catchAllHandler = mock(() => {})

		router.sqs(catchAllHandler)
		router.sqs({ queueName: 'orders-queue' }, specificHandler)

		const event = createSQSEvent('orders-queue', 'msg-1', { orderId: '123' })
		await router.handler()(event, mockLambdaContext)

		expect(catchAllHandler).toHaveBeenCalledTimes(1)
		expect(specificHandler).not.toHaveBeenCalled()
	})

	test('provides correct context properties', async () => {
		const router = new EventRouter()
		let capturedContext: unknown

		router.sqs({ queueName: 'orders-queue' }, (c) => {
			capturedContext = {
				queue: c.sqs.queue,
				body: c.sqs.body,
				messageId: c.sqs.messageId,
				lambdaRequestId: c.lambdaContext.awsRequestId,
			}
		})

		const event = createSQSEvent('orders-queue', 'msg-123', {
			orderId: '456',
		})
		await router.handler()(event, mockLambdaContext)

		expect(capturedContext).toEqual({
			queue: 'orders-queue',
			body: { orderId: '456' },
			messageId: 'msg-123',
			lambdaRequestId: 'test-request-id',
		})
	})

	test('returns batch item failures for failed records', async () => {
		const router = new EventRouter()

		router.sqs({ queueName: 'orders-queue' }, () => {
			throw new Error('Processing failed')
		})

		const event = createSQSEvent('orders-queue', 'msg-fail', { data: 'test' })
		const result = await router.handler()(event, mockLambdaContext)

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: 'msg-fail' }],
		})
	})

	test('get/set works on context', async () => {
		const router = new EventRouter()
		let getValue: unknown

		router.sqs({ queueName: 'orders-queue' }, (c) => {
			c.set('traceId', 'trace-123')
			getValue = c.get('traceId')
		})

		const event = createSQSEvent('orders-queue', 'msg-1', {})
		await router.handler()(event, mockLambdaContext)

		expect(getValue).toBe('trace-123')
	})
})
