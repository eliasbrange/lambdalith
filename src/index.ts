// Re-export AWS types for consumers who need raw types
export type {
	AttributeValue,
	DynamoDBRecord,
	DynamoDBStreamEvent,
	EventBridgeEvent,
	LambdaContext,
	SNSEvent,
	SNSEventRecord,
	SNSMessage,
	SQSBatchResponse,
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
	ErrorContext,
	ErrorHandler,
	EventBridgeContext,
	EventBridgeData,
	EventBridgeHandler,
	EventSource,
	NotFoundContext,
	NotFoundHandler,
	SNSContext,
	SNSData,
	SNSHandler,
	SQSContext,
	SQSData,
	SQSHandler,
} from './types.ts'
