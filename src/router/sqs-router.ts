import type {
	BatchResponse,
	LambdaContext,
	SQSEvent,
	SQSRecord,
} from '../aws-types.ts'
import {
	createErrorContext,
	createNotFoundContext,
	createSQSContext,
} from '../contexts.ts'
import type {
	ErrorHandler,
	Middleware,
	NotFoundHandler,
	SQSContext,
	SQSHandler,
	SQSOptions,
	SQSRoute,
} from '../types.ts'
import { parseQueueName } from '../utils.ts'
import { BatchRouter } from './batch-router.ts'
import { composeMiddleware } from './middleware.ts'

export class SqsRouter extends BatchRouter<SQSRecord, SQSRoute> {
	add(handler: SQSHandler): void
	add(handler: SQSHandler, options: SQSOptions): void
	add(queueName: string, handler: SQSHandler): void
	add(queueName: string, handler: SQSHandler, options: SQSOptions): void
	add(
		queueNameOrHandler: string | SQSHandler,
		handlerOrOptions?: SQSHandler | SQSOptions,
		options?: SQSOptions,
	): void {
		if (typeof queueNameOrHandler === 'function') {
			// add(handler) or add(handler, options)
			const opts =
				typeof handlerOrOptions === 'object' ? handlerOrOptions : undefined
			this.routes.push({
				matcher: undefined,
				options: opts,
				handler: queueNameOrHandler,
			})
		} else {
			// add(queueName, handler) or add(queueName, handler, options)
			this.routes.push({
				matcher: queueNameOrHandler,
				options,
				handler: handlerOrOptions as SQSHandler,
			})
		}
	}

	async handleEvent(
		event: SQSEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware<SQSContext>[] = [],
	): Promise<BatchResponse> {
		return this.handle(
			event.Records,
			lambdaContext,
			errorHandler,
			notFoundHandler,
			middleware as Middleware[],
		)
	}

	protected getRecordId(record: SQSRecord): string {
		return record.messageId
	}

	protected findRouteForRecord(record: SQSRecord): SQSRoute | undefined {
		const queue = parseQueueName(record.eventSourceARN)
		return this.matchRoute(queue)
	}

	protected async processRecord(
		record: SQSRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
		middleware: Middleware[] = [],
	): Promise<void> {
		const queue = parseQueueName(record.eventSourceARN)
		const route = this.matchRoute(queue)

		if (!route) {
			if (notFoundHandler) {
				const ctx = createNotFoundContext('sqs', record, lambdaContext)
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const ctx = createSQSContext(record, lambdaContext)
			const composed = composeMiddleware(
				middleware as Middleware<SQSContext>[],
				route.handler,
			)
			await composed(ctx)
		} catch (error) {
			if (errorHandler) {
				const ctx = createErrorContext('sqs', record, lambdaContext)
				await errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private matchRoute(queue: string): SQSRoute | undefined {
		for (const route of this.routes) {
			if (!route.matcher || route.matcher === queue) {
				return route
			}
		}
		return undefined
	}
}
