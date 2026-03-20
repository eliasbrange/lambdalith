import type { Middleware } from '../types.ts'

/**
 * Compose middleware into an onion-style execution chain.
 * Middleware must call next() to continue to the next middleware/handler.
 * Returning without calling next() short-circuits successfully.
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

				const next = async (): Promise<void> => {
					await dispatch(index + 1)
				}

				await mw(c, next)
			} else {
				// End of middleware chain, call handler
				await handler(c)
			}
		}

		await dispatch(0)
	}
}
