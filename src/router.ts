import type {
	DynamoDBStreamEvent,
	EventBridgeEvent,
	LambdaContext,
	SNSEvent,
	SQSBatchResponse,
	SQSEvent,
} from './aws-types.ts'
import {
	createDynamoDBContext,
	createErrorContext,
	createEventBridgeContext,
	createNotFoundContext,
	createSNSContext,
	createSQSContext,
} from './contexts.ts'
import { detectEventType } from './detection.ts'
import type {
	DynamoDBHandler,
	ErrorHandler,
	EventBridgeHandler,
	NotFoundHandler,
	Route,
	SNSHandler,
	SQSHandler,
} from './types.ts'
import { parseQueueName, parseTableName, parseTopicName } from './utils.ts'

export class EventRouter {
	private sqsRoutes: Route<SQSHandler>[] = []
	private snsRoutes: Route<SNSHandler>[] = []
	private eventRoutes: Route<EventBridgeHandler>[] = []
	private dynamodbRoutes: Route<DynamoDBHandler>[] = []
	private notFoundHandler?: NotFoundHandler
	private errorHandler?: ErrorHandler

	/**
	 * Register an SQS handler for a queue pattern.
	 * Patterns: 'queue-name' (exact) or '*' (catch-all)
	 */
	sqs(pattern: string, handler: SQSHandler): this {
		this.sqsRoutes.push({ pattern, handler })
		return this
	}

	/**
	 * Register an SNS handler for a topic pattern.
	 * Patterns: 'topic-name' (exact) or '*' (catch-all)
	 */
	sns(pattern: string, handler: SNSHandler): this {
		this.snsRoutes.push({ pattern, handler })
		return this
	}

	/**
	 * Register an EventBridge handler for a source/detail-type pattern.
	 * Patterns: 'source/detailType' (exact), 'source/*' (partial), or '*' (catch-all)
	 */
	event(pattern: string, handler: EventBridgeHandler): this {
		this.eventRoutes.push({ pattern, handler })
		return this
	}

	/**
	 * Register a DynamoDB Streams handler for a table/event pattern.
	 * Patterns: 'table/INSERT' (exact), 'table/*' (partial), or '*' (catch-all)
	 */
	dynamodb(pattern: string, handler: DynamoDBHandler): this {
		this.dynamodbRoutes.push({ pattern, handler })
		return this
	}

	/**
	 * Register a handler for unmatched events.
	 */
	notFound(handler: NotFoundHandler): this {
		this.notFoundHandler = handler
		return this
	}

	/**
	 * Register an error handler.
	 */
	onError(handler: ErrorHandler): this {
		this.errorHandler = handler
		return this
	}

	/**
	 * Create a Lambda handler function.
	 */
	handler(): (
		event: unknown,
		context: LambdaContext,
	) => Promise<SQSBatchResponse | undefined> {
		return async (
			event: unknown,
			context: LambdaContext,
		): Promise<SQSBatchResponse | undefined> => {
			const detected = detectEventType(event)

			switch (detected.type) {
				case 'sqs':
					return this.handleSQS(detected.event, context)
				case 'sns':
					await this.handleSNS(detected.event, context)
					return undefined
				case 'event':
					await this.handleEventBridge(detected.event, context)
					return undefined
				case 'dynamodb':
					return this.handleDynamoDB(detected.event, context)
				case 'unknown':
					// No matching event type - call notFound if registered
					if (this.notFoundHandler) {
						const ctx = createNotFoundContext('sqs', event, context)
						await this.notFoundHandler(ctx)
					}
					return undefined
			}
		}
	}

