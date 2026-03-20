import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createEventBridgeEvent } from './fixtures'

describe('router.test()', () => {
	test('send.sqs invokes the matched handler', async () => {
		const router = new EventRouter()
		let capturedBody: unknown

		router.sqs('orders-queue', (c) => {
			capturedBody = c.sqs.body
		})

		await router.test().send.sqs({
			queue: 'orders-queue',
			body: { orderId: '123' },
		})

		expect(capturedBody).toEqual({ orderId: '123' })
	})

	test('send.sns invokes the matched handler', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.sns('notifications', handler)

		await router.test().send.sns({
			topic: 'notifications',
			body: { alert: 'test' },
		})

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('send.event invokes the matched handler', async () => {
		const router = new EventRouter()
		let capturedDetail: unknown

		router.event(
			{ source: 'orders.service', detailType: 'OrderCreated' },
			(c) => {
				capturedDetail = c.event.detail
			},
		)

		await router.test().send.event({
			source: 'orders.service',
			detailType: 'OrderCreated',
			detail: { orderId: '123' },
		})

		expect(capturedDetail).toEqual({ orderId: '123' })
	})

	test('send.dynamodb invokes the matched handler', async () => {
		const router = new EventRouter()
		let capturedKeys: unknown

		router.dynamodb('orders-table', (c) => {
			capturedKeys = c.dynamodb.keys
		})

		await router.test().send.dynamodb({
			table: 'orders-table',
			eventName: 'INSERT',
			keys: { pk: { S: 'order-123' }, version: { N: '2' } },
		})

		expect(capturedKeys).toEqual({
			pk: 'order-123',
			version: 2,
		})
	})

	test('send.sqs.batch preserves batch failure behavior', async () => {
		const router = new EventRouter()

		router.sqs('orders-queue', (c) => {
			if (c.sqs.messageId === 'msg-2') {
				throw new Error('fail')
			}
		})

		const result = await router.test().send.sqs.batch({
			queue: 'orders-queue',
			messages: [
				{ messageId: 'msg-1', body: {} },
				{ messageId: 'msg-2', body: {} },
				{ messageId: 'msg-3', body: {} },
			],
		})

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: 'msg-2' }],
		})
	})

	test('send.dynamodb.batch preserves sequential failure behavior', async () => {
		const router = new EventRouter()
		const processed: string[] = []

		router.dynamodb(
			'orders-table',
			(c) => {
				if (c.dynamodb.eventId === 'evt-2') {
					throw new Error('fail')
				}
				processed.push(c.dynamodb.eventId)
			},
			{ sequential: true },
		)

		const result = await router.test().send.dynamodb.batch({
			table: 'orders-table',
			eventName: 'INSERT',
			records: [
				{ eventId: 'evt-1', keys: { pk: { S: '1' } } },
				{ eventId: 'evt-2', keys: { pk: { S: '2' } } },
				{ eventId: 'evt-3', keys: { pk: { S: '3' } } },
			],
		})

		expect(processed).toEqual(['evt-1'])
		expect(result).toEqual({
			batchItemFailures: [
				{ itemIdentifier: 'evt-2' },
				{ itemIdentifier: 'evt-3' },
			],
		})
	})

	test('runs middleware through the normal dispatch path', async () => {
		const router = new EventRouter()
		const order: string[] = []

		router.use(async (_c, next) => {
			order.push('before')
			await next()
			order.push('after')
		})

		router.sqs(() => {
			order.push('handler')
		})

		await router.test().send.sqs({
			queue: 'orders-queue',
			body: {},
		})

		expect(order).toEqual(['before', 'handler', 'after'])
	})

	test('middleware can short-circuit through the test client', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.use(async () => {
			return
		})
		router.sqs(handler)

		const result = await router.test().send.sqs({
			queue: 'orders-queue',
			body: {},
		})

		expect(handler).not.toHaveBeenCalled()
		expect(result).toEqual({ batchItemFailures: [] })
	})

	test('triggers notFound for unmatched events', async () => {
		const router = new EventRouter()
		const notFoundHandler = mock(() => {})

		router.notFound(notFoundHandler)

		await router.test().send.sqs({
			queue: 'missing-queue',
			body: {},
		})

		expect(notFoundHandler).toHaveBeenCalledTimes(1)
	})

	test('preserves onError swallow and rethrow behavior', async () => {
		const swallowRouter = new EventRouter()
		const swallowHandler = mock(() => {})

		swallowRouter.sqs(() => {
			throw new Error('swallow')
		})
		swallowRouter.onError(swallowHandler)

		const swallowed = await swallowRouter.test().send.sqs({
			queue: 'orders-queue',
			body: {},
		})

		expect(swallowHandler).toHaveBeenCalledTimes(1)
		expect(swallowed).toEqual({ batchItemFailures: [] })

		const rethrowRouter = new EventRouter()
		const rethrowHandler = mock((error: Error) => {
			throw error
		})

		rethrowRouter.sqs(() => {
			throw new Error('rethrow')
		})
		rethrowRouter.onError(rethrowHandler)

		const rethrown = await rethrowRouter.test().send.sqs({
			queue: 'orders-queue',
			body: {},
		})

		expect(rethrowHandler).toHaveBeenCalledTimes(1)
		expect(rethrown).toEqual({
			batchItemFailures: [{ itemIdentifier: 'test-message-1' }],
		})
	})

	test('supports default and per-send Lambda context overrides', async () => {
		const router = new EventRouter()
		let captured: { functionName: string; awsRequestId: string } | undefined

		router.sqs((c) => {
			captured = {
				functionName: c.lambda.functionName,
				awsRequestId: c.lambda.awsRequestId,
			}
		})

		const testRouter = router.test({
			context: {
				functionName: 'orders-test',
				awsRequestId: 'default-request-id',
			},
		})

		await testRouter.send.sqs(
			{
				queue: 'orders-queue',
				body: {},
			},
			{
				context: {
					awsRequestId: 'override-request-id',
				},
			},
		)

		expect(captured).toEqual({
			functionName: 'orders-test',
			awsRequestId: 'override-request-id',
		})
	})

	test('send.raw dispatches the provided event unchanged', async () => {
		const router = new EventRouter()
		let capturedRaw: unknown
		const event = createEventBridgeEvent('orders.service', 'OrderCreated', {
			orderId: '123',
		})

		router.event((c) => {
			capturedRaw = c.raw
		})

		await router.test().send.raw(event)

		expect(capturedRaw).toBe(event)
	})
})
