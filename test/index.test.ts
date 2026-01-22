import { describe, expect, test } from 'bun:test'
import { EventRouter } from '../src'
import { mockLambdaContext } from './fixtures'

describe('EventRouter', () => {
	describe('Event detection', () => {
		test('throws on unknown event types', async () => {
			const router = new EventRouter()

			const unknownEvent = { foo: 'bar' }

			expect(router.handler()(unknownEvent, mockLambdaContext)).rejects.toThrow(
				'Unknown event type',
			)
		})
	})
})
