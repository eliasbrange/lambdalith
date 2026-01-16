import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createSQSEvent, mockLambdaContext } from './fixtures'

describe('EventRouter', () => {
	describe('Error handling', () => {
		test('calls notFound handler when no route matches', async () => {
			const router = new EventRouter()
			const notFoundHandler = mock(() => {})

			router.notFound(notFoundHandler)

			const event = createSQSEvent('unknown-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(notFoundHandler).toHaveBeenCalledTimes(1)
		})

		test('calls onError handler when handler throws', async () => {
			const router = new EventRouter()
			const errorHandler = mock(() => {})

			router.sqs({ queueName: 'orders-queue' }, () => {
				throw new Error('Handler error')
			})
			router.onError(errorHandler)

			const event = createSQSEvent('orders-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(errorHandler).toHaveBeenCalledTimes(1)
		})

		test('onError receives the error object', async () => {
			const router = new EventRouter()
			let capturedError: Error | undefined

			router.sqs({ queueName: 'orders-queue' }, () => {
				throw new Error('Test error message')
			})
			router.onError((err) => {
				capturedError = err
			})

			const event = createSQSEvent('orders-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(capturedError?.message).toBe('Test error message')
		})
	})

	describe('Event detection', () => {
		test('handles unknown event types gracefully', async () => {
			const router = new EventRouter()
			const notFoundHandler = mock(() => {})

			router.notFound(notFoundHandler)

			const unknownEvent = { foo: 'bar' }
			await router.handler()(unknownEvent, mockLambdaContext)

			expect(notFoundHandler).toHaveBeenCalledTimes(1)
		})
	})
})
