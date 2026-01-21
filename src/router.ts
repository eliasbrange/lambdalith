import type { BatchResponse, LambdaContext } from './aws-types.ts'
import { detectEventType } from './detection.ts'
import {
	DynamoDBRouter,
	EventBridgeRouter,
	SnsRouter,
	SqsRouter,
} from './routers/index.ts'
import type {
	DynamoDBHandler,
	DynamoDBTableOptions,
	ErrorHandler,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	NotFoundHandler,
	SNSHandler,
	SNSMatchOptions,
	SQSHandler,
	SQSMatchOptions,
} from './types.ts'

type DynamoDBEventMethod = {
	(handler: DynamoDBHandler): EventRouter
	(options: DynamoDBTableOptions, handler: DynamoDBHandler): EventRouter
}

type DynamoDBRouterAccessor = {
	(handler: DynamoDBHandler): EventRouter
	(options: DynamoDBTableOptions, handler: DynamoDBHandler): EventRouter
	insert: DynamoDBEventMethod
	modify: DynamoDBEventMethod
	remove: DynamoDBEventMethod
}

export class EventRouter {
	private sqsRouter = new SqsRouter()
	private snsRouter = new SnsRouter()
	private eventBridgeRouter = new EventBridgeRouter()
	private dynamodbRouter = new DynamoDBRouter()
	private notFoundHandler?: NotFoundHandler
	private errorHandler?: ErrorHandler

	/**
	 * Register an SQS handler.
	 * Routes are matched in registration order (first match wins).
	 *
	 * @example
	 * // Catch-all
	 * router.sqs(handler)
	 *
	 * // Specific queue
	 * router.sqs({ queueName: 'orders-queue' }, handler)
	 *
	 * // Sequential processing
	 * router.sqs({ queueName: 'orders-queue', sequential: true }, handler)
	 */
	sqs(handler: SQSHandler): this
	sqs(options: SQSMatchOptions, handler: SQSHandler): this
	sqs(
		optionsOrHandler: SQSMatchOptions | SQSHandler,
		handler?: SQSHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.sqsRouter.add(optionsOrHandler)
		} else if (handler) {
			this.sqsRouter.add(optionsOrHandler, handler)
		}
		return this
	}

	/**
	 * Register an SNS handler.
	 * Routes are matched in registration order (first match wins).
	 *
	 * @example
	 * // Catch-all
	 * router.sns(handler)
	 *
	 * // Specific topic
	 * router.sns({ topicName: 'orders-topic' }, handler)
	 *
	 * // Sequential processing
	 * router.sns({ topicName: 'orders-topic', sequential: true }, handler)
	 */
	sns(handler: SNSHandler): this
	sns(options: SNSMatchOptions, handler: SNSHandler): this
	sns(
		optionsOrHandler: SNSMatchOptions | SNSHandler,
		handler?: SNSHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.snsRouter.add(optionsOrHandler)
		} else if (handler) {
			this.snsRouter.add(optionsOrHandler, handler)
		}
		return this
	}

	/**
	 * Register an EventBridge handler.
	 * Routes are matched in registration order (first match wins).
	 *
	 * @example
	 * // Catch-all
	 * router.event(handler)
	 *
	 * // Specific source
	 * router.event({ source: 'orders.service' }, handler)
	 *
	 * // Specific source and detail type
	 * router.event({ source: 'orders.service', detailType: 'OrderCreated' }, handler)
	 */
	event(handler: EventBridgeHandler): this
	event(options: EventBridgeMatchOptions, handler: EventBridgeHandler): this
	event(
		optionsOrHandler: EventBridgeMatchOptions | EventBridgeHandler,
		handler?: EventBridgeHandler,
	): this {
		if (typeof optionsOrHandler === 'function') {
			this.eventBridgeRouter.add(optionsOrHandler)
		} else if (handler) {
			this.eventBridgeRouter.add(optionsOrHandler, handler)
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
	get dynamodb(): DynamoDBRouterAccessor {
		const createMethod = (
			method: 'add' | 'insert' | 'modify' | 'remove',
		): DynamoDBEventMethod => {
			return ((
				optionsOrHandler: DynamoDBTableOptions | DynamoDBHandler,
				handler?: DynamoDBHandler,
			) => {
				if (typeof optionsOrHandler === 'function') {
					this.dynamodbRouter[method](optionsOrHandler)
				} else if (handler) {
					this.dynamodbRouter[method](optionsOrHandler, handler)
				}
				return this
			}) as DynamoDBEventMethod
		}

		return Object.assign(createMethod('add'), {
			insert: createMethod('insert'),
			modify: createMethod('modify'),
			remove: createMethod('remove'),
		}) as DynamoDBRouterAccessor
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
	) => Promise<BatchResponse | undefined> {
		return async (
			event: unknown,
			context: LambdaContext,
		): Promise<BatchResponse | undefined> => {
			const detected = detectEventType(event)

			switch (detected.type) {
				case 'sqs':
					return this.sqsRouter.handle(
						detected.event,
						context,
						this.errorHandler,
						this.notFoundHandler,
					)
				case 'sns':
					await this.snsRouter.handle(
						detected.event,
						context,
						this.errorHandler,
						this.notFoundHandler,
					)
					return undefined
				case 'event':
					await this.eventBridgeRouter.handle(
						detected.event,
						context,
						this.errorHandler,
						this.notFoundHandler,
					)
					return undefined
				case 'dynamodb':
					return this.dynamodbRouter.handle(
						detected.event,
						context,
						this.errorHandler,
						this.notFoundHandler,
					)
				case 'unknown':
					throw new Error(
						`Unknown event type. Ensure your Lambda is configured with a supported trigger (SQS, SNS, EventBridge, DynamoDB Streams).`,
					)
			}
		}
	}
}
