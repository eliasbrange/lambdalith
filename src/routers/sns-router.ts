import type { LambdaContext, SNSEvent, SNSEventRecord } from '../aws-types.ts'
import {
	createErrorContext,
	createNotFoundContext,
	createSNSContext,
} from '../contexts.ts'
import type { ErrorHandler, NotFoundHandler, SNSHandler } from '../types.ts'
import { parseTopicName } from '../utils.ts'

interface SNSRoute {
	topicName: string | undefined
	handler: SNSHandler
}

export class SnsRouter {
	private routes: SNSRoute[] = []

	add(handler: SNSHandler): void
	add(topicName: string, handler: SNSHandler): void
	add(topicNameOrHandler: string | SNSHandler, handler?: SNSHandler): void {
		if (typeof topicNameOrHandler === 'function') {
			this.routes.push({ topicName: undefined, handler: topicNameOrHandler })
		} else if (handler) {
			this.routes.push({ topicName: topicNameOrHandler, handler })
		}
	}

	async handle(
		event: SNSEvent,
		lambdaContext: LambdaContext,
		errorHandler?: ErrorHandler,
		notFoundHandler?: NotFoundHandler,
	): Promise<void> {
		await Promise.allSettled(
			event.Records.map((record) =>
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

	private matchRoute(topic: string): SNSRoute | undefined {
		for (const route of this.routes) {
			if (!route.topicName || route.topicName === topic) {
				return route
			}
		}
		return undefined
	}
}
