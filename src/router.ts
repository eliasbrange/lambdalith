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
	DynamoDBMatchOptions,
	DynamoDBTableOptions,
	ErrorHandler,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	NotFoundHandler,
	Route,
	SNSHandler,
	SNSMatchOptions,
	SQSHandler,
	SQSMatchOptions,
} from './types.ts'

type DynamoDBEventMethod = {
	(handler: DynamoDBHandler): EventRouter
	(options: DynamoDBTableOptions, handler: DynamoDBHandler): EventRouter
}

type DynamoDBRouter = {
	(handler: DynamoDBHandler): EventRouter
	(options: DynamoDBTableOptions, handler: DynamoDBHandler): EventRouter
	insert: DynamoDBEventMethod
	modify: DynamoDBEventMethod
	remove: DynamoDBEventMethod
}

import { parseQueueName, parseTableName, parseTopicName } from './utils.ts'

export class EventRouter {
	private sqsRoutes: Route<SQSHandler, SQSMatchOptions | undefined>[] = []
	private snsRoutes: Route<SNSHandler, SNSMatchOptions | undefined>[] = []
	private eventRoutes: Route<
		EventBridgeHandler,
		EventBridgeMatchOptions | undefined
	>[] = []
	private dynamodbRoutes: Route<
		DynamoDBHandler,
		DynamoDBMatchOptions | undefined
	>[] = []
	private notFoundHandler?: NotFoundHandler
	private errorHandler?: ErrorHandler

	/**
	 * Register an SQS handler.
	 * Routes are matched in registration order (first match wins).
	 */
	sqs(handler: SQSHandler): this
	sqs(options: SQSMatchOptions, handler: SQSHandler): this
	sqs(
		optionsOrHandler: SQSMatchOptions | SQSHandler,
		handler?: SQSHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.sqsRoutes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.sqsRoutes.push({ options: optionsOrHandler, handler })
		}
		return this
	}

	/**
	 * Register an SNS handler.
	 * Routes are matched in registration order (first match wins).
	 */
	sns(handler: SNSHandler): this
	sns(options: SNSMatchOptions, handler: SNSHandler): this
	sns(
		optionsOrHandler: SNSMatchOptions | SNSHandler,
		handler?: SNSHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.snsRoutes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.snsRoutes.push({ options: optionsOrHandler, handler })
		}
		return this
	}

	/**
	 * Register an EventBridge handler.
	 * Routes are matched in registration order (first match wins).
	 */
	event(handler: EventBridgeHandler): this
	event(options: EventBridgeMatchOptions, handler: EventBridgeHandler): this
	event(
		optionsOrHandler: EventBridgeMatchOptions | EventBridgeHandler,
		handler?: EventBridgeHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.eventRoutes.push({ options: undefined, handler: optionsOrHandler })
		} else if (handler) {
			this.eventRoutes.push({ options: optionsOrHandler, handler })
		}
		return this
	}

	/**
	 * Register a DynamoDB Streams handler.
	 * Routes are matched in registration order (first match wins).
	 *
	 * @example
	 * // Catch-all
	 * router.dynamodb(handler)
	 *
	 * // Specific table, all events
	 * router.dynamodb({ tableName: 'orders' }, handler)
	 *
	 * // Specific event type
	 * router.dynamodb.insert(handler)
	 * router.dynamodb.insert({ tableName: 'orders' }, handler)
	 */
	get dynamodb(): DynamoDBRouter {
		const addRoute = (
			eventName: 'INSERT' | 'MODIFY' | 'REMOVE' | undefined,
			optionsOrHandler: DynamoDBTableOptions | DynamoDBHandler,
			handler?: DynamoDBHandler,
		): this => {
			if (typeof optionsOrHandler === 'function') {
				this.dynamodbRoutes.push({
					options: eventName ? { eventName } : undefined,
					handler: optionsOrHandler,
				})
			} else if (handler) {
				this.dynamodbRoutes.push({
					options: { tableName: optionsOrHandler.tableName, eventName },
					handler,
				})
			}
			return this
		}

		const createEventMethod = (
			eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
		): DynamoDBEventMethod => {
			return ((
				optionsOrHandler: DynamoDBTableOptions | DynamoDBHandler,
				handler?: DynamoDBHandler,
			) =>
				addRoute(eventName, optionsOrHandler, handler)) as DynamoDBEventMethod
		}

		const base = (
			optionsOrHandler: DynamoDBTableOptions | DynamoDBHandler,
			handler?: DynamoDBHandler,
		) => addRoute(undefined, optionsOrHandler, handler)

		return Object.assign(base, {
			insert: createEventMethod('INSERT'),
			modify: createEventMethod('MODIFY'),
			remove: createEventMethod('REMOVE'),
		}) as DynamoDBRouter
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

	// Matching methods (first match wins)

	private matchSQSHandler(queue: string): SQSHandler | undefined {
		for (const route of this.sqsRoutes) {
			if (!route.options || route.options.queueName === queue) {
				return route.handler
			}
		}
		return undefined
	}

	private matchSNSHandler(topic: string): SNSHandler | undefined {
		for (const route of this.snsRoutes) {
			if (!route.options || route.options.topicName === topic) {
				return route.handler
			}
		}
		return undefined
	}

	private matchEventBridgeHandler(
		source: string,
		detailType: string,
	): EventBridgeHandler | undefined {
		for (const route of this.eventRoutes) {
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

	private matchDynamoDBHandler(
		table: string,
		eventName: string,
	): DynamoDBHandler | undefined {
		for (const route of this.dynamodbRoutes) {
			if (!route.options) {
				return route.handler
			}
			const tableMatch =
				!route.options.tableName || route.options.tableName === table
			const eventNameMatch =
				!route.options.eventName || route.options.eventName === eventName
			if (tableMatch && eventNameMatch) {
				return route.handler
			}
		}
		return undefined
	}
}