	private async handleSQS(
		event: SQSEvent,
		lambdaContext: LambdaContext,
	): Promise<SQSBatchResponse> {
		const failures: string[] = []

		const results = await Promise.allSettled(
			event.Records.map(async (record) => {
				const queue = parseQueueName(record.eventSourceARN)
				const handler = this.matchSQSHandler(queue)

				if (!handler) {
					if (this.notFoundHandler) {
						const ctx = createNotFoundContext('sqs', record, lambdaContext)
						await this.notFoundHandler(ctx)
					}
					return
				}

				try {
					const ctx = createSQSContext(record, lambdaContext)
					await handler(ctx)
				} catch (error) {
					if (this.errorHandler) {
						const ctx = createErrorContext('sqs', record, lambdaContext)
						await this.errorHandler(error as Error, ctx)
					}
					throw error
				}
			}),
		)

		for (let i = 0; i < results.length; i++) {
			const result = results[i]
			if (result?.status === 'rejected') {
				const record = event.Records[i]
				if (record) {
					failures.push(record.messageId)
				}
			}
		}

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	private async handleSNS(
		event: SNSEvent,
		lambdaContext: LambdaContext,
	): Promise<void> {
		await Promise.allSettled(
			event.Records.map(async (record) => {
				const topic = parseTopicName(record.Sns.TopicArn)
				const handler = this.matchSNSHandler(topic)

				if (!handler) {
					if (this.notFoundHandler) {
						const ctx = createNotFoundContext('sns', record, lambdaContext)
						await this.notFoundHandler(ctx)
					}
					return
				}

				try {
					const ctx = createSNSContext(record, lambdaContext)
					await handler(ctx)
				} catch (error) {
					if (this.errorHandler) {
						const ctx = createErrorContext('sns', record, lambdaContext)
						await this.errorHandler(error as Error, ctx)
					}
					// SNS doesn't support partial batch failures, so we just log
					throw error
				}
			}),
		)
	}

	private async handleEventBridge(
		event: EventBridgeEvent,
		lambdaContext: LambdaContext,
	): Promise<void> {
		const source = event.source
		const detailType = event['detail-type']
		const handler = this.matchEventBridgeHandler(source, detailType)

		if (!handler) {
			if (this.notFoundHandler) {
				const ctx = createNotFoundContext('event', event, lambdaContext)
				await this.notFoundHandler(ctx)
			}
			return
		}

		try {
			const ctx = createEventBridgeContext(event, lambdaContext)
			await handler(ctx)
		} catch (error) {
			if (this.errorHandler) {
				const ctx = createErrorContext('event', event, lambdaContext)
				await this.errorHandler(error as Error, ctx)
			}
			throw error
		}
	}

	private async handleDynamoDB(
		event: DynamoDBStreamEvent,
		lambdaContext: LambdaContext,
	): Promise<SQSBatchResponse> {
		const failures: string[] = []

		const results = await Promise.allSettled(
			event.Records.map(async (record) => {
				const table = parseTableName(record.eventSourceARN)
				const eventName = record.eventName
				const handler = this.matchDynamoDBHandler(table, eventName)

				if (!handler) {
					if (this.notFoundHandler) {
						const ctx = createNotFoundContext('dynamodb', record, lambdaContext)
						await this.notFoundHandler(ctx)
					}
					return
				}

				try {
					const ctx = createDynamoDBContext(record, lambdaContext)
					await handler(ctx)
				} catch (error) {
					if (this.errorHandler) {
						const ctx = createErrorContext('dynamodb', record, lambdaContext)
						await this.errorHandler(error as Error, ctx)
					}
					throw error
				}
			}),
		)

		for (let i = 0; i < results.length; i++) {
			const result = results[i]
			if (result?.status === 'rejected') {
				const record = event.Records[i]
				if (record) {
					failures.push(record.eventID)
				}
			}
		}

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	// Pattern matching methods

	private matchSQSHandler(queue: string): SQSHandler | undefined {
		// Sort by specificity: exact matches first, then wildcards
		const sorted = [...this.sqsRoutes].sort((a, b) => {
			if (a.pattern === '*' && b.pattern !== '*') return 1
			if (a.pattern !== '*' && b.pattern === '*') return -1
			return 0
		})

		for (const route of sorted) {
			if (route.pattern === '*' || route.pattern === queue) {
				return route.handler
			}
		}
		return undefined
	}

	private matchSNSHandler(topic: string): SNSHandler | undefined {
		const sorted = [...this.snsRoutes].sort((a, b) => {
			if (a.pattern === '*' && b.pattern !== '*') return 1
			if (a.pattern !== '*' && b.pattern === '*') return -1
			return 0
		})

		for (const route of sorted) {
			if (route.pattern === '*' || route.pattern === topic) {
				return route.handler
			}
		}
		return undefined
	}

	private matchEventBridgeHandler(
		source: string,
		detailType: string,
	): EventBridgeHandler | undefined {
		const key = `${source}/${detailType}`

		// Sort by specificity: exact > partial > wildcard
		const sorted = [...this.eventRoutes].sort((a, b) => {
			const scoreA = this.getEventBridgePatternScore(a.pattern)
			const scoreB = this.getEventBridgePatternScore(b.pattern)
			return scoreB - scoreA // Higher score = more specific
		})

		for (const route of sorted) {
			if (route.pattern === '*') {
				return route.handler
			}
			if (route.pattern === key) {
				return route.handler
			}
			// Check for partial match (source/*)
			if (route.pattern.endsWith('/*')) {
				const patternSource = route.pattern.slice(0, -2)
				if (patternSource === source) {
					return route.handler
				}
			}
		}
		return undefined
	}

	private matchDynamoDBHandler(
		table: string,
		eventName: string,
	): DynamoDBHandler | undefined {
		const key = `${table}/${eventName}`

		// Sort by specificity: exact > partial > wildcard
		const sorted = [...this.dynamodbRoutes].sort((a, b) => {
			const scoreA = this.getDynamoDBPatternScore(a.pattern)
			const scoreB = this.getDynamoDBPatternScore(b.pattern)
			return scoreB - scoreA
		})

		for (const route of sorted) {
			if (route.pattern === '*') {
				return route.handler
			}
			if (route.pattern === key) {
				return route.handler
			}
			// Check for partial match (table/*)
			if (route.pattern.endsWith('/*')) {
				const patternTable = route.pattern.slice(0, -2)
				if (patternTable === table) {
					return route.handler
				}
			}
		}
		return undefined
	}

	private getEventBridgePatternScore(pattern: string): number {
		if (pattern === '*') return 0
		if (pattern.endsWith('/*')) return 1
		return 2 // Exact match
	}

	private getDynamoDBPatternScore(pattern: string): number {
		if (pattern === '*') return 0
		if (pattern.endsWith('/*')) return 1
		return 2 // Exact match
	}
}
