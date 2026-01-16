import { describe, expect, mock, test } from 'bun:test'
import type { LambdaContext, SQSEvent } from '../src'
import { EventRouter } from '../src'

// Mock Lambda context
const mockLambdaContext: LambdaContext = {
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
function createSQSEvent(
	queueName: string,
	messageId: string,
	body: unknown,
): SQSEvent {
	return {
		Records: [
			{
				messageId,
				receiptHandle: 'test-receipt',
				body: JSON.stringify(body),
				attributes: {
					ApproximateReceiveCount: '1',
					SentTimestamp: '1234567890000',
					SenderId: 'test-sender',
					ApproximateFirstReceiveTimestamp: '1234567890000',
				},
				messageAttributes: {},
				md5OfBody: 'test-md5',
				eventSource: 'aws:sqs',
				eventSourceARN: `arn:aws:sqs:us-east-1:123456789:${queueName}`,
				awsRegion: 'us-east-1',
			},
		],
	}
}

function createSNSEvent(topicName: string, messageId: string, body: unknown) {
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

function createEventBridgeEvent(
	source: string,
	detailType: string,
	detail: unknown,
) {
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

function createDynamoDBEvent(
	tableName: string,
	eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
	keys: Record<string, { S?: string; N?: string }>,
	newImage?: Record<string, { S?: string; N?: string }>,
) {
	return {
		Records: [
			{
				eventID: 'test-event-id',
				eventVersion: '1.1',
				dynamodb: {
					Keys: keys,
					NewImage: newImage,
					SequenceNumber: '123',
					SizeBytes: 100,
					StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
				},
				awsRegion: 'us-east-1',
				eventName,
				eventSourceARN: `arn:aws:dynamodb:us-east-1:123456789:table/${tableName}/stream/2024-01-01`,
				eventSource: 'aws:dynamodb' as const,
			},
		],
	}
}

describe('EventRouter', () => {
	describe('SQS routing', () => {
		test('routes to exact queue match', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.sqs('orders-queue', handler)

			const event = createSQSEvent('orders-queue', 'msg-1', { orderId: '123' })
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('routes to wildcard handler when no exact match', async () => {
			const router = new EventRouter()
			const wildcardHandler = mock(() => {})

			router.sqs('*', wildcardHandler)

			const event = createSQSEvent('any-queue', 'msg-1', { data: 'test' })
			await router.handler()(event, mockLambdaContext)

			expect(wildcardHandler).toHaveBeenCalledTimes(1)
		})

		test('exact match takes priority over wildcard', async () => {
			const router = new EventRouter()
			const exactHandler = mock(() => {})
			const wildcardHandler = mock(() => {})

			router.sqs('*', wildcardHandler)
			router.sqs('orders-queue', exactHandler)

			const event = createSQSEvent('orders-queue', 'msg-1', { orderId: '123' })
			await router.handler()(event, mockLambdaContext)

			expect(exactHandler).toHaveBeenCalledTimes(1)
			expect(wildcardHandler).not.toHaveBeenCalled()
		})

		test('provides correct context properties', async () => {
			const router = new EventRouter()
			let capturedContext: unknown

			router.sqs('orders-queue', (c) => {
				capturedContext = {
					queue: c.sqs.queue,
					body: c.sqs.body,
					messageId: c.sqs.messageId,
					lambdaRequestId: c.lambdaContext.awsRequestId,
				}
			})

			const event = createSQSEvent('orders-queue', 'msg-123', {
				orderId: '456',
			})
			await router.handler()(event, mockLambdaContext)

			expect(capturedContext).toEqual({
				queue: 'orders-queue',
				body: { orderId: '456' },
				messageId: 'msg-123',
				lambdaRequestId: 'test-request-id',
			})
		})

		test('returns batch item failures for failed records', async () => {
			const router = new EventRouter()

			router.sqs('orders-queue', () => {
				throw new Error('Processing failed')
			})

			const event = createSQSEvent('orders-queue', 'msg-fail', { data: 'test' })
			const result = await router.handler()(event, mockLambdaContext)

			expect(result).toEqual({
				batchItemFailures: [{ itemIdentifier: 'msg-fail' }],
			})
		})

		test('get/set works on context', async () => {
			const router = new EventRouter()
			let getValue: unknown

			router.sqs('orders-queue', (c) => {
				c.set('traceId', 'trace-123')
				getValue = c.get('traceId')
			})

			const event = createSQSEvent('orders-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(getValue).toBe('trace-123')
		})
	})

	describe('SNS routing', () => {
		test('routes to exact topic match', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.sns('notifications', handler)

			const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('provides correct context properties', async () => {
			const router = new EventRouter()
			let capturedTopic: string | undefined

			router.sns('notifications', (c) => {
				capturedTopic = c.sns.topic
			})

			const event = createSNSEvent('notifications', 'msg-1', { alert: 'test' })
			await router.handler()(event, mockLambdaContext)

			expect(capturedTopic).toBe('notifications')
		})
	})

	describe('EventBridge routing', () => {
		test('routes to exact source/detailType match', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.event('myapp.users/UserCreated', handler)

			const event = createEventBridgeEvent('myapp.users', 'UserCreated', {
				userId: '123',
			})
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('routes to partial match (source/*)', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.event('myapp.users/*', handler)

			const event = createEventBridgeEvent('myapp.users', 'UserDeleted', {
				userId: '123',
			})
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('exact match takes priority over partial', async () => {
			const router = new EventRouter()
			const exactHandler = mock(() => {})
			const partialHandler = mock(() => {})

			router.event('myapp.users/*', partialHandler)
			router.event('myapp.users/UserCreated', exactHandler)

			const event = createEventBridgeEvent('myapp.users', 'UserCreated', {})
			await router.handler()(event, mockLambdaContext)

			expect(exactHandler).toHaveBeenCalledTimes(1)
			expect(partialHandler).not.toHaveBeenCalled()
		})

		test('provides correct context properties', async () => {
			const router = new EventRouter()
			let capturedContext: unknown

			router.event('myapp.users/UserCreated', (c) => {
				capturedContext = {
					source: c.event.source,
					detailType: c.event.detailType,
					detail: c.event.detail,
				}
			})

			const event = createEventBridgeEvent('myapp.users', 'UserCreated', {
				userId: '123',
			})
			await router.handler()(event, mockLambdaContext)

			expect(capturedContext).toEqual({
				source: 'myapp.users',
				detailType: 'UserCreated',
				detail: { userId: '123' },
			})
		})
	})

	describe('DynamoDB Streams routing', () => {
		test('routes to exact table/eventName match', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.dynamodb('orders-table/INSERT', handler)

			const event = createDynamoDBEvent(
				'orders-table',
				'INSERT',
				{ pk: { S: 'order-123' } },
				{ pk: { S: 'order-123' }, status: { S: 'pending' } },
			)
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('routes to partial match (table/*)', async () => {
			const router = new EventRouter()
			const handler = mock(() => {})

			router.dynamodb('orders-table/*', handler)

			const event = createDynamoDBEvent('orders-table', 'MODIFY', {
				pk: { S: 'order-123' },
			})
			await router.handler()(event, mockLambdaContext)

			expect(handler).toHaveBeenCalledTimes(1)
		})

		test('unmarshalls DynamoDB data correctly', async () => {
			const router = new EventRouter()
			let capturedKeys: unknown

			router.dynamodb('orders-table/INSERT', (c) => {
				capturedKeys = c.dynamodb.keys
			})

			const event = createDynamoDBEvent('orders-table', 'INSERT', {
				pk: { S: 'order-123' },
				sk: { N: '42' },
			})
			await router.handler()(event, mockLambdaContext)

			expect(capturedKeys).toEqual({
				pk: 'order-123',
				sk: 42,
			})
		})
	})

	describe('Error handling', () => {
		test('calls notFound handler when no route matches', async () => {
			const router = new EventRouter()
			const notFoundHandler = mock(() => {})

			router.notFound(notFoundHandler)

			const event = createSQSEvent('unknown-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(notFoundHandler).toHaveBeenCalledTimes(1)
		})

		test('calls onError handler when handler throws', async () => {
			const router = new EventRouter()
			const errorHandler = mock(() => {})

			router.sqs('orders-queue', () => {
				throw new Error('Handler error')
			})
			router.onError(errorHandler)

			const event = createSQSEvent('orders-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(errorHandler).toHaveBeenCalledTimes(1)
		})

		test('onError receives the error object', async () => {
			const router = new EventRouter()
			let capturedError: Error | undefined

			router.sqs('orders-queue', () => {
				throw new Error('Test error message')
			})
			router.onError((err) => {
				capturedError = err
			})

			const event = createSQSEvent('orders-queue', 'msg-1', {})
			await router.handler()(event, mockLambdaContext)

			expect(capturedError?.message).toBe('Test error message')
		})
	})

	describe('Event detection', () => {
		test('handles unknown event types gracefully', async () => {
			const router = new EventRouter()
			const notFoundHandler = mock(() => {})

			router.notFound(notFoundHandler)

			const unknownEvent = { foo: 'bar' }
			await router.handler()(unknownEvent, mockLambdaContext)

			expect(notFoundHandler).toHaveBeenCalledTimes(1)
		})
	})
})
