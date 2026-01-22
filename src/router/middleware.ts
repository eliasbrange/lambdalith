import type { Middleware } from '../types.ts'

/**
 * Compose middleware into an onion-style execution chain.
 * If middleware doesn't call next(), processing auto-continues.
 *
 * Execution order:
 * - mw1 before -> mw2 before -> handler -> mw2 after -> mw1 after
 */
export function composeMiddleware<C>(
	middlewares: Middleware<C>[],
	handler: (c: C) => void | Promise<void>,
): (c: C) => Promise<void> {
	return async (c: C): Promise<void> => {
		let currentIndex = -1

		const dispatch = async (index: number): Promise<void> => {
			// Prevent calling next() multiple times
			if (index <= currentIndex) {
				throw new Error('next() called multiple times')
			}
			currentIndex = index

			if (index < middlewares.length) {
				const mw = middlewares[index]
				if (!mw) return dispatch(index + 1)

				const nextCalled = { value: false }
				const next = async (): Promise<void> => {
					nextCalled.value = true
					await dispatch(index + 1)
				}

				await mw(c, next)

				// Auto-continue if next() wasn't called
				if (!nextCalled.value) {
					await dispatch(index + 1)
				}
			} else {
				// End of middleware chain, call handler
				await handler(c)
			}
		}

		await dispatch(0)
	}
}
