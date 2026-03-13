import type {
	AttributeValue,
	BatchResponse,
	DynamoDBRecord,
	DynamoDBStreamEvent,
	EventBridgeEvent,
	LambdaContext,
	SNSEvent,
	SNSMessageAttribute,
	SQSEvent,
	SQSMessageAttribute,
	SQSRecord,
	SQSRecordAttributes,
} from './aws-types.ts'

const DEFAULT_REGION = 'us-east-1'
const DEFAULT_ACCOUNT_ID = '123456789'
const DEFAULT_TIME = '2024-01-01T00:00:00.000Z'

type RouterDispatch = (
	event: unknown,
	context: LambdaContext,
) => Promise<BatchResponse | undefined>

export interface RouterTestOptions {
	context?: Partial<LambdaContext>
}

export interface RouterTestSendOptions {
	context?: Partial<LambdaContext>
}

export interface SqsTestSendInput {
	queue: string
	body: unknown
	messageId?: string
	messageAttributes?: Record<string, SQSMessageAttribute>
	attributes?: Partial<SQSRecordAttributes>
}

export interface SqsTestBatchMessageInput {
	body: unknown
	messageId?: string
	messageAttributes?: Record<string, SQSMessageAttribute>
	attributes?: Partial<SQSRecordAttributes>
}

export interface SqsTestBatchInput {
	queue: string
	messages: SqsTestBatchMessageInput[]
}

export interface SnsTestSendInput {
	topic: string
	body: unknown
	messageId?: string
	subject?: string
	messageAttributes?: Record<string, SNSMessageAttribute>
}

export interface EventTestSendInput {
	source: string
	detailType: string
	detail: unknown
	id?: string
	time?: string
	resources?: string[]
}

export interface DynamoDBTestSendInput {
	table: string
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE'
	keys: Record<string, AttributeValue>
	newImage?: Record<string, AttributeValue>
	oldImage?: Record<string, AttributeValue>
	eventId?: string
	sequenceNumber?: string
}

export interface DynamoDBTestBatchRecordInput {
	keys: Record<string, AttributeValue>
	newImage?: Record<string, AttributeValue>
	oldImage?: Record<string, AttributeValue>
	eventId?: string
	sequenceNumber?: string
}

export interface DynamoDBTestBatchInput {
	table: string
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE'
	records: DynamoDBTestBatchRecordInput[]
}

export interface SqsTestSender {
	(
		input: SqsTestSendInput,
		options?: RouterTestSendOptions,
	): Promise<BatchResponse | undefined>
	batch(
		input: SqsTestBatchInput,
		options?: RouterTestSendOptions,
	): Promise<BatchResponse | undefined>
}

export interface DynamoDBTestSender {
	(
		input: DynamoDBTestSendInput,
		options?: RouterTestSendOptions,
	): Promise<BatchResponse | undefined>
	batch(
		input: DynamoDBTestBatchInput,
		options?: RouterTestSendOptions,
	): Promise<BatchResponse | undefined>
}

export interface RouterTestClient {
	send: {
		sqs: SqsTestSender
		sns: (
			input: SnsTestSendInput,
			options?: RouterTestSendOptions,
		) => Promise<BatchResponse | undefined>
		event: (
			input: EventTestSendInput,
			options?: RouterTestSendOptions,
		) => Promise<BatchResponse | undefined>
		dynamodb: DynamoDBTestSender
		raw: (
			event: unknown,
			options?: RouterTestSendOptions,
		) => Promise<BatchResponse | undefined>
	}
}

export function createRouterTestClient(
	dispatch: RouterDispatch,
	options?: RouterTestOptions,
): RouterTestClient {
	const defaultContext = options?.context

	const send = (event: unknown, sendOptions?: RouterTestSendOptions) =>
		dispatch(event, createLambdaContext(defaultContext, sendOptions?.context))

	const sqs = Object.assign(
		(
			input: SqsTestSendInput,
			sendOptions?: RouterTestSendOptions,
		): Promise<BatchResponse | undefined> =>
			send(createSQSEvent(input), sendOptions),
		{
			batch: (
				input: SqsTestBatchInput,
				sendOptions?: RouterTestSendOptions,
			): Promise<BatchResponse | undefined> =>
				send(createSQSBatchEvent(input), sendOptions),
		},
	) as SqsTestSender

	const dynamodb = Object.assign(
		(
			input: DynamoDBTestSendInput,
			sendOptions?: RouterTestSendOptions,
		): Promise<BatchResponse | undefined> =>
			send(createDynamoDBEvent(input), sendOptions),
		{
			batch: (
				input: DynamoDBTestBatchInput,
				sendOptions?: RouterTestSendOptions,
			): Promise<BatchResponse | undefined> =>
				send(createDynamoDBBatchEvent(input), sendOptions),
		},
	) as DynamoDBTestSender

	return {
		send: {
			sqs,
			sns: (input, sendOptions) => send(createSNSEvent(input), sendOptions),
			event: (input, sendOptions) =>
				send(createEventBridgeEvent(input), sendOptions),
			dynamodb,
			raw: (event, sendOptions) => send(event, sendOptions),
		},
	}
}

