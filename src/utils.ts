import type { AttributeValue } from './aws-types.ts'

/**
 * Unmarshall a DynamoDB AttributeValue map to a plain JavaScript object.
 */
export function unmarshall(
	item: Record<string, AttributeValue>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(item)) {
		result[key] = unmarshallValue(value)
	}
	return result
}

/**
 * Unmarshall a single DynamoDB AttributeValue to a JavaScript value.
 */
function unmarshallValue(value: AttributeValue): unknown {
	if ('S' in value) return value.S
	if ('N' in value) return Number(value.N)
	if ('B' in value) return value.B
	if ('SS' in value) return value.SS
	if ('NS' in value) return value.NS.map(Number)
	if ('BS' in value) return value.BS
	if ('M' in value) return unmarshall(value.M)
	if ('L' in value) return value.L.map(unmarshallValue)
	if ('NULL' in value) return null
	if ('BOOL' in value) return value.BOOL

	return undefined
}

/**
 * Parse the queue name from an SQS event source ARN.
 * ARN format: arn:aws:sqs:region:account-id:queue-name
 */
export function parseQueueName(eventSourceArn: string): string {
	const parts = eventSourceArn.split(':')
	return parts[parts.length - 1] ?? ''
}

/**
 * Parse the topic name from an SNS topic ARN.
 * ARN format: arn:aws:sns:region:account-id:topic-name
 */
export function parseTopicName(topicArn: string): string {
	const parts = topicArn.split(':')
	return parts[parts.length - 1] ?? ''
}

/**
 * Parse the table name from a DynamoDB stream ARN.
 * ARN format: arn:aws:dynamodb:region:account-id:table/table-name/stream/timestamp
 */
export function parseTableName(eventSourceArn: string): string {
	const match = eventSourceArn.match(/table\/([^/]+)/)
	return match?.[1] ?? ''
}

/**
 * Safely parse JSON, returning undefined on failure.
 */
export function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}
