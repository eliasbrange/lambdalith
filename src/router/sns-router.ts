import type { LambdaContext, SNSEvent } from '../aws-types.ts'
import { createSNSContext } from '../contexts.ts'
import type {
	ErrorHandler,
	Middleware,
	NotFoundHandler,
	SNSContext,
	SNSHandler,
	SNSRoute,
} from '../types.ts'
import { parseTopicName } from '../utils.ts'
import { composeMiddleware } from './middleware.ts'

export class SnsRouter {
	private routes: SNSRoute[] = []

	add(handler: SNSHandler): void
	add(topicName: string, handler: SNSHandler): void
	add(topicNameOrHandler: string | SNSHandler, handler?: SNSHandler): void {
		if (typeof topicNameOrHandler === 'function') {
			this.routes.push({ matcher: undefined, handler: topicNameOrHandler })
		} else if (handler) {
			this.routes.push({ matcher: topicNameOrHandler, handler })
		}
	}

	async handle(
		event: SNSEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware<SNSContext>[] = [],
	): Promise<void> {
		// SNS notifications always contain exactly one message
		const record = event.Records[0]
		if (!record) return

		const topic = parseTopicName(record.Sns.TopicArn)
		const route = this.matchRoute(topic)

		const ctx = createSNSContext(record, lambdaContext)

		if (!route) {
			if (notFoundHandler) {
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const composed = composeMiddleware(middleware, route.handler)
			await composed(ctx)
		} catch (error) {
			if (errorHandler) {
				await errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private matchRoute(topic: string): SNSRoute | undefined {
		for (const route of this.routes) {
			if (!route.matcher || route.matcher === topic) {
				return route
			}
		}
		return undefined
	}
}
