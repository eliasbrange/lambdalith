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
	DynamoDBOptions,
	ErrorHandler,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	NotFoundHandler,
	SNSHandler,
	SQSHandler,
	SQSOptions,
} from './types.ts'

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
	 * router.sqs('orders-queue', handler)
	 *
	 * // Sequential processing
	 * router.sqs('orders-queue', handler, { sequential: true })
	 */
	sqs(handler: SQSHandler): this
	sqs(handler: SQSHandler, options: SQSOptions): this
	sqs(queueName: string, handler: SQSHandler): this
	sqs(queueName: string, handler: SQSHandler, options: SQSOptions): this
	sqs(
		queueNameOrHandler: string | SQSHandler,
		handlerOrOptions?: SQSHandler | SQSOptions,
		options?: SQSOptions,
	): this {
		if (typeof queueNameOrHandler === 'function') {
			// sqs(handler) or sqs(handler, options)
			const opts =
				typeof handlerOrOptions === 'object' ? handlerOrOptions : undefined
			if (opts) {
				this.sqsRouter.add(queueNameOrHandler, opts)
			} else {
				this.sqsRouter.add(queueNameOrHandler)
			}
		} else {
			// sqs(queueName, handler) or sqs(queueName, handler, options)
			if (options) {
				this.sqsRouter.add(
					queueNameOrHandler,
					handlerOrOptions as SQSHandler,
					options,
				)
			} else {
				this.sqsRouter.add(queueNameOrHandler, handlerOrOptions as SQSHandler)
			}
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
	 * router.sns('orders-topic', handler)
	 */
	sns(handler: SNSHandler): this
	sns(topicName: string, handler: SNSHandler): this
	sns(topicNameOrHandler: string | SNSHandler, handler?: SNSHandler): this {
		if (typeof topicNameOrHandler === 'function') {
			this.snsRouter.add(topicNameOrHandler)
		} else if (handler) {
			this.snsRouter.add(topicNameOrHandler, handler)
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
	 * // Specific table
	 * router.dynamodb('orders', handler)
	 *
	 * // Sequential processing
	 * router.dynamodb('orders', handler, { sequential: true })
	 */
	dynamodb(handler: DynamoDBHandler): this
	dynamodb(handler: DynamoDBHandler, options: DynamoDBOptions): this
	dynamodb(tableName: string, handler: DynamoDBHandler): this
	dynamodb(
		tableName: string,
		handler: DynamoDBHandler,
		options: DynamoDBOptions,
	): this
	dynamodb(
		tableNameOrHandler: string | DynamoDBHandler,
		handlerOrOptions?: DynamoDBHandler | DynamoDBOptions,
		options?: DynamoDBOptions,
	): this {
		if (typeof tableNameOrHandler === 'function') {
			// dynamodb(handler) or dynamodb(handler, options)
			const opts =
				typeof handlerOrOptions === 'object' ? handlerOrOptions : undefined
			if (opts) {
				this.dynamodbRouter.add(tableNameOrHandler, opts)
			} else {
				this.dynamodbRouter.add(tableNameOrHandler)
			}
		} else {
			// dynamodb(tableName, handler) or dynamodb(tableName, handler, options)
			if (options) {
				this.dynamodbRouter.add(
					tableNameOrHandler,
					handlerOrOptions as DynamoDBHandler,
					options,
				)
			} else {
				this.dynamodbRouter.add(
					tableNameOrHandler,
					handlerOrOptions as DynamoDBHandler,
				)
			}
		}
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
