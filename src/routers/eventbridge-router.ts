import type { EventBridgeEvent, LambdaContext } from '../aws-types.ts'
import {
	createErrorContext,
	createEventBridgeContext,
	createNotFoundContext,
} from '../contexts.ts'
import type {
	ErrorHandler,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	NotFoundHandler,
	Route,
} from '../types.ts'

export class EventBridgeRouter {
	private routes: Route<
		EventBridgeHandler,
		EventBridgeMatchOptions | undefined
	>[] = []

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
	): Promise<void> {
		const source = event.source
		const detailType = event['detail-type']
		const handler = this.matchHandler(source, detailType)

		if (!handler) {
			if (notFoundHandler) {
				const ctx = createNotFoundContext('event', event, lambdaContext)
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const ctx = createEventBridgeContext(event, lambdaContext)
			await handler(ctx)
		} catch (error) {
			if (errorHandler) {
				const ctx = createErrorContext('event', event, lambdaContext)
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
