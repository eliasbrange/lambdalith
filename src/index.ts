// Re-export AWS types for consumers who need raw types
export type {
	AttributeValue,
	BatchResponse,
	DynamoDBRecord,
	DynamoDBStreamEvent,
	EventBridgeEvent,
	LambdaContext,
	SNSEvent,
	SNSEventRecord,
	SNSMessage,
	SQSEvent,
	SQSRecord,
	StreamRecord,
} from './aws-types.ts'
export { EventRouter } from './router.ts'
// Re-export types for consumers
export type {
	DynamoDBContext,
	DynamoDBData,
	DynamoDBHandler,
	DynamoDBOptions,
	ErrorContext,
	ErrorHandler,
	EventBridgeContext,
	EventBridgeData,
	EventBridgeHandler,
	EventBridgeMatchOptions,
	EventSource,
	NotFoundContext,
	NotFoundHandler,
	SNSContext,
	SNSData,
	SNSHandler,
	SQSContext,
	SQSData,
	SQSHandler,
	SQSOptions,
} from './types.ts'
