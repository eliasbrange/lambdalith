// Lambda Context
export interface LambdaContext {
	functionName: string
	functionVersion: string
	invokedFunctionArn: string
	memoryLimitInMB: string
	awsRequestId: string
	logGroupName: string
	logStreamName: string
	callbackWaitsForEmptyEventLoop: boolean
	getRemainingTimeInMillis(): number
}

// SQS Types
export interface SQSEvent {
	Records: SQSRecord[]
}

export interface SQSRecord {
	messageId: string
	receiptHandle: string
	body: string
	attributes: SQSRecordAttributes
	messageAttributes: Record<string, SQSMessageAttribute>
	md5OfBody: string
	eventSource: 'aws:sqs'
	eventSourceARN: string
	awsRegion: string
}

export interface SQSRecordAttributes {
	ApproximateReceiveCount: string
	SentTimestamp: string
	SenderId: string
	ApproximateFirstReceiveTimestamp: string
	SequenceNumber?: string
	MessageGroupId?: string
	MessageDeduplicationId?: string
}

export interface SQSMessageAttribute {
	stringValue?: string
	binaryValue?: string
	stringListValues?: string[]
	binaryListValues?: string[]
	dataType: string
}

// SNS Types
export interface SNSEvent {
	Records: SNSEventRecord[]
}

export interface SNSEventRecord {
	EventVersion: string
	EventSubscriptionArn: string
	EventSource: 'aws:sns'
	Sns: SNSMessage
}

export interface SNSMessage {
	SignatureVersion: string
	Timestamp: string
	Signature: string
	SigningCertUrl: string
	MessageId: string
	Message: string
	MessageAttributes: Record<string, SNSMessageAttribute>
	Type: string
	UnsubscribeUrl: string
	TopicArn: string
	Subject?: string
}

export interface SNSMessageAttribute {
	Type: string
	Value: string
}

// EventBridge Types
export interface EventBridgeEvent<T = unknown> {
	version: string
	id: string
	'detail-type': string
	source: string
	account: string
	time: string
	region: string
	resources: string[]
	detail: T
}

// DynamoDB Stream Types
export interface DynamoDBStreamEvent {
	Records: DynamoDBRecord[]
}

export interface DynamoDBRecord {
	eventID: string
	eventVersion: string
	dynamodb: StreamRecord
	awsRegion: string
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE'
	eventSourceARN: string
	eventSource: 'aws:dynamodb'
}

export interface StreamRecord {
	ApproximateCreationDateTime?: number
	Keys: Record<string, AttributeValue>
	NewImage?: Record<string, AttributeValue>
	OldImage?: Record<string, AttributeValue>
	SequenceNumber: string
	SizeBytes: number
	StreamViewType: 'KEYS_ONLY' | 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES'
}

export type AttributeValue =
	| { S: string }
	| { N: string }
	| { B: string }
	| { SS: string[] }
	| { NS: string[] }
	| { BS: string[] }
	| { M: Record<string, AttributeValue> }
	| { L: AttributeValue[] }
	| { NULL: boolean }
	| { BOOL: boolean }

// Batch failure response
export interface BatchResponse {
	batchItemFailures: BatchItemFailure[]
}

export interface BatchItemFailure {
	itemIdentifier: string
}
