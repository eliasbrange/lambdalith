import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import {
	createDynamoDBBatchEvent,
	createDynamoDBEvent,
	mockLambdaContext,
} from './fixtures'

describe('DynamoDB Streams routing', () => {
	test('routes to insert with table match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb({ tableName: 'orders-table', eventName: 'INSERT' }, handler)

		const event = createDynamoDBEvent(
			'orders-table',
			'INSERT',
			{ pk: { S: 'order-123' } },
			{ pk: { S: 'order-123' }, status: { S: 'pending' } },
		)
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes to insert catch-all (any table)', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb({ eventName: 'INSERT' }, handler)

		const event = createDynamoDBEvent('any-table', 'INSERT', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes to table-only match (all event names)', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb({ tableName: 'orders-table' }, handler)

		const event = createDynamoDBEvent('orders-table', 'MODIFY', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes modify events correctly', async () => {
		const router = new EventRouter()
		const insertHandler = mock(() => {})
		const modifyHandler = mock(() => {})

		router.dynamodb({ eventName: 'INSERT' }, insertHandler)
		router.dynamodb({ eventName: 'MODIFY' }, modifyHandler)

		const event = createDynamoDBEvent('orders-table', 'MODIFY', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(modifyHandler).toHaveBeenCalledTimes(1)
		expect(insertHandler).not.toHaveBeenCalled()
	})

	test('routes remove events correctly', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb({ tableName: 'orders-table', eventName: 'REMOVE' }, handler)

		const event = createDynamoDBEvent('orders-table', 'REMOVE', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('unmarshalls DynamoDB data correctly', async () => {
		const router = new EventRouter()
		let capturedKeys: unknown

		router.dynamodb({ tableName: 'orders-table', eventName: 'INSERT' }, (c) => {
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
			{ tableName: 'orders-table', eventName: 'INSERT', sequential: true },
			async (c) => {
				const id = c.dynamodb.eventId
				order.push(`start-${id}`)
				await new Promise((r) => setTimeout(r, id === 'evt-1' ? 20 : 5))
				order.push(`end-${id}`)
			},
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
			{ tableName: 'orders-table', eventName: 'INSERT', sequential: true },
			(c) => {
				const id = c.dynamodb.eventId
				if (id === 'evt-2') {
					throw new Error('Intentional failure')
				}
				processed.push(id)
			},
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
})
