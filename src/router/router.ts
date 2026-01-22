import type { BatchResponse, LambdaContext } from '../aws-types.ts'
import { detectEventType } from '../detection.ts'
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
} from '../types.ts'
import { DynamoDBRouter } from './dynamodb-router.ts'
import { EventBridgeRouter } from './eventbridge-router.ts'
import { SnsRouter } from './sns-router.ts'
import { SqsRouter } from './sqs-router.ts'

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
		;(this.sqsRouter.add as (...args: unknown[]) => void)(
			queueNameOrHandler,
			handlerOrOptions,
			options,
		)
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
		;(this.snsRouter.add as (...args: unknown[]) => void)(
			topicNameOrHandler,
			handler,
		)
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
		;(this.eventBridgeRouter.add as (...args: unknown[]) => void)(
			optionsOrHandler,
			handler,
		)
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
		;(this.dynamodbRouter.add as (...args: unknown[]) => void)(
			tableNameOrHandler,
			handlerOrOptions,
			options,
		)
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
					return this.sqsRouter.handleEvent(
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
					return this.dynamodbRouter.handleEvent(
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
