import type {
	AttributeValue,
	DynamoDBRecord,
	EventBridgeEvent,
	LambdaContext,
	SNSEventRecord,
	SQSRecord,
} from './aws-types.ts'

// Event source types
export type EventSource = 'sqs' | 'sns' | 'event' | 'dynamodb'

// Base context with shared functionality
export interface BaseContext {
	readonly lambda: LambdaContext
	get<T = unknown>(key: string): T | undefined
	set(key: string, value: unknown): void
}

// SQS-specific data
export interface SQSData {
	readonly queue: string
	readonly body: unknown
	readonly messageId: string
	readonly receiptHandle: string
	readonly sentTimestamp: Date
	readonly approximateReceiveCount: number
	readonly messageGroupId: string | undefined
	readonly messageDeduplicationId: string | undefined
	readonly attributes: Record<string, string>
	readonly raw: SQSRecord
	attribute(name: string): string | undefined
}

// SNS-specific data
export interface SNSData {
	readonly topic: string
	readonly topicArn: string
	readonly body: unknown
	readonly messageId: string
	readonly subject: string | undefined
	readonly timestamp: Date
	readonly attributes: Record<string, string>
	readonly raw: SNSEventRecord
	attribute(name: string): string | undefined
}

// EventBridge-specific data
export interface EventBridgeData {
	readonly source: string
	readonly detailType: string
	readonly detail: unknown
	readonly id: string
	readonly account: string
	readonly region: string
	readonly time: Date
	readonly resources: string[]
	readonly raw: EventBridgeEvent
}

// DynamoDB-specific data
export interface DynamoDBData {
	readonly table: string
	readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE'
	readonly keys: Record<string, unknown>
	readonly newImage: Record<string, unknown> | undefined
	readonly oldImage: Record<string, unknown> | undefined
	readonly eventId: string
	readonly sequenceNumber: string
	readonly streamArn: string
	readonly raw: DynamoDBRecord
}

// Full context types for each event source (discriminated union)
export interface SQSContext extends BaseContext {
	readonly source: 'sqs'
	readonly sqs: SQSData
}

export interface SNSContext extends BaseContext {
	readonly source: 'sns'
	readonly sns: SNSData
}

export interface EventBridgeContext extends BaseContext {
	readonly source: 'event'
	readonly event: EventBridgeData
}

export interface DynamoDBContext extends BaseContext {
	readonly source: 'dynamodb'
	readonly dynamodb: DynamoDBData
}

// Handler types
export type SQSHandler = (c: SQSContext) => void | Promise<void>
export type SNSHandler = (c: SNSContext) => void | Promise<void>
export type EventBridgeHandler = (c: EventBridgeContext) => void | Promise<void>
export type DynamoDBHandler = (c: DynamoDBContext) => void | Promise<void>

// Not found context
export interface NotFoundContext extends BaseContext {
	readonly source: EventSource
	readonly raw: unknown
}

export type NotFoundHandler = (c: NotFoundContext) => void | Promise<void>

// Error context
export interface ErrorContext extends BaseContext {
	readonly source: EventSource
	readonly raw: unknown
}

export type ErrorHandler = (
	error: Error,
	c: ErrorContext,
) => void | Promise<void>

// Match option types
export interface SQSOptions {
	sequential?: boolean
}

export interface EventBridgeMatchOptions {
	source?: string
	detailType?: string
}

export interface DynamoDBOptions {
	sequential?: boolean
}

// Route types
export interface SQSRoute {
	matcher: string | undefined
	options: SQSOptions | undefined
	handler: SQSHandler
}

export interface SNSRoute {
	matcher: string | undefined
	handler: SNSHandler
}

export interface EventBridgeRoute {
	options: EventBridgeMatchOptions | undefined
	handler: EventBridgeHandler
}

export interface DynamoDBRoute {
	matcher: string | undefined
	options: DynamoDBOptions | undefined
	handler: DynamoDBHandler
}

// Middleware types

// Union context for global middleware
export type AnyContext =
	| SQSContext
	| SNSContext
	| EventBridgeContext
	| DynamoDBContext

// Next function for middleware
export type Next = () => Promise<void>

// Middleware type (generic, defaults to AnyContext for global middleware)
export type Middleware<C = AnyContext> = (
	c: C,
	next: Next,
) => void | Promise<void>

// Typed middleware variants for event-specific middleware
export type SQSMiddleware = Middleware<SQSContext>
export type SNSMiddleware = Middleware<SNSContext>
export type EventBridgeMiddleware = Middleware<EventBridgeContext>
export type DynamoDBMiddleware = Middleware<DynamoDBContext>

// Internal middleware entry (used by router)
export interface MiddlewareEntry {
	filter: EventSource | undefined
	handler: Middleware
}

// DynamoDB AttributeValue re-export for utils
export type { AttributeValue }
