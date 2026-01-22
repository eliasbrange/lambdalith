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
	NotFoundHandler,
	SQSHandler,
	SQSOptions,
} from '../types.ts'
import { parseQueueName } from '../utils.ts'

interface SQSRoute {
	queueName: string | undefined
	options: SQSOptions | undefined
	handler: SQSHandler
}

export class SqsRouter {
	private routes: SQSRoute[] = []

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
				queueName: undefined,
				options: opts,
				handler: queueNameOrHandler,
			})
		} else {
			// add(queueName, handler) or add(queueName, handler, options)
			this.routes.push({
				queueName: queueNameOrHandler,
				options,
				handler: handlerOrOptions as SQSHandler,
			})
		}
	}

	async handle(
		event: SQSEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<BatchResponse> {
		const firstRecord = event.Records[0]
		const isSequential = this.isSequential(firstRecord)

		const failures = isSequential
			? await this.processSequentially(
					event.Records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)
			: await this.processInParallel(
					event.Records,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	private isSequential(firstRecord: SQSRecord | undefined): boolean {
		if (!firstRecord) return false
		const queue = parseQueueName(firstRecord.eventSourceARN)
		const route = this.matchRoute(queue)
		return route?.options?.sequential === true
	}

	private async processSequentially(
		records: SQSRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<string[]> {
		for (let i = 0; i < records.length; i++) {
			const record = records[i]
			if (!record) continue
			try {
				await this.processRecord(
					record,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				)
			} catch {
				return records.slice(i).map((r) => r.messageId)
			}
		}
		return []
	}

	private async processInParallel(
		records: SQSRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<string[]> {
		const results = await Promise.allSettled(
			records.map((record) =>
				this.processRecord(
					record,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				),
			),
		)

		const failures: string[] = []
		for (let i = 0; i < results.length; i++) {
			if (results[i]?.status === 'rejected') {
				const record = records[i]
				if (record) {
					failures.push(record.messageId)
				}
			}
		}
		return failures
	}

	private async processRecord(
		record: SQSRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
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
			await route.handler(ctx)
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
			if (!route.queueName || route.queueName === queue) {
				return route
			}
		}
		return undefined
	}
}
