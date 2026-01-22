import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import {
	createDynamoDBBatchEvent,
	createDynamoDBEvent,
	mockLambdaContext,
} from './fixtures'

describe('DynamoDB Streams routing', () => {
	test('routes to table match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb('orders-table', handler)

		const event = createDynamoDBEvent(
			'orders-table',
			'INSERT',
			{ pk: { S: 'order-123' } },
			{ pk: { S: 'order-123' }, status: { S: 'pending' } },
		)
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes to catch-all (any table)', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb(handler)

		const event = createDynamoDBEvent('any-table', 'INSERT', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('handles all event types for matched table', async () => {
		const router = new EventRouter()
		const events: string[] = []

		router.dynamodb('orders-table', (c) => {
			events.push(c.dynamodb.eventName)
		})

		const insertEvent = createDynamoDBEvent('orders-table', 'INSERT', {
			pk: { S: 'order-123' },
		})
		const modifyEvent = createDynamoDBEvent('orders-table', 'MODIFY', {
			pk: { S: 'order-123' },
		})
		const removeEvent = createDynamoDBEvent('orders-table', 'REMOVE', {
			pk: { S: 'order-123' },
		})

		await router.handler()(insertEvent, mockLambdaContext)
		await router.handler()(modifyEvent, mockLambdaContext)
		await router.handler()(removeEvent, mockLambdaContext)

		expect(events).toEqual(['INSERT', 'MODIFY', 'REMOVE'])
	})

	test('unmarshalls DynamoDB data correctly', async () => {
		const router = new EventRouter()
		let capturedKeys: unknown

		router.dynamodb('orders-table', (c) => {
			capturedKeys = c.dynamodb.keys
		})

		const event = createDynamoDBEvent('orders-table', 'INSERT', {
			pk: { S: 'order-123' },
			sk: { N: '42' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(capturedKeys).toEqual({
			pk: 'order-123',
			sk: 42,
		})
	})

	test('sequential: true processes records in order', async () => {
		const router = new EventRouter()
		const order: string[] = []

		router.dynamodb(
			'orders-table',
			async (c) => {
				const id = c.dynamodb.eventId
				order.push(`start-${id}`)
				await new Promise((r) => setTimeout(r, id === 'evt-1' ? 20 : 5))
				order.push(`end-${id}`)
			},
			{ sequential: true },
		)

		const event = createDynamoDBBatchEvent('orders-table', 'INSERT', [
			{ eventId: 'evt-1', keys: { pk: { S: '1' } } },
			{ eventId: 'evt-2', keys: { pk: { S: '2' } } },
			{ eventId: 'evt-3', keys: { pk: { S: '3' } } },
		])
		await router.handler()(event, mockLambdaContext)

		expect(order).toEqual([
			'start-evt-1',
			'end-evt-1',
			'start-evt-2',
			'end-evt-2',
			'start-evt-3',
			'end-evt-3',
		])
	})

	test('sequential stops on failure and marks remaining as failures', async () => {
		const router = new EventRouter()
		const processed: string[] = []

		router.dynamodb(
			'orders-table',
			(c) => {
				const id = c.dynamodb.eventId
				if (id === 'evt-2') {
					throw new Error('Intentional failure')
				}
				processed.push(id)
			},
			{ sequential: true },
		)

		const event = createDynamoDBBatchEvent('orders-table', 'INSERT', [
			{ eventId: 'evt-1', keys: { pk: { S: '1' } } },
			{ eventId: 'evt-2', keys: { pk: { S: '2' } } },
			{ eventId: 'evt-3', keys: { pk: { S: '3' } } },
			{ eventId: 'evt-4', keys: { pk: { S: '4' } } },
		])
		const result = await router.handler()(event, mockLambdaContext)

		// Only evt-1 was processed before failure
		expect(processed).toEqual(['evt-1'])

		// evt-2 (failed) and evt-3, evt-4 (remaining) are all marked as failures
		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'evt-2' },
				{ itemIdentifier: 'evt-3' },
				{ itemIdentifier: 'evt-4' },
			],
		})
	})

	test('routes to error handler when handler throws', async () => {
		const router = new EventRouter()
		const errorHandler = mock(() => {})

		router.dynamodb(() => {
			throw new Error('Test error')
		})
		router.onError(errorHandler)

		const event = createDynamoDBEvent('any-table', 'INSERT', {})
		const result = await router.handler()(event, mockLambdaContext)

		expect(errorHandler).toHaveBeenCalledTimes(1)
		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: 'test-event-id' }],
		})
	})

	test('routes to not found handler when no handler is found', async () => {
		const router = new EventRouter()
		const notFoundHandler = mock(() => {})

		router.notFound(notFoundHandler)

		const event = createDynamoDBEvent('any-table', 'INSERT', {})
		await router.handler()(event, mockLambdaContext)

		expect(notFoundHandler).toHaveBeenCalledTimes(1)
	})
})
