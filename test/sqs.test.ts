import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import {
	createSQSBatchEvent,
	createSQSEvent,
	mockLambdaContext,
} from './fixtures'

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
				myAttribute: c.sqs.attribute('myAttribute'),
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
			myAttribute: 'value',
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

	test('sequential: true processes records in order', async () => {
		const router = new EventRouter()
		const order: string[] = []

		router.sqs({ queueName: 'fifo-queue', sequential: true }, async (c) => {
			const id = c.sqs.messageId
			order.push(`start-${id}`)
			// Simulate async work with varying delays
			await new Promise((r) => setTimeout(r, id === 'msg-1' ? 20 : 5))
			order.push(`end-${id}`)
		})

		const event = createSQSBatchEvent('fifo-queue', [
			{ messageId: 'msg-1', body: { n: 1 } },
			{ messageId: 'msg-2', body: { n: 2 } },
			{ messageId: 'msg-3', body: { n: 3 } },
		])
		await router.handler()(event, mockLambdaContext)

		// Sequential: each record starts and ends before the next starts
		expect(order).toEqual([
			'start-msg-1',
			'end-msg-1',
			'start-msg-2',
			'end-msg-2',
			'start-msg-3',
			'end-msg-3',
		])
	})

	test('concurrent (default) processes records in parallel', async () => {
		const router = new EventRouter()
		const order: string[] = []

		router.sqs({ queueName: 'standard-queue' }, async (c) => {
			const id = c.sqs.messageId
			order.push(`start-${id}`)
			// Simulate async work with varying delays
			await new Promise((r) => setTimeout(r, id === 'msg-1' ? 20 : 5))
			order.push(`end-${id}`)
		})

		const event = createSQSBatchEvent('standard-queue', [
			{ messageId: 'msg-1', body: { n: 1 } },
			{ messageId: 'msg-2', body: { n: 2 } },
			{ messageId: 'msg-3', body: { n: 3 } },
		])
		await router.handler()(event, mockLambdaContext)

		// Concurrent: all start before any ends (msg-1 takes longest)
		expect(order.slice(0, 3)).toEqual([
			'start-msg-1',
			'start-msg-2',
			'start-msg-3',
		])
		// msg-2 and msg-3 finish before msg-1
		expect(order.indexOf('end-msg-2')).toBeLessThan(order.indexOf('end-msg-1'))
		expect(order.indexOf('end-msg-3')).toBeLessThan(order.indexOf('end-msg-1'))
	})

	test('sequential catch-all with { sequential: true }', async () => {
		const router = new EventRouter()
		const order: string[] = []

		router.sqs({ sequential: true }, async (c) => {
			const id = c.sqs.messageId
			order.push(`start-${id}`)
			await new Promise((r) => setTimeout(r, id === 'msg-1' ? 15 : 5))
			order.push(`end-${id}`)
		})

		const event = createSQSBatchEvent('any-queue', [
			{ messageId: 'msg-1', body: {} },
			{ messageId: 'msg-2', body: {} },
		])
		await router.handler()(event, mockLambdaContext)

		expect(order).toEqual([
			'start-msg-1',
			'end-msg-1',
			'start-msg-2',
			'end-msg-2',
		])
	})

	test('sequential stops on failure and marks remaining as failures', async () => {
		const router = new EventRouter()
		const processed: string[] = []

		router.sqs({ queueName: 'fifo-queue', sequential: true }, (c) => {
			const id = c.sqs.messageId
			if (id === 'msg-2') {
				throw new Error('Intentional failure')
			}
			processed.push(id)
		})

		const event = createSQSBatchEvent('fifo-queue', [
			{ messageId: 'msg-1', body: {} },
			{ messageId: 'msg-2', body: {} },
			{ messageId: 'msg-3', body: {} },
			{ messageId: 'msg-4', body: {} },
		])
		const result = await router.handler()(event, mockLambdaContext)

		// Only msg-1 was processed before failure
		expect(processed).toEqual(['msg-1'])

		// msg-2 (failed) and msg-3, msg-4 (remaining) are all marked as failures
		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'msg-2' },
				{ itemIdentifier: 'msg-3' },
				{ itemIdentifier: 'msg-4' },
			],
		})
	})
})
