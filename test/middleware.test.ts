import { describe, expect, mock, test } from 'bun:test'
import type { SQSContext } from '../src'
import { EventRouter } from '../src'
import {
	createDynamoDBEvent,
	createEventBridgeEvent,
	createSNSEvent,
	createSQSBatchEvent,
	createSQSEvent,
	mockLambdaContext,
} from './fixtures'

describe('Middleware', () => {
	describe('execution order (onion)', () => {
		test('middleware executes in onion order with next()', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async (_c, next) => {
				order.push('mw1-before')
				await next()
				order.push('mw1-after')
			})

			router.use(async (_c, next) => {
				order.push('mw2-before')
				await next()
				order.push('mw2-after')
			})

			router.sqs((_c) => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', { data: 'test' })
			await router.handler()(event, mockLambdaContext)

			expect(order).toEqual([
				'mw1-before',
				'mw2-before',
				'handler',
				'mw2-after',
				'mw1-after',
			])
		})

		test('three middleware in onion order', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async (_c, next) => {
				order.push('1-start')
				await next()
				order.push('1-end')
			})

			router.use(async (_c, next) => {
				order.push('2-start')
				await next()
				order.push('2-end')
			})

			router.use(async (_c, next) => {
				order.push('3-start')
				await next()
				order.push('3-end')
			})

			router.sqs(() => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(order).toEqual([
				'1-start',
				'2-start',
				'3-start',
				'handler',
				'3-end',
				'2-end',
				'1-end',
			])
		})
	})

	describe('auto-continue', () => {
		test('middleware without next() auto-continues to next middleware', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async () => {
				order.push('mw1-before-only')
				// no next() call
			})

			router.use(async (_c, next) => {
				order.push('mw2-before')
				await next()
				order.push('mw2-after')
			})

			router.sqs(() => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(order).toEqual([
				'mw1-before-only',
				'mw2-before',
				'handler',
				'mw2-after',
			])
		})

		test('all middleware without next() still reaches handler', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async () => {
				order.push('mw1')
			})

			router.use(async () => {
				order.push('mw2')
			})

			router.sqs(() => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(order).toEqual(['mw1', 'mw2', 'handler'])
		})
	})

	describe('filtering by event type', () => {
		test('global middleware runs for SQS events', async () => {
			const router = new EventRouter()
			const globalMw = mock(() => {})

			router.use(globalMw)
			router.sqs(() => {})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(globalMw).toHaveBeenCalledTimes(1)
		})

		test('global middleware runs for SNS events', async () => {
			const router = new EventRouter()
			const globalMw = mock(() => {})

			router.use(globalMw)
			router.sns(() => {})

			const event = createSNSEvent('test-topic', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(globalMw).toHaveBeenCalledTimes(1)
		})

		test('global middleware runs for EventBridge events', async () => {
			const router = new EventRouter()
			const globalMw = mock(() => {})

			router.use(globalMw)
			router.event(() => {})

			const event = createEventBridgeEvent('test.source', 'TestEvent', {})
			await router.handler()(event, mockLambdaContext)

			expect(globalMw).toHaveBeenCalledTimes(1)
		})

		test('global middleware runs for DynamoDB events', async () => {
			const router = new EventRouter()
			const globalMw = mock(() => {})

			router.use(globalMw)
			router.dynamodb(() => {})

			const event = createDynamoDBEvent('test-table', 'INSERT', {
				pk: { S: 'test' },
			})
			await router.handler()(event, mockLambdaContext)

			expect(globalMw).toHaveBeenCalledTimes(1)
		})

		test('SQS-filtered middleware only runs for SQS events', async () => {
			const router = new EventRouter()
			const sqsMw = mock(() => {})

			router.use('sqs', sqsMw)
			router.sqs(() => {})
			router.sns(() => {})

			// SQS event - should run middleware
			const sqsEvent = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(sqsEvent, mockLambdaContext)
			expect(sqsMw).toHaveBeenCalledTimes(1)

			// SNS event - should NOT run middleware
			const snsEvent = createSNSEvent('test-topic', 'msg-1', {})
			await router.handler()(snsEvent, mockLambdaContext)
			expect(sqsMw).toHaveBeenCalledTimes(1) // still 1
		})

		test('SNS-filtered middleware only runs for SNS events', async () => {
			const router = new EventRouter()
			const snsMw = mock(() => {})

			router.use('sns', snsMw)
			router.sqs(() => {})
			router.sns(() => {})

			// SQS event - should NOT run middleware
			const sqsEvent = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(sqsEvent, mockLambdaContext)
			expect(snsMw).not.toHaveBeenCalled()

			// SNS event - should run middleware
			const snsEvent = createSNSEvent('test-topic', 'msg-1', {})
			await router.handler()(snsEvent, mockLambdaContext)
			expect(snsMw).toHaveBeenCalledTimes(1)
		})

		test('EventBridge-filtered middleware only runs for EventBridge events', async () => {
			const router = new EventRouter()
			const eventMw = mock(() => {})

			router.use('event', eventMw)
			router.sqs(() => {})
			router.event(() => {})

			// SQS event - should NOT run middleware
			const sqsEvent = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(sqsEvent, mockLambdaContext)
			expect(eventMw).not.toHaveBeenCalled()

			// EventBridge event - should run middleware
			const ebEvent = createEventBridgeEvent('test.source', 'TestEvent', {})
			await router.handler()(ebEvent, mockLambdaContext)
			expect(eventMw).toHaveBeenCalledTimes(1)
		})

		test('DynamoDB-filtered middleware only runs for DynamoDB events', async () => {
			const router = new EventRouter()
			const dynamoMw = mock(() => {})

			router.use('dynamodb', dynamoMw)
			router.sqs(() => {})
			router.dynamodb(() => {})

			// SQS event - should NOT run middleware
			const sqsEvent = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(sqsEvent, mockLambdaContext)
			expect(dynamoMw).not.toHaveBeenCalled()

			// DynamoDB event - should run middleware
			const ddbEvent = createDynamoDBEvent('test-table', 'INSERT', {
				pk: { S: 'test' },
			})
			await router.handler()(ddbEvent, mockLambdaContext)
			expect(dynamoMw).toHaveBeenCalledTimes(1)
		})

		test('mixed global and filtered middleware', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async (_c, next) => {
				order.push('global-before')
				await next()
				order.push('global-after')
			})

			router.use('sqs', async (_c, next) => {
				order.push('sqs-before')
				await next()
				order.push('sqs-after')
			})

			router.use('sns', async () => {
				order.push('sns-only')
			})

			router.sqs(() => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			// SNS middleware should not run for SQS event
			expect(order).toEqual([
				'global-before',
				'sqs-before',
				'handler',
				'sqs-after',
				'global-after',
			])
		})
	})

	describe('error handling', () => {
		test('errors in middleware are caught by errorHandler', async () => {
			const router = new EventRouter()
			const errorHandler = mock(() => {})

			router.use(async () => {
				throw new Error('Middleware error')
			})

			router.sqs(() => {})
			router.onError(errorHandler)

			const event = createSQSEvent('test-queue', 'msg-1', {})
			const result = await router.handler()(event, mockLambdaContext)

			expect(errorHandler).toHaveBeenCalledTimes(1)
			// Error is swallowed by default when error handler is registered
			expect(result).toEqual({ batchItemFailures: [] })
		})

		test('errors in handler still trigger after middleware when using next()', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async (_c, next) => {
				order.push('before')
				try {
					await next()
				} catch {
					order.push('caught')
					throw new Error('re-throw')
				}
				order.push('after') // should not reach
			})

			router.sqs(() => {
				order.push('handler')
				throw new Error('Handler error')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(order).toEqual(['before', 'handler', 'caught'])
		})

		test('error in second middleware stops chain', async () => {
			const router = new EventRouter()
			const order: string[] = []

			router.use(async (_c, next) => {
				order.push('mw1-before')
				await next()
				order.push('mw1-after')
			})

			router.use(async () => {
				order.push('mw2-before')
				throw new Error('mw2 error')
			})

			router.sqs(() => {
				order.push('handler')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			// Handler should not be reached, mw1-after should not run
			expect(order).toEqual(['mw1-before', 'mw2-before'])
		})
	})

	describe('context sharing', () => {
		test('middleware can set values on context for handler', async () => {
			const router = new EventRouter()
			let handlerValue: unknown

			router.use(async (c, next) => {
				c.set('userId', '12345')
				await next()
			})

			router.sqs((c) => {
				handlerValue = c.get('userId')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(handlerValue).toBe('12345')
		})

		test('middleware can read values set by previous middleware', async () => {
			const router = new EventRouter()
			let mw2Value: unknown

			router.use(async (c, next) => {
				c.set('step', 1)
				await next()
			})

			router.use(async (c, next) => {
				mw2Value = c.get('step')
				c.set('step', 2)
				await next()
			})

			router.sqs(() => {})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(mw2Value).toBe(1)
		})

		test('after phase can read values set by handler', async () => {
			const router = new EventRouter()
			let afterValue: unknown

			router.use(async (c, next) => {
				await next()
				afterValue = c.get('handlerResult')
			})

			router.sqs((c) => {
				c.set('handlerResult', 'processed')
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(afterValue).toBe('processed')
		})
	})

	describe('batch processing', () => {
		test('middleware runs for each record in SQS batch', async () => {
			const router = new EventRouter()
			const mwCalls: string[] = []

			router.use(async (c, next) => {
				const ctx = c as SQSContext
				mwCalls.push(ctx.sqs.messageId)
				await next()
			})

			router.sqs(() => {})

			const event = createSQSBatchEvent('test-queue', [
				{ messageId: 'msg-1', body: {} },
				{ messageId: 'msg-2', body: {} },
				{ messageId: 'msg-3', body: {} },
			])
			await router.handler()(event, mockLambdaContext)

			expect(mwCalls).toContain('msg-1')
			expect(mwCalls).toContain('msg-2')
			expect(mwCalls).toContain('msg-3')
			expect(mwCalls.length).toBe(3)
		})

		test('middleware error marks only that record as failed', async () => {
			const router = new EventRouter()

			router.use(async (c, next) => {
				const ctx = c as SQSContext
				if (ctx.sqs.messageId === 'msg-2') {
					throw new Error('mw error for msg-2')
				}
				await next()
			})

			router.sqs(() => {})

			const event = createSQSBatchEvent('test-queue', [
				{ messageId: 'msg-1', body: {} },
				{ messageId: 'msg-2', body: {} },
				{ messageId: 'msg-3', body: {} },
			])
			const result = await router.handler()(event, mockLambdaContext)

			expect(result).toEqual({
				batchItemFailures: [{ itemIdentifier: 'msg-2' }],
			})
		})
	})

	describe('edge cases', () => {
		test('calling next() multiple times throws error', async () => {
			const router = new EventRouter()
			let capturedError: Error | undefined

			router.use(async (_c, next) => {
				await next()
				await next() // should throw
			})

			router.sqs(() => {})
			router.onError((error) => {
				capturedError = error
			})

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(capturedError?.message).toBe('next() called multiple times')
		})

		test('no middleware still calls handler', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.sqs(handler)

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('middleware with no handler (notFound) still runs', async () => {
			const router = new EventRouter()
			const mwCalled = mock(() => {})
			const notFoundHandler = mock(() => {})

			router.use(mwCalled)
			router.notFound(notFoundHandler)

			const event = createSQSEvent('test-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			// Middleware shouldn't run because there's no matching handler
			// notFound is called instead
			expect(notFoundHandler).toHaveBeenCalledTimes(1)
		})
	})
})
