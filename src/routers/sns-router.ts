import type { LambdaContext, SNSEvent, SNSEventRecord } from '../aws-types.ts'
import {
	createErrorContext,
	createNotFoundContext,
	createSNSContext,
} from '../contexts.ts'
import type {
	ErrorHandler,
	NotFoundHandler,
	Route,
	SNSHandler,
	SNSMatchOptions,
} from '../types.ts'
import { parseTopicName } from '../utils.ts'

export class SnsRouter {
	private routes: Route<SNSHandler, SNSMatchOptions | undefined>[] = []

	add(handler: SNSHandler): void
	add(options: SNSMatchOptions, handler: SNSHandler): void
	add(
		optionsOrHandler: SNSMatchOptions | SNSHandler,
		handler?: SNSHandler,
	): void {
		if (typeof optionsOrHandler === 'function') {
			this.routes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.routes.push({ options: optionsOrHandler, handler })
		}
	}

	async handle(
		event: SNSEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		const firstRecord = event.Records[0]
		const isSequential = this.isSequential(firstRecord)

		if (isSequential) {
			await this.processSequentially(
				event.Records,
				lambdaContext,
				errorHandler,
				notFoundHandler,
			)
		} else {
			await this.processInParallel(
				event.Records,
				lambdaContext,
				errorHandler,
				notFoundHandler,
			)
		}
	}

	private isSequential(firstRecord: SNSEventRecord | undefined): boolean {
		if (!firstRecord) return false
		const topic = parseTopicName(firstRecord.Sns.TopicArn)
		const route = this.matchRoute(topic)
		return route?.options?.sequential === true
	}

	private async processSequentially(
		records: SNSEventRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		for (const record of records) {
			await this.processRecord(
				record,
				lambdaContext,
				errorHandler,
				notFoundHandler,
			)
		}
	}

	private async processInParallel(
		records: SNSEventRecord[],
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		await Promise.allSettled(
			records.map((record) =>
				this.processRecord(
					record,
					lambdaContext,
					errorHandler,
					notFoundHandler,
				),
			),
		)
	}

	private async processRecord(
		record: SNSEventRecord,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		const topic = parseTopicName(record.Sns.TopicArn)
		const route = this.matchRoute(topic)

		if (!route) {
			if (notFoundHandler) {
				const ctx = createNotFoundContext('sns', record, lambdaContext)
				await notFoundHandler(ctx)
			}
			return
		}

		try {
			const ctx = createSNSContext(record, lambdaContext)
			await route.handler(ctx)
		} catch (error) {
			if (errorHandler) {
				const ctx = createErrorContext('sns', record, lambdaContext)
				await errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private matchRoute(
		topic: string,
	): Route<SNSHandler, SNSMatchOptions | undefined> | undefined {
		for (const route of this.routes) {
			if (
				!route.options ||
				!route.options.topicName ||
				route.options.topicName === topic
			) {
				return route
			}
		}
		return undefined
	}
}
