import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createDynamoDBEvent, mockLambdaContext } from './fixtures'

describe('DynamoDB Streams routing', () => {
	test('routes to insert with table match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.dynamodb.insert({ tableName: 'orders-table' }, handler)

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

		router.dynamodb.insert(handler)

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

		router.dynamodb.insert(insertHandler)
		router.dynamodb.modify(modifyHandler)

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

		router.dynamodb.remove({ tableName: 'orders-table' }, handler)

		const event = createDynamoDBEvent('orders-table', 'REMOVE', {
			pk: { S: 'order-123' },
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('unmarshalls DynamoDB data correctly', async () => {
		const router = new EventRouter()
		let capturedKeys: unknown

		router.dynamodb.insert({ tableName: 'orders-table' }, (c) => {
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
})
