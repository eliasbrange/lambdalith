import { describe, expect, test } from 'bun:test'
import {
	parseQueueName,
	parseTableName,
	parseTopicName,
	safeJsonParse,
	unmarshall,
} from './utils'

describe('unmarshall', () => {
	test('unmarshalls all DynamoDB types', () => {
		const result = unmarshall({
			str: { S: 'hello' },
			num: { N: '42' },
			bool: { BOOL: true },
			nul: { NULL: true },
			bin: { B: 'YmluYXJ5' },
			ss: { SS: ['a', 'b'] },
			ns: { NS: ['1', '2'] },
			bs: { BS: ['YQ==', 'Yg=='] },
			list: { L: [{ S: 'foo' }, { N: '99' }] },
			map: { M: { nested: { S: 'value' } } },
		})

		expect(result).toEqual({
			str: 'hello',
			num: 42,
			bool: true,
			nul: null,
			bin: 'YmluYXJ5',
			ss: ['a', 'b'],
			ns: [1, 2],
			bs: ['YQ==', 'Yg=='],
			list: ['foo', 99],
			map: { nested: 'value' },
		})
	})

	test('returns undefined for unknown attribute types', () => {
		// @ts-expect-error - testing unknown type
		const result = unmarshall({ unknown: { UNKNOWN: 'value' } })
		expect(result).toEqual({ unknown: undefined })
	})
})

describe('parseQueueName', () => {
	test('parses queue name from SQS ARN', () => {
		expect(parseQueueName('arn:aws:sqs:us-east-1:123456789012:my-queue')).toBe(
			'my-queue',
		)
		expect(
			parseQueueName('arn:aws:sqs:us-east-1:123456789012:my-queue.fifo'),
		).toBe('my-queue.fifo')
		expect(parseQueueName('')).toBe('')
	})
})

describe('parseTopicName', () => {
	test('parses topic name from SNS ARN', () => {
		expect(parseTopicName('arn:aws:sns:us-east-1:123456789012:my-topic')).toBe(
			'my-topic',
		)
		expect(
			parseTopicName('arn:aws:sns:us-east-1:123456789012:my-topic.fifo'),
		).toBe('my-topic.fifo')
		expect(parseTopicName('')).toBe('')
	})
})

describe('parseTableName', () => {
	test('parses table name from DynamoDB stream ARN', () => {
		expect(
			parseTableName(
				'arn:aws:dynamodb:us-east-1:123456789012:table/orders/stream/2024-01-01T00:00:00.000',
			),
		).toBe('orders')
		expect(
			parseTableName('arn:aws:dynamodb:us-east-1:123456789012:invalid'),
		).toBe('')
		expect(parseTableName('')).toBe('')
	})
})

describe('safeJsonParse', () => {
	test('parses valid JSON', () => {
		expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
		expect(safeJsonParse('[1,2]')).toEqual([1, 2])
		expect(safeJsonParse('42')).toBe(42)
		expect(safeJsonParse('null')).toBe(null)
	})

	test('returns original string for invalid JSON', () => {
		expect(safeJsonParse('not json')).toBe('not json')
		expect(safeJsonParse('{broken}')).toBe('{broken}')
	})
})
