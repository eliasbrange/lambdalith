import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createSNSEvent, mockLambdaContext } from './fixtures'

describe('SNS routing', () => {
	test('routes to exact topic match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.sns('notifications', handler)

		const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('provides correct context properties', async () => {
		const router = new EventRouter()
		let capturedTopic: string | undefined

		router.sns('notifications', (c) => {
			capturedTopic = c.sns.topic
		})

		const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
		await router.handler()(event, mockLambdaContext)

		expect(capturedTopic).toBe('notifications')
	})

	test('routes to error handler when handler throws', async () => {
		const router = new EventRouter()
		const errorHandler = mock(() => {})

		router.sns(() => {
			throw new Error('Test error')
		})
		router.onError(errorHandler)

		const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
		expect(router.handler()(event, mockLambdaContext)).rejects.toThrow(
			'Test error',
		)

		expect(errorHandler).toHaveBeenCalledTimes(1)
	})

	test('routes to not found handler when no handler is found', async () => {
		const router = new EventRouter()
		const notFoundHandler = mock(() => {})

		router.notFound(notFoundHandler)

		const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
		await router.handler()(event, mockLambdaContext)

		expect(notFoundHandler).toHaveBeenCalledTimes(1)
	})
})