function createLambdaContext(
	base?: Partial<LambdaContext>,
	override?: Partial<LambdaContext>,
): LambdaContext {
	return {
		functionName: 'test-function',
		functionVersion: '1',
		invokedFunctionArn: `arn:aws:lambda:${DEFAULT_REGION}:${DEFAULT_ACCOUNT_ID}:function:test-function`,
		memoryLimitInMB: '128',
		awsRequestId: 'test-request-id',
		logGroupName: '/aws/lambda/test-function',
		logStreamName: 'test-log-stream',
		callbackWaitsForEmptyEventLoop: true,
		getRemainingTimeInMillis: () => 30000,
		...base,
		...override,
	}
}

function createSQSEvent(input: SqsTestSendInput): SQSEvent {
	return {
		Records: [createSQSRecord(input, 0)],
	}
}

function createSQSBatchEvent(input: SqsTestBatchInput): SQSEvent {
	return {
		Records: input.messages.map((message, index) =>
			createSQSRecord(
				{
					queue: input.queue,
					body: message.body,
					messageId: message.messageId,
					messageAttributes: message.messageAttributes,
					attributes: message.attributes,
				},
				index,
			),
		),
	}
}

function createSQSRecord(input: SqsTestSendInput, index: number): SQSRecord {
	const messageId = input.messageId ?? `test-message-${index + 1}`

	return {
		messageId,
		receiptHandle: `test-receipt-${messageId}`,
		body: serializePayload(input.body),
		attributes: {
			ApproximateReceiveCount: '1',
			SentTimestamp: '1234567890000',
			SenderId: 'test-sender',
			ApproximateFirstReceiveTimestamp: '1234567890000',
			...input.attributes,
		},
		messageAttributes: input.messageAttributes ?? {},
		md5OfBody: 'test-md5',
		eventSource: 'aws:sqs',
		eventSourceARN: `arn:aws:sqs:${DEFAULT_REGION}:${DEFAULT_ACCOUNT_ID}:${input.queue}`,
		awsRegion: DEFAULT_REGION,
	}
}

function createSNSEvent(input: SnsTestSendInput): SNSEvent {
	return {
		Records: [
			{
				EventVersion: '1.0',
				EventSubscriptionArn: `arn:aws:sns:${DEFAULT_REGION}:${DEFAULT_ACCOUNT_ID}:${input.topic}:test-subscription`,
				EventSource: 'aws:sns',
				Sns: {
					SignatureVersion: '1',
					Timestamp: DEFAULT_TIME,
					Signature: 'test-signature',
					SigningCertUrl: 'https://example.com/cert',
					MessageId: input.messageId ?? 'test-message-id',
					Message: serializePayload(input.body),
					MessageAttributes: input.messageAttributes ?? {},
					Type: 'Notification',
					UnsubscribeUrl: 'https://example.com/unsubscribe',
					TopicArn: `arn:aws:sns:${DEFAULT_REGION}:${DEFAULT_ACCOUNT_ID}:${input.topic}`,
					Subject: input.subject,
				},
			},
		],
	}
}

function createEventBridgeEvent(input: EventTestSendInput): EventBridgeEvent {
	return {
		version: '0',
		id: input.id ?? 'test-event-id',
		'detail-type': input.detailType,
		source: input.source,
		account: DEFAULT_ACCOUNT_ID,
		time: input.time ?? DEFAULT_TIME,
		region: DEFAULT_REGION,
		resources: input.resources ?? [],
		detail: input.detail,
	}
}

function createDynamoDBEvent(
	input: DynamoDBTestSendInput,
): DynamoDBStreamEvent {
	return {
		Records: [createDynamoDBRecord(input, 0)],
	}
}

function createDynamoDBBatchEvent(
	input: DynamoDBTestBatchInput,
): DynamoDBStreamEvent {
	return {
		Records: input.records.map((record, index) =>
			createDynamoDBRecord(
				{
					table: input.table,
					eventName: input.eventName,
					keys: record.keys,
					newImage: record.newImage,
					oldImage: record.oldImage,
					eventId: record.eventId,
					sequenceNumber: record.sequenceNumber,
				},
				index,
			),
		),
	}
}

function createDynamoDBRecord(
	input: DynamoDBTestSendInput,
	index: number,
): DynamoDBRecord {
	const eventId = input.eventId ?? `test-event-${index + 1}`
	const sequenceNumber = input.sequenceNumber ?? eventId

	return {
		eventID: eventId,
		eventVersion: '1.1',
		dynamodb: {
			Keys: input.keys,
			NewImage: input.newImage,
			OldImage: input.oldImage,
			SequenceNumber: sequenceNumber,
			SizeBytes: 100,
			StreamViewType: 'NEW_AND_OLD_IMAGES',
		},
		awsRegion: DEFAULT_REGION,
		eventName: input.eventName,
		eventSourceARN: `arn:aws:dynamodb:${DEFAULT_REGION}:${DEFAULT_ACCOUNT_ID}:table/${input.table}/stream/2024-01-01T00:00:00.000`,
		eventSource: 'aws:dynamodb',
	}
}

function serializePayload(payload: unknown): string {
	if (typeof payload === 'string') {
		return payload
	}

	const serialized = JSON.stringify(payload)
	return serialized ?? 'null'
}
