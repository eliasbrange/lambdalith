import type { EventBridgeEvent, LambdaContext } from '../aws-types.ts'
import { createEventBridgeContext } from '../contexts.ts'
import type {
	ErrorHandler,
	EventBridgeContext,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	EventBridgeRoute,
	Middleware,
	NotFoundHandler,
} from '../types.ts'
import { composeMiddleware } from './middleware.ts'

export class EventBridgeRouter {
	private routes: EventBridgeRoute[] = []

	add(handler: EventBridgeHandler): void
	add(options: EventBridgeMatchOptions, handler: EventBridgeHandler): void
	add(
		optionsOrHandler: EventBridgeMatchOptions | EventBridgeHandler,
		handler?: EventBridgeHandler,
	): void {
		if (typeof optionsOrHandler === 'function') {
			this.routes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.routes.push({ options: optionsOrHandler, handler })
		}
	}

	async handle(
		event: EventBridgeEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware<EventBridgeContext>[] = [],
	): Promise<void> {
		const source = event.source
		const detailType = event['detail-type']
		const handler = this.matchHandler(source, detailType)

		const ctx = createEventBridgeContext(event, lambdaContext)

		if (!handler) {
			if (notFoundHandler) {
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const composed = composeMiddleware(middleware, handler)
			await composed(ctx)
		} catch (error) {
			if (errorHandler) {
				await errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private matchHandler(
		source: string,
		detailType: string,
	): EventBridgeHandler | undefined {
		for (const route of this.routes) {
			if (!route.options) {
				return route.handler
			}
			const sourceMatch =
				!route.options.source || route.options.source === source
			const detailTypeMatch =
				!route.options.detailType || route.options.detailType === detailType
			if (sourceMatch && detailTypeMatch) {
				return route.handler
			}
		}
		return undefined
	}
}
