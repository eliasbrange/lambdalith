import type {
	DynamoDBStreamEvent,
	EventBridgeEvent,
	SNSEvent,
	SQSEvent,
} from './aws-types.ts'

export type DetectedEvent =
	| { type: 'sqs'; event: SQSEvent }
	| { type: 'sns'; event: SNSEvent }
	| { type: 'event'; event: EventBridgeEvent }
	| { type: 'dynamodb'; event: DynamoDBStreamEvent }
	| { type: 'unknown'; event: unknown }

/**
 * Detect the type of Lambda event based on its structure.
 */
export function detectEventType(event: unknown): DetectedEvent {
	if (!event || typeof event !== 'object') {
		return { type: 'unknown', event }
	}

	const e = event as Record<string, unknown>

	// Check for batch events with Records array
	if (Array.isArray(e.Records) && e.Records.length > 0) {
		const firstRecord = e.Records[0] as Record<string, unknown>

		// SQS: eventSource === 'aws:sqs'
		if (firstRecord.eventSource === 'aws:sqs') {
			return { type: 'sqs', event: event as SQSEvent }
		}

		// SNS: has Sns property with TopicArn
		if (
			firstRecord.Sns &&
			typeof firstRecord.Sns === 'object' &&
			'TopicArn' in (firstRecord.Sns as object)
		) {
			return { type: 'sns', event: event as SNSEvent }
		}

		// DynamoDB: eventSource === 'aws:dynamodb'
		if (firstRecord.eventSource === 'aws:dynamodb') {
			return { type: 'dynamodb', event: event as DynamoDBStreamEvent }
		}
	}

	// EventBridge: has source and detail-type at top level
	if ('source' in e && 'detail-type' in e && 'detail' in e) {
		return { type: 'event', event: event as EventBridgeEvent }
	}

	return { type: 'unknown', event }
}
