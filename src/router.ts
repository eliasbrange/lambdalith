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
					options: {
						tableName: optionsOrHandler.tableName,
						eventName,
						sequential: optionsOrHandler.sequential,
					},
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

		// Determine if sequential processing is needed from first record's route
		const firstRecord = event.Records[0]
		const firstQueue = firstRecord
			? parseQueueName(firstRecord.eventSourceARN)
			: ''
		const firstRoute = this.matchSQSRoute(firstQueue)
		const isSequential = firstRoute?.options?.sequential === true

		const processRecord = async (record: (typeof event.Records)[0]) => {
			const queue = parseQueueName(record.eventSourceARN)
			const route = this.matchSQSRoute(queue)

			if (!route) {
				if (this.notFoundHandler) {
					const ctx = createNotFoundContext('sqs', record, lambdaContext)
					await this.notFoundHandler(ctx)
				}
				return
			}

			try {
				const ctx = createSQSContext(record, lambdaContext)
				await route.handler(ctx)
			} catch (error) {
				if (this.errorHandler) {
					const ctx = createErrorContext('sqs', record, lambdaContext)
					await this.errorHandler(error as Error, ctx)
				}
				throw error
			}
		}

		if (isSequential) {
			for (let i = 0; i < event.Records.length; i++) {
				const record = event.Records[i]
				if (!record) continue
				try {
					await processRecord(record)
				} catch {
					failures.push(record.messageId)
				}
			}
		} else {
			const results = await Promise.allSettled(
				event.Records.map((record) => processRecord(record)),
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
		}

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	private async handleSNS(
		event: SNSEvent,
		lambdaContext: LambdaContext,
	): Promise<void> {
		// Determine if sequential processing is needed from first record's route
		const firstRecord = event.Records[0]
		const firstTopic = firstRecord
			? parseTopicName(firstRecord.Sns.TopicArn)
			: ''
		const firstRoute = this.matchSNSRoute(firstTopic)
		const isSequential = firstRoute?.options?.sequential === true

		const processRecord = async (record: (typeof event.Records)[0]) => {
			const topic = parseTopicName(record.Sns.TopicArn)
			const route = this.matchSNSRoute(topic)

			if (!route) {
				if (this.notFoundHandler) {
					const ctx = createNotFoundContext('sns', record, lambdaContext)
					await this.notFoundHandler(ctx)
				}
				return
			}

			try {
				const ctx = createSNSContext(record, lambdaContext)
				await route.handler(ctx)
			} catch (error) {
				if (this.errorHandler) {
					const ctx = createErrorContext('sns', record, lambdaContext)
					await this.errorHandler(error as Error, ctx)
				}
				// SNS doesn't support partial batch failures, so we just log
				throw error
			}
		}

		if (isSequential) {
			for (const record of event.Records) {
				await processRecord(record)
			}
		} else {
			await Promise.allSettled(
				event.Records.map((record) => processRecord(record)),
			)
		}
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

		// Determine if sequential processing is needed from first record's route
		const firstRecord = event.Records[0]
		const firstTable = firstRecord
			? parseTableName(firstRecord.eventSourceARN)
			: ''
		const firstEventName = firstRecord?.eventName ?? ''
		const firstRoute = this.matchDynamoDBRoute(firstTable, firstEventName)
		const isSequential = firstRoute?.options?.sequential === true

		const processRecord = async (record: (typeof event.Records)[0]) => {
			const table = parseTableName(record.eventSourceARN)
			const eventName = record.eventName
			const route = this.matchDynamoDBRoute(table, eventName)

			if (!route) {
				if (this.notFoundHandler) {
					const ctx = createNotFoundContext('dynamodb', record, lambdaContext)
					await this.notFoundHandler(ctx)
				}
				return
			}

			try {
				const ctx = createDynamoDBContext(record, lambdaContext)
				await route.handler(ctx)
			} catch (error) {
				if (this.errorHandler) {
					const ctx = createErrorContext('dynamodb', record, lambdaContext)
					await this.errorHandler(error as Error, ctx)
				}
				throw error
			}
		}

		if (isSequential) {
			for (let i = 0; i < event.Records.length; i++) {
				const record = event.Records[i]
				if (!record) continue
				try {
					await processRecord(record)
				} catch {
					failures.push(record.eventID)
				}
			}
		} else {
			const results = await Promise.allSettled(
				event.Records.map((record) => processRecord(record)),
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
		}

		return {
			batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
		}
	}

	// Matching methods (first match wins)

	private matchSQSRoute(
		queue: string,
	): Route<SQSHandler, SQSMatchOptions | undefined> | undefined {
		for (const route of this.sqsRoutes) {
			if (
				!route.options ||
				!route.options.queueName ||
				route.options.queueName === queue
			) {
				return route
			}
		}
		return undefined
	}

	private matchSNSRoute(
		topic: string,
	): Route<SNSHandler, SNSMatchOptions | undefined> | undefined {
		for (const route of this.snsRoutes) {
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

	private matchDynamoDBRoute(
		table: string,
		eventName: string,
	): Route<DynamoDBHandler, DynamoDBMatchOptions | undefined> | undefined {
		for (const route of this.dynamodbRoutes) {
			if (!route.options) {
				return route
			}
			const tableMatch =
				!route.options.tableName || route.options.tableName === table
			const eventNameMatch =
				!route.options.eventName || route.options.eventName === eventName
			if (tableMatch && eventNameMatch) {
				return route
			}
		}
		return undefined
	}
}
