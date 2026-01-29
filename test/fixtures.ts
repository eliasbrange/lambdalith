import type {
	AttributeValue,
	DynamoDBStreamEvent,
	EventBridgeEvent,
	LambdaContext,
	SNSEvent,
	SQSEvent,
} from '../src/aws-types'

// Mock Lambda context
export const mockLambdaContext: LambdaContext = {
	functionName: 'test-function',
	functionVersion: '1',
	invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
	memoryLimitInMB: '128',
	awsRequestId: 'test-request-id',
	logGroupName: '/aws/lambda/test',
	logStreamName: 'test-stream',
	callbackWaitsForEmptyEventLoop: true,
	getRemainingTimeInMillis: () => 30000,
}

// Test fixtures
export function createSQSRecord(
	queueName: string,
	messageId: string,
	body: unknown,
): SQSEvent['Records'][0] {
	return {
		messageId,
		receiptHandle: 'test-receipt',
		body: JSON.stringify(body),
		attributes: {
			ApproximateReceiveCount: '1',
			SentTimestamp: '1234567890000',
			SenderId: 'test-sender',
			ApproximateFirstReceiveTimestamp: '1234567890000',
		},
		messageAttributes: {
			myAttribute: {
				dataType: 'String',
				stringValue: 'value',
			},
		},
		md5OfBody: 'test-md5',
		eventSource: 'aws:sqs',
		eventSourceARN: `arn:aws:sqs:us-east-1:123456789:${queueName}`,
		awsRegion: 'us-east-1',
	}
}

export function createSQSEvent(
	queueName: string,
	messageId: string,
	body: unknown,
): SQSEvent {
	return {
		Records: [createSQSRecord(queueName, messageId, body)],
	}
}

export function createSQSBatchEvent(
	queueName: string,
	messages: Array<{ messageId: string; body: unknown }>,
): SQSEvent {
	return {
		Records: messages.map((m) =>
			createSQSRecord(queueName, m.messageId, m.body),
		),
	}
}

export function createSNSEvent(
	topicName: string,
	messageId: string,
	body: unknown,
): SNSEvent {
	return {
		Records: [
			{
				EventVersion: '1.0',
				EventSubscriptionArn: `arn:aws:sns:us-east-1:123456789:${topicName}:sub-id`,
				EventSource: 'aws:sns',
				Sns: {
					SignatureVersion: '1',
					Timestamp: '2024-01-01T00:00:00.000Z',
					Signature: 'test-signature',
					SigningCertUrl: 'https://example.com/cert',
					MessageId: messageId,
					Message: JSON.stringify(body),
					MessageAttributes: {},
					Type: 'Notification',
					UnsubscribeUrl: 'https://example.com/unsubscribe',
					TopicArn: `arn:aws:sns:us-east-1:123456789:${topicName}`,
					Subject: undefined,
				},
			},
		],
	}
}

export function createEventBridgeEvent(
	source: string,
	detailType: string,
	detail: unknown,
): EventBridgeEvent {
	return {
		version: '0',
		id: 'test-event-id',
		'detail-type': detailType,
		source,
		account: '123456789',
		time: '2024-01-01T00:00:00Z',
		region: 'us-east-1',
		resources: [],
		detail,
	}
}

export function createDynamoDBRecord(
	tableName: string,
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
	eventId: string,
	keys: Record<string, AttributeValue>,
	newImage?: Record<string, AttributeValue>,
	sequenceNumber?: string,
): DynamoDBStreamEvent['Records'][0] {
	return {
		eventID: eventId,
		eventVersion: '1.1',
		dynamodb: {
			Keys: keys,
			NewImage: newImage,
			SequenceNumber: sequenceNumber ?? eventId,
			SizeBytes: 100,
			StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
		},
		awsRegion: 'us-east-1',
		eventName,
		eventSourceARN: `arn:aws:dynamodb:us-east-1:123456789:table/${tableName}/stream/2024-01-01`,
		eventSource: 'aws:dynamodb' as const,
	}
}

export function createDynamoDBEvent(
	tableName: string,
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
	keys: Record<string, AttributeValue>,
	newImage?: Record<string, AttributeValue>,
): DynamoDBStreamEvent {
	return {
		Records: [
			createDynamoDBRecord(
				tableName,
				eventName,
				'test-event-id',
				keys,
				newImage,
			),
		],
	}
}

export function createDynamoDBBatchEvent(
	tableName: string,
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
	records: Array<{ eventId: string; keys: Record<string, AttributeValue> }>,
): DynamoDBStreamEvent {
	return {
		Records: records.map((r) =>
			createDynamoDBRecord(tableName, eventName, r.eventId, r.keys),
		),
	}
}
