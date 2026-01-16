import { describe, expect, mock, test } from 'bun:test'
import { EventRouter } from '../src'
import { createEventBridgeEvent, mockLambdaContext } from './fixtures'

describe('EventBridge routing', () => {
	test('routes to exact source/detailType match', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.event({ source: 'myapp.users', detailType: 'UserCreated' }, handler)

		const event = createEventBridgeEvent('myapp.users', 'UserCreated', {
			userId: '123',
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('routes to source-only match (all detail types)', async () => {
		const router = new EventRouter()
		const handler = mock(() => {})

		router.event({ source: 'myapp.users' }, handler)

		const event = createEventBridgeEvent('myapp.users', 'UserDeleted', {
			userId: '123',
		})
		await router.handler()(event, mockLambdaContext)

		expect(handler).toHaveBeenCalledTimes(1)
	})

	test('first match wins (specific before source-only)', async () => {
		const router = new EventRouter()
		const exactHandler = mock(() => {})
		const sourceOnlyHandler = mock(() => {})

		router.event(
			{ source: 'myapp.users', detailType: 'UserCreated' },
			exactHandler,
		)
		router.event({ source: 'myapp.users' }, sourceOnlyHandler)

		const event = createEventBridgeEvent('myapp.users', 'UserCreated', {})
		await router.handler()(event, mockLambdaContext)

		expect(exactHandler).toHaveBeenCalledTimes(1)
		expect(sourceOnlyHandler).not.toHaveBeenCalled()
	})

	test('first match wins (source-only before specific)', async () => {
		const router = new EventRouter()
		const exactHandler = mock(() => {})
		const sourceOnlyHandler = mock(() => {})

		router.event({ source: 'myapp.users' }, sourceOnlyHandler)
		router.event(
			{ source: 'myapp.users', detailType: 'UserCreated' },
			exactHandler,
		)

		const event = createEventBridgeEvent('myapp.users', 'UserCreated', {})
		await router.handler()(event, mockLambdaContext)

		expect(sourceOnlyHandler).toHaveBeenCalledTimes(1)
		expect(exactHandler).not.toHaveBeenCalled()
	})

	test('provides correct context properties', async () => {
		const router = new EventRouter()
		let capturedContext: unknown

		router.event({ source: 'myapp.users', detailType: 'UserCreated' }, (c) => {
			capturedContext = {
				source: c.event.source,
				detailType: c.event.detailType,
				detail: c.event.detail,
			}
		})

		const event = createEventBridgeEvent('myapp.users', 'UserCreated', {
			userId: '123',
		})
		await router.handler()(event, mockLambdaContext)

		expect(capturedContext).toEqual({
			source: 'myapp.users',
			detailType: 'UserCreated',
			detail: { userId: '123' },
		})
	})
})
