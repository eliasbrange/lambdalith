import type {
	DynamoDBRecord,
	EventBridgeEvent,
	LambdaContext,
	SNSEventRecord,
	SQSRecord,
} from './aws-types.ts'
import type {
	BaseContext,
	DynamoDBContext,
	DynamoDBData,
	ErrorContext,
	EventBridgeContext,
	EventBridgeData,
	EventSource,
	NotFoundContext,
	SNSContext,
	SNSData,
	SQSContext,
	SQSData,
} from './types.ts'
import {
	parseQueueName,
	parseTableName,
	parseTopicName,
	safeJsonParse,
	unmarshall,
} from './utils.ts'

/**
 * Base context implementation with get/set and lambda context.
 */
class BaseContextImpl implements BaseContext {
	private store = new Map<string, unknown>()

	constructor(public readonly lambda: LambdaContext) {}

	get<T = unknown>(key: string): T | undefined {
		return this.store.get(key) as T | undefined
	}

	set(key: string, value: unknown): void {
		this.store.set(key, value)
	}
}

/**
 * SQS data implementation.
 */
class SQSDataImpl implements SQSData {
	readonly queue: string
	readonly body: unknown
	readonly messageId: string
	readonly receiptHandle: string
	readonly sentTimestamp: Date
	readonly approximateReceiveCount: number
	readonly messageGroupId: string | undefined
	readonly messageDeduplicationId: string | undefined
	readonly attributes: Record<string, string>

	constructor(public readonly raw: SQSRecord) {
		this.queue = parseQueueName(raw.eventSourceARN)
		this.body = safeJsonParse(raw.body)
		this.messageId = raw.messageId
		this.receiptHandle = raw.receiptHandle
		this.sentTimestamp = new Date(Number(raw.attributes.SentTimestamp))
		this.approximateReceiveCount = Number(
			raw.attributes.ApproximateReceiveCount,
		)
		this.messageGroupId = raw.attributes.MessageGroupId
		this.messageDeduplicationId = raw.attributes.MessageDeduplicationId
		this.attributes = this.buildAttributes(raw)
	}

	attribute(name: string): string | undefined {
		return this.attributes[name]
	}

	private buildAttributes(raw: SQSRecord): Record<string, string> {
		const attrs: Record<string, string> = {}
		for (const [key, value] of Object.entries(raw.messageAttributes)) {
			if (value.stringValue !== undefined) {
				attrs[key] = value.stringValue
			}
		}
		return attrs
	}
}

/**
 * SNS data implementation.
 */
class SNSDataImpl implements SNSData {
	readonly topic: string
	readonly topicArn: string
	readonly body: unknown
	readonly messageId: string
	readonly subject: string | undefined
	readonly timestamp: Date
	readonly attributes: Record<string, string>

	constructor(public readonly raw: SNSEventRecord) {
		this.topicArn = raw.Sns.TopicArn
		this.topic = parseTopicName(raw.Sns.TopicArn)
		this.body = safeJsonParse(raw.Sns.Message)
		this.messageId = raw.Sns.MessageId
		this.subject = raw.Sns.Subject
		this.timestamp = new Date(raw.Sns.Timestamp)
		this.attributes = this.buildAttributes(raw)
	}

	attribute(name: string): string | undefined {
		return this.attributes[name]
	}

	private buildAttributes(raw: SNSEventRecord): Record<string, string> {
		const attrs: Record<string, string> = {}
		for (const [key, value] of Object.entries(raw.Sns.MessageAttributes)) {
			attrs[key] = value.Value
		}
		return attrs
	}
}

/**
 * EventBridge data implementation.
 */
class EventBridgeDataImpl implements EventBridgeData {
	readonly source: string
	readonly detailType: string
	readonly detail: unknown
	readonly id: string
	readonly account: string
	readonly region: string
	readonly time: Date
	readonly resources: string[]

	constructor(public readonly raw: EventBridgeEvent) {
		this.source = raw.source
		this.detailType = raw['detail-type']
		this.detail = raw.detail
		this.id = raw.id
		this.account = raw.account
		this.region = raw.region
		this.time = new Date(raw.time)
		this.resources = raw.resources
	}
}

/**
 * DynamoDB data implementation.
 */
class DynamoDBDataImpl implements DynamoDBData {
	readonly table: string
	readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE'
	readonly keys: Record<string, unknown>
	readonly newImage: Record<string, unknown> | undefined
	readonly oldImage: Record<string, unknown> | undefined
	readonly eventId: string
	readonly sequenceNumber: string
	readonly streamArn: string

	constructor(public readonly raw: DynamoDBRecord) {
		this.table = parseTableName(raw.eventSourceARN)
		this.eventName = raw.eventName
		this.keys = unmarshall(raw.dynamodb.Keys)
		this.newImage = raw.dynamodb.NewImage
			? unmarshall(raw.dynamodb.NewImage)
			: undefined
		this.oldImage = raw.dynamodb.OldImage
			? unmarshall(raw.dynamodb.OldImage)
			: undefined
		this.eventId = raw.eventID
		this.sequenceNumber = raw.dynamodb.SequenceNumber
		this.streamArn = raw.eventSourceARN
	}
}

// Context factory functions

export function createSQSContext(
	record: SQSRecord,
	lambdaContext: LambdaContext,
): SQSContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source: 'sqs' as const,
		sqs: new SQSDataImpl(record),
	}) as SQSContext
}

export function createSNSContext(
	record: SNSEventRecord,
	lambdaContext: LambdaContext,
): SNSContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source: 'sns' as const,
		sns: new SNSDataImpl(record),
	}) as SNSContext
}

export function createEventBridgeContext(
	event: EventBridgeEvent,
	lambdaContext: LambdaContext,
): EventBridgeContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source: 'event' as const,
		event: new EventBridgeDataImpl(event),
	}) as EventBridgeContext
}

export function createDynamoDBContext(
	record: DynamoDBRecord,
	lambdaContext: LambdaContext,
): DynamoDBContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source: 'dynamodb' as const,
		dynamodb: new DynamoDBDataImpl(record),
	}) as DynamoDBContext
}

export function createNotFoundContext(
	source: EventSource,
	raw: unknown,
	lambdaContext: LambdaContext,
): NotFoundContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source,
		raw,
	}) as NotFoundContext
}

export function createErrorContext(
	source: EventSource,
	raw: unknown,
	lambdaContext: LambdaContext,
): ErrorContext {
	const base = new BaseContextImpl(lambdaContext)
	return Object.assign(base, {
		source,
		raw,
	}) as ErrorContext
}
